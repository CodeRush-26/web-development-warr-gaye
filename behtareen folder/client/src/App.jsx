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

function App() {
  const [role, setRole] = useState(null);
  const [shipId, setShipId] = useState('');
  const [state, setState] = useState({ ships: [], zones: [], alerts: [], directives: [], events: [], snapshots: [], weather: {}, config: {} });
  const [selectedShipId, setSelectedShipId] = useState('');
  const [drawing, setDrawing] = useState(false);
  const [draftZone, setDraftZone] = useState([]);
  const [directive, setDirective] = useState({ command: 'reroute_port', destination: '' });
  const [distressMessage, setDistressMessage] = useState('');
  const [timelineIndex, setTimelineIndex] = useState(null);
  const socketRef = useRef(null);

  const selectedShip = useMemo(() => {
    const id = role === 'captain' ? shipId : selectedShipId;
    return state.ships.find((item) => item.shipId === id) || null;
  }, [role, shipId, selectedShipId, state.ships]);

  const isCommand = role === 'command';
  const canDraw = isCommand;

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
    await postAction('zones', { polygon: [...draftZone, draftZone[0]], name: `Restricted zone ${state.zones.length + 1}` });
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
    setDirective({ ...directive, payload: {} });
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

  const tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const center = [26.0, 55.2];

  if (!role) {
    return (
      <div className="login-card panel">
        <h1>Fleet Command Interface</h1>
        <p>Select your role to join the simulation.</p>
        <button className="btn" onClick={() => setRole('command')} style={{ marginRight: 12 }}>
          Command
        </button>
        <button className="btn" onClick={() => setRole('captain')}>
          Captain
        </button>
      </div>
    );
  }

  if (role === 'captain' && !shipId) {
    return (
      <div className="login-card panel">
        <h1>Captain Login</h1>
        <p>Choose the ship you command.</p>
        <select value={shipId} onChange={(e) => setShipId(e.target.value)}>
          <option value="">Select ship</option>
          {state.ships.map((ship) => (
            <option key={ship.shipId} value={ship.shipId}>
              {ship.name} ({ship.shipId})
            </option>
          ))}
        </select>
        <button className="btn" onClick={() => shipId && setRole('captain')} disabled={!shipId}>
          Join as Captain
        </button>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="panel">
          <h2>{isCommand ? 'Command Dashboard' : 'Captain Dashboard'}</h2>
          <p>Role: <strong>{role}</strong></p>
          {role === 'captain' && <p>Ship: <strong>{shipId}</strong></p>}
          <p>Weather: <strong>{state.weather?.current ? `${state.weather.current.windspeed} km/h wind, ${state.weather.current.precipitation} mm rain` : 'loading'}</strong></p>
          <p>Risk Level: <strong>{state.weather?.current ? (state.weather.current.windspeed >= 15 || state.weather.current.precipitation >= 2 ? 'Adverse' : 'Normal') : '—'}</strong></p>
        </div>

        <div className="panel">
          <h3>Selected Ship</h3>
          {selectedShip ? (
            <div>
              <p><strong>{selectedShip.name}</strong></p>
              <p>Status: {selectedShip.status}</p>
              <p>Fuel: {selectedShip.fuel.toFixed(0)}</p>
              <p>Speed: {selectedShip.speed} knots</p>
              <p>Destination: {selectedShip.destination}</p>
              <p>Cargo: {selectedShip.cargo}</p>
            </div>
          ) : (
            <p>No ship selected</p>
          )}
        </div>

        {isCommand && (
          <div className="panel">
            <h3>Zone Control</h3>
            <button className="btn" onClick={() => setDrawing(!drawing)}>
              {drawing ? 'Cancel zone drawing' : 'Draw restricted zone'}
            </button>
            {drawing && (
              <div>
                <p>Click map to add points.</p>
                <button className="btn btn-secondary" onClick={handleZoneSubmit} disabled={draftZone.length < 3}>
                  Save zone
                </button>
              </div>
            )}
            {draftZone.length > 0 && <p>{draftZone.length} points added</p>}
          </div>
        )}

        {isCommand && (
          <div className="panel">
            <h3>Issue Directive</h3>
            <select value={selectedShipId} onChange={(e) => setSelectedShipId(e.target.value)}>
              {state.ships.map((ship) => (
                <option key={ship.shipId} value={ship.shipId}>
                  {ship.name} ({ship.shipId})
                </option>
              ))}
            </select>
            <select value={directive.command} onChange={(e) => setDirective({ ...directive, command: e.target.value })}>
              <option value="reroute_port">Reroute to port</option>
              <option value="hold_position">Hold position</option>
            </select>
            {directive.command === 'reroute_port' && (
              <select value={directive.destination} onChange={(e) => setDirective({ ...directive, destination: e.target.value })}>
                <option value="">Select destination</option>
                {portOptions.map((port) => (
                  <option key={port.id} value={port.id}>
                    {port.name}
                  </option>
                ))}
              </select>
            )}
            <button className="btn" onClick={handleDirectiveSubmit} disabled={!selectedShip || (directive.command === 'reroute_port' && !directive.destination)}>
              Send directive
            </button>
          </div>
        )}

        {!isCommand && selectedShip && (
          <div className="panel">
            <h3>Captain Response</h3>
            {state.directives.filter((d) => d.shipId === selectedShip.shipId && d.status === 'pending').map((directiveItem) => (
              <div key={directiveItem.id} className="event-item">
                <p><strong>Directive</strong></p>
                <p>{directiveItem.command}</p>
                <button className="btn" onClick={() => handleAccept(directiveItem.id)}>Accept</button>
                <textarea value={distressMessage} onChange={(e) => setDistressMessage(e.target.value)} placeholder="Escalate with notes" />
                <button className="btn btn-danger" onClick={() => handleEscalate(directiveItem.id)}>Escalate distress</button>
              </div>
            ))}
            {!state.directives.some((d) => d.shipId === selectedShip.shipId && d.status === 'pending') && <p>No pending directives.</p>}
          </div>
        )}

        <div className="panel">
          <h3>Active Alerts</h3>
          <ul className="event-list">
            {state.alerts.map((alert) => (
              <li key={alert.id} className="event-item">
                <strong>{alert.severity.toUpperCase()}</strong>
                <p>{alert.message}</p>
                <button className="btn btn-secondary" onClick={() => handleAck(alert.id)}>Acknowledge</button>
              </li>
            ))}
            {state.alerts.length === 0 && <li className="event-item">No active alerts.</li>}
          </ul>
        </div>

        <div className="panel">
          <h3>Timeline</h3>
          <input
            type="range"
            min={0}
            max={Math.max(0, state.snapshots.length - 1)}
            value={timelineIndex ?? state.snapshots.length - 1}
            onChange={(e) => setTimelineIndex(Number(e.target.value))}
          />
          <p>{currentSnapshot ? currentSnapshot.timestamp : 'Live'}</p>
        </div>
      </aside>

      <main className="map-holder">
        <MapContainer center={center} zoom={6} scrollWheelZoom style={{ height: '100vh', width: '100%' }}>
          <TileLayer attribution="&copy; OpenStreetMap contributors" url={tileUrl} />
          <Polygon pathOptions={{ color: '#3caaff', fillOpacity: 0.08 }} positions={state.config.water || []} />
          {displayState.zones?.map((zone) => (
            <Polygon key={zone.id} pathOptions={{ color: '#ff5e5e', fillOpacity: 0.14 }} positions={zone.polygon} />
          ))}
          {displayState.ships?.map((ship) => (
            <Marker key={ship.shipId} position={ship.position}>
              <Popup>
                <strong>{ship.name}</strong>
                <div>Status: {ship.status}</div>
                <div>Fuel: {ship.fuel.toFixed(0)}</div>
                <div>Destination: {ship.destination}</div>
              </Popup>
            </Marker>
          ))}
          {displayState.ships?.map((ship) => ship.path && ship.path.length > 0 && (
            <Polyline key={`${ship.shipId}-route`} pathOptions={{ color: '#68d1ff' }} positions={[ship.position, ...ship.path]} />
          ))}
          {draftZone.length > 0 && <Polygon pathOptions={{ color: '#ffcc00', dashArray: '6' }} positions={draftZone} />}
          {drawing && <MapClickHandler drawing={drawing} onNewPoint={(point) => setDraftZone([...draftZone, point])} />}
        </MapContainer>
      </main>
    </div>
  );
}

export default App;
