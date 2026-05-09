const { v4: uuidv4 } = require('uuid');
// remove node-fetch completely
const db = require('./db');
const { ensureSchema, seedShips, getInitialConfig } = require('./init-db');
const {
  haversineDistance,
  bearingBetween,
  destinationPoint,
  pointInPolygon,
  lineIntersectsPolygon,
  normalizeHeading,
} = require('./utils');

const WEATHER_REFRESH_MS = 30 * 1000; // 30 seconds for testing
const SNAPSHOT_INTERVAL_MS = 30 * 1000;
const HISTORY_RETENTION_MS = 60 * 60 * 1000;

const state = {
  ships: [],
  zones: [],
  alerts: [],
  directives: [],
  events: [],
  snapshots: [],
  weather: { updatedAt: 0, current: { windspeed: 0, precipitation: 0, weathercode: 0 } },
  config: getInitialConfig(),
  lastSnapshot: 0,
};

function findPort(portId) {
  return state.config.ports.find((port) => port.id === portId);
}

function copyShip(ship) {
  return JSON.parse(JSON.stringify(ship));
}

async function persistShip(ship) {
  await db.query(
    `INSERT INTO ships(ship_id, data) VALUES($1, $2)
     ON CONFLICT (ship_id) DO UPDATE SET data = $2, updated_at = NOW();`,
    [ship.shipId, ship]
  );
}

async function persistZone(zone) {
  await db.query(
    `INSERT INTO zones(id, data) VALUES($1, $2)
     ON CONFLICT (id) DO UPDATE SET data = $2;`,
    [zone.id, zone]
  );
}

async function persistAlert(alert) {
  await db.query(
    `INSERT INTO alerts(id, data) VALUES($1, $2)
     ON CONFLICT (id) DO UPDATE SET data = $2;`,
    [alert.id, alert]
  );
}

async function persistDirective(directive) {
  await db.query(
    `INSERT INTO directives(id, data) VALUES($1, $2)
     ON CONFLICT (id) DO UPDATE SET data = $2;`,
    [directive.id, directive]
  );
}

async function persistEvent(event) {
  await db.query(
    `INSERT INTO events(id, data) VALUES($1, $2)
     ON CONFLICT (id) DO UPDATE SET data = $2;`,
    [event.id, event]
  );
}

async function recordSnapshot() {
  const snapshot = {
    ships: state.ships.map(copyShip),
    zones: [...state.zones],
    alerts: state.alerts.filter((alert) => alert.active),
    timestamp: new Date().toISOString(),
  };
  state.snapshots.push(snapshot);
  const id = uuidv4();
  await db.query(
    `INSERT INTO snapshots(id, timestamp, data) VALUES($1, $2, $3);`,
    [id, snapshot.timestamp, snapshot]
  );
  await db.query(`DELETE FROM snapshots WHERE timestamp < NOW() - INTERVAL '1 hour';`);
}

function getRouteTarget(ship) {
  if (ship.path && ship.path.length > 0) {
    return ship.path[0];
  }
  const port = findPort(ship.destination);
  return port ? port.position : ship.position;
}

function isSegmentBlocked(start, end) {
  if (!pointInPolygon(start, state.config.water) || !pointInPolygon(end, state.config.water)) {
    return true;
  }
  if (lineIntersectsPolygon(start, end, state.config.water)) {
    return true;
  }
  for (const zone of state.zones) {
    if (pointInPolygon(start, zone.polygon) || pointInPolygon(end, zone.polygon)) {
      return true;
    }
    if (lineIntersectsPolygon(start, end, zone.polygon)) {
      return true;
    }
  }
  return false;
}

function weatherPenalty(ship) {
  const adverse = state.weather.current.precipitation >= 2 || state.weather.current.windspeed >= 15;
  return adverse ? 1.3 : 1;
}

function extractWeatherRisk() {
  const { precipitation, windspeed } = state.weather.current;
  if (precipitation >= 10 || windspeed >= 25) return 'extreme';
  if (precipitation >= 4 || windspeed >= 18) return 'high';
  if (precipitation >= 2 || windspeed >= 15) return 'moderate';
  return 'mild';
}

function createEvent(type, payload) {
  const event = {
    id: uuidv4(),
    type,
    payload,
    timestamp: new Date().toISOString(),
  };
  state.events.push(event);
  persistEvent(event).catch((err) => console.error('persistEvent', err));
  return event;
}

function createAlert(type, shipId, message, severity = 'medium') {
  const alert = {
    id: uuidv4(),
    type,
    shipId,
    message,
    severity,
    active: true,
    acknowledged: false,
    createdAt: new Date().toISOString(),
  };
  state.alerts.push(alert);
  persistAlert(alert).catch((err) => console.error('persistAlert', err));
  createEvent('alert', { shipId, type, severity, message });
  return alert;
}

function closeOldHistory() {
  const cutoff = Date.now() - HISTORY_RETENTION_MS;
  state.events = state.events.filter((event) => new Date(event.timestamp).getTime() >= cutoff);
  state.snapshots = state.snapshots.filter((snap) => new Date(snap.timestamp).getTime() >= cutoff);
}

function makeSafeOffsetPoints(point) {
  const offsets = [10, 20, 30, 40, 50];
  const directions = [0, 45, 90, 135, 180, 225, 270, 315];
  const candidates = [];
  for (const km of offsets) {
    for (const bearing of directions) {
      candidates.push(destinationPoint(point, bearing, km));
    }
  }
  return candidates;
}

function buildAvoidanceCandidates(zone) {
  const candidates = [];
  for (let i = 0; i < zone.polygon.length; i += 1) {
    candidates.push(...makeSafeOffsetPoints(zone.polygon[i]));
  }
  return candidates;
}

function weatherAwareCandidates(start, destination) {
  const mid = [(start[0] + destination[0]) / 2, (start[1] + destination[1]) / 2];
  const directions = [45, 135, 225, 315];
  return directions.map((bearing) => destinationPoint(mid, bearing, 40));
}

function buildRoute(ship) {
  const destinationPort = findPort(ship.destination);
  if (!destinationPort) return [];
  const start = ship.position;
  const destination = destinationPort.position;
  if (!isSegmentBlocked(start, destination)) {
    return [destination];
  }

  const candidates = [];
  for (const zone of state.zones) {
    candidates.push(...buildAvoidanceCandidates(zone));
  }

  if (state.weather.current.windspeed >= 15 || state.weather.current.precipitation >= 2) {
    candidates.push(...weatherAwareCandidates(start, destination));
  }

  for (const candidate of candidates) {
    if (!pointInPolygon(candidate, state.config.water)) continue;
    if (isSegmentBlocked(start, candidate)) continue;
    if (isSegmentBlocked(candidate, destination)) continue;
    return [candidate, destination];
  }

  return [];
}

async function loadState() {
  const shipsRes = await db.query('SELECT data FROM ships');
  state.ships = shipsRes.rows.map((row) => row.data);

  const zonesRes = await db.query('SELECT data FROM zones LIMIT 100');
  state.zones = zonesRes.rows.map((row) => row.data);

  const alertsRes = await db.query(`
  SELECT data 
  FROM alerts 
  ORDER BY created_at DESC 
  LIMIT 200
`);
  state.alerts = alertsRes.rows.map((row) => row.data);

  const directivesRes = await db.query('SELECT data FROM directives');
  state.directives = directivesRes.rows.map((row) => row.data);

  const eventsRes = await db.query(`
  SELECT data 
  FROM events 
  ORDER BY created_at DESC 
  LIMIT 200
`);

state.events = eventsRes.rows
  .map((row) => row.data)
  .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
  .slice(0, 200)
  .reverse();

  const snapshotsRes = await db.query(
  'SELECT data FROM snapshots ORDER BY timestamp ASC LIMIT 500'
);
  state.snapshots = snapshotsRes.rows.map((row) => row.data);

  if (state.ships.length === 0) {
    await seedShips();
    await loadState();
  }
}

function computeFuelBurn(distanceKm, ship) {
  const nauticalMiles = distanceKm / 1.852;
  const baseBurnPerNm = 0.10;
  return nauticalMiles * baseBurnPerNm * weatherPenalty(ship);
}

function updateShipPosition(ship, dtSec) {
  if (ship.status === 'arrived' || ship.status === 'out_of_fuel' || ship.status === 'stranded') {
    return;
  }

  if (!ship.path || ship.path.length === 0) {
    ship.path = buildRoute(ship);
    if (ship.path.length === 0) {
      ship.status = 'stranded';
      createAlert('stranded', ship.shipId, `Ship ${ship.name} cannot find a valid route.`, 'high');
      return;
    }
    ship.status = 'rerouting';
  }

  const target = ship.path[0];
  if (!target) return;

  const distanceRemaining = haversineDistance(ship.position, target);
  const stepKm = (ship.speed * 1.852 * dtSec) / 3600;
  const newHeading = bearingBetween(ship.position, target);
  ship.heading = normalizeHeading(newHeading);

  if (distanceRemaining <= stepKm) {
    ship.position = target;
    ship.path.shift();
  } else {
    ship.position = destinationPoint(ship.position, ship.heading, stepKm);
  }

  const burn = computeFuelBurn(Math.min(stepKm, distanceRemaining), ship);
  ship.fuel = Math.max(0, ship.fuel - burn);
  if (ship.fuel <= 0) {
    ship.status = 'out_of_fuel';
    createAlert('out_of_fuel', ship.shipId, `${ship.name} has run out of fuel.`, 'high');
  }
}

function projectShipStatus(ship) {
  const destinationPort = findPort(ship.destination);
  if (!destinationPort) return;
  const distanceToDest = haversineDistance(ship.position, destinationPort.position);

  if (distanceToDest < 0.08) {
    ship.status = 'arrived';
    ship.path = [];
    createEvent('arrived', { shipId: ship.shipId, destination: ship.destination });
    return;
  }

  if (ship.fuel < 1000 && ship.status !== 'out_of_fuel') {
    ship.status = 'insufficient_fuel';
  }

  for (const zone of state.zones) {
    if (pointInPolygon(ship.position, zone.polygon)) {
      ship.status = 'distressed';
      const existing = state.alerts.find((alert) => alert.type === 'geofence' && alert.shipId === ship.shipId && alert.active);
      if (!existing) {
        createAlert('geofence', ship.shipId, `${ship.name} entered restricted zone ${zone.name}.`, 'high');
      }
    }
  }
}

function applyPendingDirectives() {
  for (const directive of state.directives) {
    if (directive.status !== 'accepted') continue;
    const ship = state.ships.find((item) => item.shipId === directive.shipId);
    if (!ship) continue;
    if (directive.command === 'reroute_port') {
      ship.destination = directive.payload.destination;
      ship.path = [];
      ship.status = 'rerouting';
    }
    if (directive.command === 'hold_position') {
      ship.path = [ship.position];
      ship.status = 'holding';
    }
    directive.status = 'completed';
    persistDirective(directive).catch((err) => console.error('persistDirective', err));
    createEvent('directive_executed', { shipId: ship.shipId, directive });
  }
}

async function tick(io) {
  const now = Date.now();
  if (now - state.weather.updatedAt > WEATHER_REFRESH_MS) {
    await refreshWeather();
  }

  applyPendingDirectives();

  for (const ship of state.ships) {
    updateShipPosition(ship, 1);
    projectShipStatus(ship);
    if (ship.path.length === 0 && ship.status !== 'arrived' && ship.status !== 'out_of_fuel' && ship.status !== 'stranded') {
      ship.path = buildRoute(ship);
    }
  }

  const pairs = [];
  for (let i = 0; i < state.ships.length; i += 1) {
    for (let j = i + 1; j < state.ships.length; j += 1) {
      const shipA = state.ships[i];
      const shipB = state.ships[j];
      const distance = haversineDistance(shipA.position, shipB.position);
      if (distance <= 2) {
        pairs.push({ shipA: shipA.shipId, shipB: shipB.shipId, distance: Math.round(distance * 1000) / 1000 });
        createAlert('proximity', shipA.shipId, `${shipA.name} is within ${distance.toFixed(2)} km of ${shipB.name}.`, 'medium');
      }
    }
  }

  if (now - state.lastSnapshot >= SNAPSHOT_INTERVAL_MS) {
    await recordSnapshot();
    state.lastSnapshot = now;
  }

  closeOldHistory();
  await Promise.all(state.ships.map(persistShip));
  if (io) {
    io.emit('state.update', getPublicState());
  }
}

async function refreshWeather(force = false) {
  try {
    console.log("refreshWeather called");

    const latitude = 26.5;
    const longitude = 55.0;

    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${latitude}` +
      `&longitude=${longitude}` +
      `&current=temperature_2m,precipitation,wind_speed_10m,weather_code` +
      `&timezone=UTC`;

    const response = await fetch(url);
    const data = await response.json();

    console.log("WEATHER API RESPONSE:", data);

    // ❗ API error handling (VERY IMPORTANT)
    if (!data || data.error || !data.current) {
      console.warn("Weather API failed, keeping previous data");

      // fallback (don’t reset to 0)
      if (!state.weather.current) {
        state.weather.current = {
          windspeed: 0,
          temperature: 0,
          weathercode: 0,
          precipitation: 0,
        };
      }

      return;
    }

    // ✅ update state only on valid response
    state.weather = {
      updatedAt: Date.now(),
      current: {
        windspeed: data.current.wind_speed_10m ?? state.weather.current?.windspeed ?? 0,
        temperature: data.current.temperature_2m ?? state.weather.current?.temperature ?? 0,
        weathercode: data.current.weather_code ?? 0,
        precipitation: data.current.precipitation ?? 0,
      },
    };

    createEvent("weather_update", {
      current: state.weather.current,
      risk: extractWeatherRisk(),
    });
  } catch (error) {
    console.error("weather refresh error", error);

    // ⚠️ never crash simulation due to weather failure
    return;
  }
}

async function initialize(io) {
  await ensureSchema();
  await loadState();
  console.log("INITIALIZE RUNNING");
  await refreshWeather();
  state.lastSnapshot = Date.now();
  await recordSnapshot();
  if (io) {
    io.emit('state.update', getPublicState());
  }
  setInterval(() => tick(io).catch((err) => console.error('tick error', err)), 1000);
}

function getPublicState() {
  return {
    ships: state.ships.map(copyShip),
    zones: [...state.zones],
    alerts: state.alerts.filter((alert) => alert.active),
    directives: state.directives,
    events: state.events.slice(-100),
    snapshots: state.snapshots,
    weather: state.weather,
    config: state.config,
  };
}

async function addZone(zoneInput) {
  const zone = {
    id: uuidv4(),
    name: zoneInput.name || `Restricted Zone ${state.zones.length + 1}`,
    polygon: zoneInput.polygon,
    createdAt: new Date().toISOString(),
  };
  state.zones.push(zone);
  await persistZone(zone);
  createEvent('zone_added', { zone });
  for (const ship of state.ships) {
    if (pointInPolygon(ship.position, zone.polygon) || lineIntersectsPolygon(ship.position, getRouteTarget(ship), zone.polygon)) {
      createAlert('geofence', ship.shipId, `${ship.name} is affected by new restricted zone ${zone.name}.`, 'high');
      ship.path = [];
      ship.status = 'rerouting';
    }
  }
  await Promise.all(state.ships.map(persistShip));
  return zone;
}

async function postDirective(directiveInput) {
  const directive = {
    id: uuidv4(),
    shipId: directiveInput.shipId,
    command: directiveInput.command,
    payload: directiveInput.payload,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  state.directives.push(directive);
  await persistDirective(directive);
  createEvent('directive_created', { directive });
  return directive;
}

async function captainResponse(responseInput) {
  const directive = state.directives.find((item) => item.id === responseInput.directiveId);
  if (!directive) {
    throw new Error('Directive not found');
  }
  if (responseInput.response === 'accept') {
    directive.status = 'accepted';
    await persistDirective(directive);
    createEvent('directive_accepted', { directiveId: directive.id, shipId: directive.shipId });
    return directive;
  }

  if (responseInput.response === 'escalate') {
    directive.status = 'escalated';
    const parsed = parseDistressMessage(responseInput.message);
    createAlert('distress', directive.shipId, `Distress from ${directive.shipId}: ${parsed.summary}`, parsed.severity);
    await persistDirective(directive);
    createEvent('distress_escalated', { directiveId: directive.id, shipId: directive.shipId, message: responseInput.message, parsed });
    return directive;
  }

  return directive;
}

function parseDistressMessage(message) {
  const lower = message.toLowerCase();
  const severity = lower.includes('critical') || lower.includes('mayday') || lower.includes('fire') ? 'critical' : lower.includes('injury') || lower.includes('damage') ? 'high' : 'medium';
  const issue = lower.includes('engine') ? 'engine failure' : lower.includes('collision') ? 'collision' : lower.includes('fire') ? 'fire' : lower.includes('leak') ? 'cargo leak' : 'unknown hazard';
  const injuryMatch = message.match(/(\d+)\s*(?:injur|casualty|crew|person)/i);
  const damageMatch = message.match(/(\d+)\s*(?:ton|m|meter|%)/i);
  const impact = {
    injuries: injuryMatch ? parseInt(injuryMatch[1], 10) : null,
    damageEstimate: damageMatch ? damageMatch[1] : null,
  };
  return {
    severity,
    issue,
    impact,
    summary: `${severity} ${issue}${impact.injuries ? `, ${impact.injuries} injured` : ''}${impact.damageEstimate ? `, estimate ${impact.damageEstimate}` : ''}`,
  };
}

async function ackAlert(alertId) {
  const alert = state.alerts.find((item) => item.id === alertId);
  if (!alert) throw new Error('Alert not found');
  alert.acknowledged = true;
  alert.active = false;
  await persistAlert(alert);
  createEvent('alert_acknowledged', { alertId });
  return alert;
}

module.exports = {
  initialize,
  getPublicState,
  addZone,
  postDirective,
  captainResponse,
  ackAlert,
  getState: getPublicState,
};
