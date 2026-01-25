import http from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { setupSockets } from "./sockets/index.js"; //listeners and auth
import { setIO } from "./sockets/io.js"; //global io var

// Express is still our normal HTTP/REST app.
const app = createApp();

// IMPORTANT:
// Socket.IO needs access to the underlying HTTP server.
// So instead of `app.listen(...)`, we create the HTTP server ourselves.
const httpServer = http.createServer(app);

// Create the Socket.IO server on the same port as Express.
// That means the browser connects to the same host/port, just with the Socket.IO path.
const io = new SocketIOServer(httpServer, {
  cors: {
    // In dev, your client is typically http://localhost:5173
    // This must match your Express CORS rules.
    origin: env.clientOrigin,
    credentials: true,
  },
});

// Store io in a shared place so REST routes can emit events.
setIO(io);

// Register auth + connection handlers.
setupSockets(io);

httpServer.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${env.port}`);
  // eslint-disable-next-line no-console
  console.log(`Socket.IO listening on ws://localhost:${env.port}`);

});


