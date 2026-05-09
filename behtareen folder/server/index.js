require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const simulator = require('./simulator');

const PORT = process.env.PORT || 4000;
const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    methods: ['GET', 'POST'],
  },
});

io.on('connection', (socket) => {
  socket.emit('state.update', simulator.getState());
  socket.on('disconnect', () => {
    console.log(`socket disconnected: ${socket.id}`);
  });
});

app.get('/api/config', (req, res) => {
  res.json({ config: simulator.getState().config });
});

app.get('/api/state', (req, res) => {
  res.json(simulator.getState());
});

app.get('/api/timeline', (req, res) => {
  const state = simulator.getState();
  res.json({ snapshots: state.snapshots, events: state.events });
});

app.post('/api/zones', async (req, res) => {
  try {
    const zone = await simulator.addZone(req.body);
    io.emit('state.update', simulator.getState());
    res.json(zone);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/directives', async (req, res) => {
  try {
    const directive = await simulator.postDirective(req.body);
    io.emit('state.update', simulator.getState());
    res.json(directive);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/captain-response', async (req, res) => {
  try {
    const directive = await simulator.captainResponse(req.body);
    io.emit('state.update', simulator.getState());
    res.json(directive);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/alerts/ack', async (req, res) => {
  try {
    const alert = await simulator.ackAlert(req.body.alertId);
    io.emit('state.update', simulator.getState());
    res.json(alert);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

server.listen(PORT, async () => {
  console.log(`Backend listening on port ${PORT}`);
  try {
    await simulator.initialize(io);
    console.log('Simulator initialized');
  } catch (error) {
    console.error('Simulator failed to initialize', error);
    process.exit(1);
  }
});
