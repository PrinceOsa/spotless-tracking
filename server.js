import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// In-memory storage for last-known location per booking
const lastKnownLocations = new Map();

// Socket.IO event handlers
io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  // Client joins a booking room
  socket.on('join-room', (bookingId) => {
    if (!bookingId) {
      console.warn(`[Socket] Missing bookingId on join-room`);
      return;
    }

    const roomName = `booking_${bookingId}`;
    socket.join(roomName);
    console.log(`[Socket] ${socket.id} joined room ${roomName}`);

    // Send last-known location if available
    if (lastKnownLocations.has(bookingId)) {
      const lastLoc = lastKnownLocations.get(bookingId);
      socket.emit('location-update', {
        ...lastLoc,
        isLastKnown: true,
      });
      console.log(`[Socket] Sent last-known location to ${socket.id} for booking ${bookingId}`);
    } else {
      socket.emit('location-update', {
        message: 'Waiting for cleaner location...',
        isLastKnown: false,
      });
    }
  });

  // Cleaner broadcasts location
  socket.on('cleaner-location', (data) => {
    const { bookingId, lat, lng, heading, accuracy, ts } = data;

    if (!bookingId) {
      console.warn(`[Socket] Missing bookingId in cleaner-location`);
      return;
    }

    // Store last-known location
    const locationData = { lat, lng, heading, accuracy, ts };
    lastKnownLocations.set(bookingId, locationData);
    console.log(
      `[Socket] Cleaner location for booking ${bookingId}: (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
    );

    // Broadcast to all clients in this booking's room
    const roomName = `booking_${bookingId}`;
    io.to(roomName).emit('location-update', {
      ...locationData,
      isLastKnown: false,
    });
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);
  });
});

// REST endpoint to clear location (for testing)
app.post('/api/clear/:bookingId', (req, res) => {
  const { bookingId } = req.params;
  lastKnownLocations.delete(Number(bookingId));
  console.log(`[API] Cleared location for booking ${bookingId}`);
  res.json({ ok: true });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`\n🚀 Spotless Tracking POC server running on http://localhost:${PORT}`);
  console.log(`📱 Cleaner: http://localhost:${PORT}/cleaner.html?booking=123`);
  console.log(`👁️  Customer: http://localhost:${PORT}/customer.html?booking=123\n`);
});
