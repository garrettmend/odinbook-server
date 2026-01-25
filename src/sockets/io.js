/**
 * Socket.IO instance holder (learner-friendly).
 *
 * Problem we're solving:
 * - Your Express routes (REST) live in separate files.
 * - The Socket.IO server instance (`io`) is created in server startup.
 *
 * We want REST routes to be able to do things like:
 *   getIO().to(`user:${receiverId}`).emit('inbox:update', payload)
 *
 * This file is a tiny "bridge" so routes can access the same `io` instance.
 */

let ioInstance = null;

// Called ONCE at server startup (in server/src/index.js)
export function setIO(io) {
  ioInstance = io;
}

// Called inside routes/handlers when you want to emit events.
export function getIO() {
  if (!ioInstance) {
    throw new Error(
      "Socket.IO has not been initialized yet. Did you forget to call setIO(io) in server startup?",
    );
  }
  return ioInstance;
}
