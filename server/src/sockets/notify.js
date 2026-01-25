import { prisma } from "../db/prisma.js";

/**
 * Create a notification record and attempt immediate delivery via Socket.IO.
 *
 * Params:
 * - io: Socket.IO server instance
 * - userId: recipient id
 * - type: string type of notification (e.g. 'message', 'conversation')
 * - data: arbitrary JSON payload
 */
export async function createAndEmitNotification(io, { userId, type, data }) {
  // Persist notification (unread by default)
  const notification = await prisma.notification.create({
    data: {
      userId,
      type,
      data,
    },
  });

  console.log(`[notify] Created notification ${notification.id} for user ${userId}: ${type}`);

  try {
    // Check whether the user's room exists (i.e., they're online)
    const room = io.sockets.adapter.rooms.get(`user:${userId}`);
    const isOnline = room && room.size > 0;
    console.log(`[notify] User ${userId} is ${isOnline ? 'online' : 'offline'}`);
    if (isOnline) {
      io.to(`user:${userId}`).emit("notification:new", { notification });
      console.log(`[notify] Emitted notification:new to user ${userId}`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.log("[notify] emit failed", err?.message ?? err);
  }

  return notification;
}
