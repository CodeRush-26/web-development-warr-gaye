import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Popup, Polygon, Polyline, useMapEvents } from 'react-leaflet';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function MapClickHandler({ drawing, onNewPoint }) {
  useMapEvents({
    click(event) {
      if (drawing) {
        onNewPoint([event.latlng.lat, event.latlng.lng]);
      }
    },
  });
  return null;
}

const STATUS_CONFIG = {
  normal:            { color: '#00ff88', label: 'NOMINAL',     pulse: false },
  rerouting:         { color: '#ffd700', label: 'REROUTING',   pulse: true  },
  distressed:        { color: '#ff4444', label: 'DISTRESSED',  pulse: true  },
  stranded:          { color: '#ff6600', label: 'STRANDED',    pulse: true  },
  out_of_fuel:       { color: '#ff0000', label: 'OUT OF FUEL', pulse: true  },
  arrived:           { color: '#44aaff', label: 'ARRIVED',     pulse: false },
  holding:           { color: '#cc88ff', label: 'HOLDING',     pulse: false },
  insufficient_fuel: { color: '#ffaa00', label: 'LOW FUEL',    pulse: true  },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || { color: '#aaa', label: status?.toUpperCase(), pulse: false };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: `${cfg.color}18`, border: `1px solid ${cfg.color}55`,
      color: cfg.color, fontSize: 10, fontWeight: 700, letterSpacing: 1.5,
      padding: '3px 8px', borderRadius: 4, fontFamily: 'var(--font-mono)',
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%', background: cfg.color,
        animation: cfg.pulse ? 'statusPulse 1.2s ease-in-out infinite' : 'none',
        boxShadow: `0 0 6px ${cfg.color}`,
      }} />
      {cfg.label}
    </span>
  );
}

function SeverityBar({ severity }) {
  const colors = { critical: '#ff2244', high: '#ff6600', medium: '#ffd700', low: '#00ff88' };
  return (
    <span style={{
      background: `${colors[severity] || '#888'}22`,
      border: `1px solid ${colors[severity] || '#888'}66`,
      color: colors[severity] || '#888',
      fontSize: 10, fontWeight: 700, letterSpacing: 1,
      padding: '2px 7px', borderRadius: 3, fontFamily: 'var(--font-mono)',
    }}>
      {severity?.toUpperCase()}
    </span>
  );
}

function FuelBar({ fuel, maxFuel = 6000 }) {
  const pct = Math.min(100, Math.max(0, (fuel / maxFuel) * 100));
  const color = pct > 50 ? '#00ff88' : pct > 20 ? '#ffd700' : '#ff4444';
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#6a8caa', marginBottom: 3 }}>
        <span>FUEL</span><span style={{ color }}>{fuel?.toFixed(0)} t</span>
      </div>
      <div style={{ height: 4, background: '#0a1628', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.5s ease', boxShadow: `0 0 6px ${color}` }} />
      </div>
    </div>
  );
}

export default function App() {
  const [role, setRole] = useState(null);
  const [shipId, setShipId] = useState('');
  const [state, setState] = useState({ ships: [], zones: [], alerts: [], directives: [], events: [], snapshots: [], weather: {}, config: {} });
  const [selectedShipId, setSelectedShipId] = useState('');
  const [drawing, setDrawing] = useState(false);
  const [draftZone, setDraftZone] = useState([]);
  const [directive, setDirective] = useState({ command: 'reroute_port', destination: '' });
  const [distressMessage, setDistressMessage] = useState('');
  const [timelineIndex, setTimelineIndex] = useState(null);
  const [activeTab, setActiveTab] = useState('ship');
  const [tick, setTick] = useState(0);
  const socketRef = useRef(null);

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const selectedShip = useMemo(() => {
    const id = role === 'captain' ? shipId : selectedShipId;
    return state.ships.find((item) => item.shipId === id) || null;
  }, [role, shipId, selectedShipId, state.ships]);

  const isCommand = role === 'command';

  const wind = state.weather?.current?.windspeed;
  const rain = state.weather?.current?.precipitation;

  useEffect(() => {
    const socket = io(API_BASE, { transports: ['websocket'] });
    socketRef.current = socket;
    socket.on('state.update', (payload) => {
      setState(payload);
      if (!selectedShipId && payload.ships.length > 0) {
        setSelectedShipId(payload.ships[0].shipId);
      }
    });
    return () => socket.disconnect();
  }, []);

  const currentSnapshot = timelineIndex !== null && state.snapshots?.[timelineIndex];
  const displayState = currentSnapshot
    ? { ...state, ships: currentSnapshot.ships, zones: currentSnapshot.zones, alerts: currentSnapshot.alerts }
    : state;

  const portOptions = state.config.ports || [];

  async function postAction(path, payload) {
    await fetch(`${API_BASE}/api/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async function handleZoneSubmit() {
    if (draftZone.length < 3) return;
    await postAction('zones', { polygon: [...draftZone, draftZone[0]], name: `Zone ${state.zones.length + 1}` });
    setDrawing(false);
    setDraftZone([]);
  }

  async function handleDirectiveSubmit() {
    if (!selectedShip) return;
    await postAction('directives', {
      shipId: selectedShip.shipId,
      command: directive.command,
      payload: directive.command === 'reroute_port' ? { destination: directive.destination } : {},
    });
  }

  async function handleAccept(directiveId) {
    await postAction('captain-response', { directiveId, response: 'accept' });
  }

  async function handleEscalate(directiveId) {
    if (!distressMessage) return;
    await postAction('captain-response', { directiveId, response: 'escalate', message: distressMessage });
    setDistressMessage('');
  }

  async function handleAck(alertId) {
    await postAction('alerts/ack', { alertId });
  }

  const windspeed = state.weather?.current?.windspeed ?? 0;
  const precipitation = state.weather?.current?.precipitation ?? 0;
  const isAdverse = windspeed >= 15 || precipitation >= 2;
  const now = new Date();
  const timeStr = now.toUTCString().slice(17, 25);

  // ── LOGIN SCREENS ─────────────────────────────────────────────────────────
  if (!role) {
    return (
      <div className="login-bg">
        <div className="login-box">
          <div className="login-logo">
            <span className="logo-icon">⬡</span>
            <span>FLEET COMMAND</span>
          </div>
          <div className="login-sub">STRAIT OF HORMUZ OPERATIONS</div>
          <div className="login-divider" />
          <p className="login-hint">SELECT OPERATIONAL ROLE TO AUTHENTICATE</p>
          <div className="login-btns">
            <button className="role-btn command-btn" onClick={() => setRole('command')}>
              <span className="role-icon">⊕</span>
              <span className="role-label">COMMAND</span>
              <span className="role-desc">Fleet-wide control & oversight</span>
            </button>
            <button className="role-btn captain-btn" onClick={() => setRole('captain')}>
              <span className="role-icon">◎</span>
              <span className="role-label">CAPTAIN</span>
              <span className="role-desc">Single vessel operations</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (role === 'captain' && !shipId) {
    return (
      <div className="login-bg">
        <div className="login-box">
          <div className="login-logo">
            <span className="logo-icon">◎</span>
            <span>CAPTAIN LOGIN</span>
          </div>
          <div className="login-sub">SELECT YOUR VESSEL TO PROCEED</div>
          <div className="login-divider" />
          <select className="styled-select" value={shipId} onChange={(e) => setShipId(e.target.value)}>
            <option value="">— SELECT VESSEL —</option>
            {state.ships.map((ship) => (
              <option key={ship.shipId} value={ship.shipId}>
                {ship.name} · {ship.shipId}
              </option>
            ))}
          </select>
          <button className="role-btn command-btn" style={{ marginTop: 16, width: '100%' }}
            onClick={() => shipId && setRole('captain')} disabled={!shipId}>
            <span className="role-label">AUTHENTICATE</span>
          </button>
        </div>
      </div>
    );
  }

  // ── MAIN DASHBOARD ────────────────────────────────────────────────────────
  const tabs = isCommand
    ? [{ id: 'ship', label: 'VESSEL' }, { id: 'zones', label: 'ZONES' }, { id: 'directives', label: 'DIRECTIVES' }, { id: 'alerts', label: `ALERTS${state.alerts.length ? ` (${state.alerts.length})` : ''}` }, { id: 'timeline', label: 'PLAYBACK' }]
    : [{ id: 'ship', label: 'MY VESSEL' }, { id: 'alerts', label: `ALERTS${state.alerts.length ? ` (${state.alerts.length})` : ''}` }, { id: 'timeline', label: 'PLAYBACK' }];

  return (
    <div className="app-shell">
      {/* ── SIDEBAR ── */}
      <aside className="sidebar">
        {/* Header */}
        <div className="sidebar-header">
          <div className="hdr-top">
            <span className="hdr-logo">⬡ FLEET CMD</span>
            <span className="hdr-time">{timeStr} UTC</span>
          </div>
          <div className="hdr-meta">
            <span className="meta-tag">{isCommand ? '⊕ COMMAND' : '◎ CAPTAIN'}</span>
            {role === 'captain' && <span className="meta-tag">{shipId}</span>}
            <span className={`meta-tag ${isAdverse ? 'tag-warn' : 'tag-ok'}`}>
              {isAdverse ? '⚠ ADVERSE' : '✓ CLEAR'} WX
            </span>
          </div>
        </div>

        {/* Weather strip */}
        <div className="wx-strip">
          <div className="wx-item">
            <span className="wx-label">WIND</span>
            <span className="wx-val" style={{ color: windspeed >= 15 ? '#ffd700' : '#00ff88' }}>{windspeed} km/h</span>
          </div>
          <div className="wx-sep" />
          <div className="wx-item">
            <span className="wx-label">PRECIP</span>
            <span className="wx-val" style={{ color: precipitation >= 2 ? '#ffd700' : '#00ff88' }}>{precipitation} mm</span>
          </div>
          <div className="wx-sep" />
          <div className="wx-item">
            <span className="wx-label">SHIPS</span>
            <span className="wx-val">{state.ships.length}</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="tab-row">
          {tabs.map(t => (
            <button key={t.id} className={`tab-btn ${activeTab === t.id ? 'tab-active' : ''}`}
              onClick={() => setActiveTab(t.id)}>{t.label}</button>
          ))}
        </div>

        {/* Tab: VESSEL */}
        {activeTab === 'ship' && (
          <div className="tab-content">
            {isCommand && (
              <select className="styled-select" value={selectedShipId}
                onChange={(e) => setSelectedShipId(e.target.value)}>
                {state.ships.map((s) => (
                  <option key={s.shipId} value={s.shipId}>{s.name}</option>
                ))}
              </select>
            )}
            {selectedShip ? (
              <div className="ship-card">
                <div className="ship-name">{selectedShip.name}</div>
                <div style={{ marginBottom: 10 }}><StatusBadge status={selectedShip.status} /></div>
                <FuelBar fuel={selectedShip.fuel} />
                <div className="ship-grid">
                  <div className="sg-item"><span className="sg-label">SPEED</span><span className="sg-val">{selectedShip.speed} kn</span></div>
                  <div className="sg-item"><span className="sg-label">HEADING</span><span className="sg-val">{selectedShip.heading?.toFixed(0)}°</span></div>
                  <div className="sg-item"><span className="sg-label">DEST</span><span className="sg-val">{selectedShip.destination}</span></div>
                  <div className="sg-item"><span className="sg-label">CARGO</span><span className="sg-val">{selectedShip.cargo || '—'}</span></div>
                  <div className="sg-item"><span className="sg-label">LAT</span><span className="sg-val">{selectedShip.position?.[0]?.toFixed(3)}</span></div>
                  <div className="sg-item"><span className="sg-label">LNG</span><span className="sg-val">{selectedShip.position?.[1]?.toFixed(3)}</span></div>
                </div>
              </div>
            ) : (
              <div className="empty-state">No vessel selected</div>
            )}

            {/* Fleet list */}
            {isCommand && (
              <div style={{ marginTop: 12 }}>
                <div className="section-label">FLEET STATUS</div>
                <div className="fleet-list">
                  {state.ships.map(s => (
                    <div key={s.shipId}
                      className={`fleet-row ${selectedShipId === s.shipId ? 'fleet-row-active' : ''}`}
                      onClick={() => setSelectedShipId(s.shipId)}>
                      <span className="fleet-name">{s.name}</span>
                      <StatusBadge status={s.status} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Captain directives */}
            {!isCommand && selectedShip && (
              <div style={{ marginTop: 12 }}>
                <div className="section-label">PENDING DIRECTIVES</div>
                {state.directives.filter(d => d.shipId === selectedShip.shipId && d.status === 'pending').map(d => (
                  <div key={d.id} className="directive-card">
                    <div className="directive-cmd">{d.command.replace('_', ' ').toUpperCase()}</div>
                    <div className="directive-btns">
                      <button className="act-btn accept-btn" onClick={() => handleAccept(d.id)}>✓ ACCEPT</button>
                    </div>
                    <textarea className="distress-input" value={distressMessage}
                      onChange={e => setDistressMessage(e.target.value)}
                      placeholder="Escalation message..." rows={2} />
                    <button className="act-btn escalate-btn" onClick={() => handleEscalate(d.id)}>⚠ ESCALATE DISTRESS</button>
                  </div>
                ))}
                {!state.directives.some(d => d.shipId === selectedShip?.shipId && d.status === 'pending') &&
                  <div className="empty-state">No pending directives</div>}
              </div>
            )}
          </div>
        )}

        {/* Tab: ZONES (Command only) */}
        {activeTab === 'zones' && isCommand && (
          <div className="tab-content">
            <div className="section-label">RESTRICTED ZONES</div>
            <button className={`act-btn ${drawing ? 'cancel-btn' : 'draw-btn'}`}
              style={{ width: '100%', marginBottom: 10 }}
              onClick={() => { setDrawing(!drawing); setDraftZone([]); }}>
              {drawing ? '✕ CANCEL DRAWING' : '+ DRAW ZONE'}
            </button>
            {drawing && (
              <div className="draw-hint">
                <p>Click on map to add boundary points</p>
                <p className="hint-count">{draftZone.length} points added</p>
                <button className="act-btn accept-btn" style={{ width: '100%' }}
                  onClick={handleZoneSubmit} disabled={draftZone.length < 3}>
                  ✓ SAVE ZONE ({draftZone.length} pts)
                </button>
              </div>
            )}
            <div className="zone-list-ui">
              {state.zones.length === 0 && <div className="empty-state">No active zones</div>}
              {state.zones.map(z => (
                <div key={z.id} className="zone-row">
                  <span className="zone-dot" />
                  <span className="zone-name">{z.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab: DIRECTIVES (Command only) */}
        {activeTab === 'directives' && isCommand && (
          <div className="tab-content">
            <div className="section-label">ISSUE DIRECTIVE</div>
            <select className="styled-select" value={selectedShipId}
              onChange={e => setSelectedShipId(e.target.value)}>
              {state.ships.map(s => (
                <option key={s.shipId} value={s.shipId}>{s.name}</option>
              ))}
            </select>
            <select className="styled-select" value={directive.command}
              onChange={e => setDirective({ ...directive, command: e.target.value })}>
              <option value="reroute_port">REROUTE TO PORT</option>
              <option value="hold_position">HOLD POSITION</option>
            </select>
            {directive.command === 'reroute_port' && (
              <select className="styled-select" value={directive.destination}
                onChange={e => setDirective({ ...directive, destination: e.target.value })}>
                <option value="">— SELECT PORT —</option>
                {portOptions.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
            <button className="act-btn accept-btn" style={{ width: '100%' }}
              onClick={handleDirectiveSubmit}
              disabled={!selectedShip || (directive.command === 'reroute_port' && !directive.destination)}>
              ⊕ TRANSMIT DIRECTIVE
            </button>

            <div className="section-label" style={{ marginTop: 16 }}>DIRECTIVE LOG</div>
            <div className="directive-log">
              {state.directives.slice(-8).reverse().map(d => (
                <div key={d.id} className="log-row">
                  <span className="log-ship">{d.shipId}</span>
                  <span className="log-cmd">{d.command.replace('_', ' ')}</span>
                  <span className={`log-status status-${d.status}`}>{d.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab: ALERTS */}
        {activeTab === 'alerts' && (
          <div className="tab-content">
            <div className="section-label">ACTIVE ALERTS — {state.alerts.length}</div>
            {state.alerts.length === 0 && <div className="empty-state">✓ All systems nominal</div>}
            {state.alerts.map(alert => (
              <div key={alert.id} className={`alert-card alert-${alert.severity}`}>
                <div className="alert-top">
                  <SeverityBar severity={alert.severity} />
                  <span className="alert-type">{alert.type?.toUpperCase()}</span>
                </div>
                <p className="alert-msg">{alert.message}</p>
                <button className="act-btn ack-btn" onClick={() => handleAck(alert.id)}>✓ ACKNOWLEDGE</button>
              </div>
            ))}
          </div>
        )}

        {/* Tab: TIMELINE */}
        {activeTab === 'timeline' && (
          <div className="tab-content">
            <div className="section-label">MISSION PLAYBACK</div>
            <div className="timeline-wrap">
              <input type="range" className="timeline-slider"
                min={0} max={Math.max(0, state.snapshots.length - 1)}
                value={timelineIndex ?? state.snapshots.length - 1}
                onChange={e => setTimelineIndex(Number(e.target.value))} />
              <div className="timeline-labels">
                <span>T-60m</span><span>LIVE</span>
              </div>
              <div className="timeline-ts">
                {currentSnapshot
                  ? new Date(currentSnapshot.timestamp).toUTCString().slice(0, 25)
                  : '▶ LIVE FEED'}
              </div>
              {timelineIndex !== null && (
                <button className="act-btn accept-btn" style={{ width: '100%', marginTop: 8 }}
                  onClick={() => setTimelineIndex(null)}>
                  ▶ RETURN TO LIVE
                </button>
              )}
            </div>
            <div className="section-label" style={{ marginTop: 16 }}>RECENT EVENTS</div>
            <div className="event-log">
              {state.events.slice(-15).reverse().map(ev => (
                <div key={ev.id} className="ev-row">
                  <span className="ev-time">{new Date(ev.timestamp).toUTCString().slice(17, 25)}</span>
                  <span className="ev-type">{ev.type}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>

      {/* ── MAP ── */}
      <main className="map-holder">
        {timelineIndex !== null && (
          <div className="playback-banner">
            ⏪ PLAYBACK MODE — {currentSnapshot ? new Date(currentSnapshot.timestamp).toUTCString().slice(0, 25) : ''}
          </div>
        )}
        <MapContainer center={[26.0, 55.2]} zoom={6} scrollWheelZoom
          style={{ height: '100vh', width: '100%' }}>
          <TileLayer
            attribution="&copy; OpenStreetMap"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Polygon pathOptions={{ color: '#3caaff', fillOpacity: 0.06, weight: 1 }}
            positions={state.config.water || []} />
          {displayState.zones?.map(zone => (
            <Polygon key={zone.id}
              pathOptions={{ color: '#ff4444', fillOpacity: 0.18, weight: 2, dashArray: '6 4' }}
              positions={zone.polygon} />
          ))}
          {displayState.ships?.map(ship => (
            <Marker key={ship.shipId} position={ship.position}>
              <Popup className="ship-popup">
                <div style={{ minWidth: 180 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{ship.name}</div>
                  <StatusBadge status={ship.status} />
                  <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.8, color: '#ccc' }}>
                    <div>⛽ Fuel: {ship.fuel?.toFixed(0)} t</div>
                    <div>⚡ Speed: {ship.speed} kn</div>
                    <div>🧭 Heading: {ship.heading?.toFixed(0)}°</div>
                    <div>📍 Dest: {ship.destination}</div>
                    <div>📦 Cargo: {ship.cargo || '—'}</div>
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}
          {displayState.ships?.map(ship =>
            ship.path?.length > 0 ? (
              <Polyline key={`${ship.shipId}-r`}
                pathOptions={{ color: '#00ff88', opacity: 0.5, weight: 1.5, dashArray: '4 6' }}
                positions={[ship.position, ...ship.path]} />
            ) : null
          )}
          {draftZone.length > 0 && (
            <Polygon pathOptions={{ color: '#ffd700', fillOpacity: 0.1, dashArray: '6' }}
              positions={draftZone} />
          )}
          {drawing && <MapClickHandler drawing={drawing}
            onNewPoint={pt => setDraftZone([...draftZone, pt])} />}
        </MapContainer>
      </main>
    </div>
  );
}
