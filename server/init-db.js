const fs = require('fs');
const path = require('path');
const db = require('./db');

const fleetPath = path.join(__dirname, 'fleet.json');
const fleetJson = JSON.parse(fs.readFileSync(fleetPath, 'utf8'));

async function ensureSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS ships (
      ship_id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS zones (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS directives (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY,
      timestamp TIMESTAMPTZ NOT NULL,
      data JSONB NOT NULL
    );
  `);
}

async function seedShips() {
  const result = await db.query('SELECT COUNT(*) FROM ships');
  if (parseInt(result.rows[0].count, 10) > 0) {
    return;
  }

  const ships = fleetJson.fleet.map((ship) => ({
    ...ship,
    path: [ship.position],
    heading: ship.heading,
    lastStatus: ship.status || 'normal',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    routeStatus: 'direct',
    assignedCaptain: ship.shipId,
  }));

  const insertText = 'INSERT INTO ships(ship_id, data) VALUES($1, $2)';
  for (const ship of ships) {
    await db.query(insertText, [ship.shipId, ship]);
  }
}

module.exports = {
  ensureSchema,
  seedShips,
  getInitialConfig: () => ({
    ports: fleetJson.ports,
    water: fleetJson.navigableWater,
    scenario: fleetJson.scenario,
  }),
};
