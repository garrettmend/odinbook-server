import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { prisma } from "../db/prisma.js";
import { getIO } from "../sockets/io.js";
import { createAndEmitNotification } from "../sockets/notify.js";

export const friendsRouter = Router();

// NOTE: This router is intended to be mounted at /api/friends
// so routes here are:
// - POST /api/friends/requests/:receiverId
// - POST /api/friends/requests/:requestId/accept
// - POST /api/friends/requests/:requestId/reject
// - POST /api/friends/requests/:requestId/cancel
// - GET  /api/friends/requests/received
// - GET  /api/friends/requests/sent
// - GET  /api/friends (accepted friends list)

function publicUserSelect() {
  return {
    id: true,
    name: true,
    avatarUrl: true,
    bio: true,
  };
}

// POST /api/friends/requests/:receiverId
// Sends a friend request (PENDING). If the other user already sent you a pending request,
// we accept it instead.
friendsRouter.post("/requests/:receiverId", requireAuth, async (req, res, next) => {
  try {
    const senderId = req.user.id;
    const receiverId = req.params.receiverId;

    if (!receiverId) return res.status(400).json({ error: "receiverId is required" });
    if (senderId === receiverId) {
      return res.status(400).json({ error: "cannot friend yourself" });
    }

    // Find an existing request in either direction.
    const existing = await prisma.friendRequest.findFirst({
      where: {
        OR: [
          { senderId, receiverId },
          { senderId: receiverId, receiverId: senderId },
        ],
      },
      select: {
        id: true,
        senderId: true,
        receiverId: true,
        status: true,
      },
    });

    if (existing) {
      if (existing.status === "ACCEPTED") {
        return res.status(409).json({ error: "already friends" });
      }

      if (existing.status === "PENDING") {
        // If you already sent one, don't create another.
        if (existing.senderId === senderId) {
          return res.status(409).json({ error: "friend request already sent" });
        }

        // They sent you a pending request; accept it.
        const updated = await prisma.friendRequest.update({
          where: { id: existing.id },
          data: { status: "ACCEPTED" },
          select: {
            id: true,
            status: true,
            senderId: true,
            receiverId: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        // Notify the original sender that their request was accepted
        try {
          const io = getIO();
          await createAndEmitNotification(io, {
            userId: updated.senderId,
            type: 'friend_request_accepted',
            data: {
              requestId: updated.id,
              accepterId: senderId,
              accepterName: req.user.name,
              link: `/users/${senderId}`,
            },
          });
        } catch (err) {
          console.log("[friend request accept auto] notification failed", err?.message ?? err);
        }

        return res.json({ friendRequest: updated });
      }

      // REJECTED: allow "re-request" by turning this record back into a pending request.
      // We also normalize direction so the current user is the sender.
      const updated = await prisma.friendRequest.update({
        where: { id: existing.id },
        data: {
          senderId,
          receiverId,
          status: "PENDING",
        },
        select: {
          id: true,
          status: true,
          senderId: true,
          receiverId: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return res.status(201).json({ friendRequest: updated });
    }

    // No existing record: create a new pending request.
    const created = await prisma.friendRequest.create({
      data: {
        senderId,
        receiverId,
        status: "PENDING",
      },
      select: {
        id: true,
        status: true,
        senderId: true,
        receiverId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Create notification for the receiver
    try {
      const io = getIO();
      await createAndEmitNotification(io, {
        userId: receiverId,
        type: 'friend_request',
        data: {
          requestId: created.id,
          senderId,
          senderName: req.user.name, // Assuming req.user has name
            link: `/users/${senderId}`,
        },
      });
    } catch (err) {
      console.log("[friend request] notification failed", err?.message ?? err);
    }

    res.status(201).json({ friendRequest: created });
  } catch (err) {
    next(err);
  }
});

// POST /api/friends/requests/:requestId/accept
friendsRouter.post("/requests/:requestId/accept", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const requestId = req.params.requestId;

    const request = await prisma.friendRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        status: true,
        receiverId: true,
      },
    });

    if (!request) return res.status(404).json({ error: "friend request not found" });
    if (request.receiverId !== userId) {
      return res.status(403).json({ error: "only the receiver can accept" });
    }
    if (request.status !== "PENDING") {
      return res.status(409).json({ error: `cannot accept request in status ${request.status}` });
    }

    const updated = await prisma.friendRequest.update({
      where: { id: requestId },
      data: { status: "ACCEPTED" },
      select: {
        id: true,
        status: true,
        senderId: true,
        receiverId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Create notification for the sender that their request was accepted
    try {
      const io = getIO();
      await createAndEmitNotification(io, {
        userId: updated.senderId,
        type: 'friend_request_accepted',
        data: {
          requestId: updated.id,
          accepterId: userId,
          accepterName: req.user.name,
            link: `/users/${userId}`,
        },
      });
    } catch (err) {
      console.log("[friend request accept] notification failed", err?.message ?? err);
    }

    res.json({ friendRequest: updated });
  } catch (err) {
    next(err);
  }
});

// POST /api/friends/requests/:requestId/reject
friendsRouter.post("/requests/:requestId/reject", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const requestId = req.params.requestId;

    const request = await prisma.friendRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        status: true,
        receiverId: true,
      },
    });

    if (!request) return res.status(404).json({ error: "friend request not found" });
    if (request.receiverId !== userId) {
      return res.status(403).json({ error: "only the receiver can reject" });
    }
    if (request.status !== "PENDING") {
      return res.status(409).json({ error: `cannot reject request in status ${request.status}` });
    }

    const updated = await prisma.friendRequest.update({
      where: { id: requestId },
      data: { status: "REJECTED" },
      select: {
        id: true,
        status: true,
        senderId: true,
        receiverId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json({ friendRequest: updated });
  } catch (err) {
    next(err);
  }
});

// POST /api/friends/requests/:requestId/cancel
// Sender cancels their own pending request.
friendsRouter.post("/requests/:requestId/cancel", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const requestId = req.params.requestId;

    const request = await prisma.friendRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        status: true,
        senderId: true,
      },
    });

    if (!request) return res.status(404).json({ error: "friend request not found" });
    if (request.senderId !== userId) {
      return res.status(403).json({ error: "only the sender can cancel" });
    }
    if (request.status !== "PENDING") {
      return res.status(409).json({ error: `cannot cancel request in status ${request.status}` });
    }

    await prisma.friendRequest.delete({ where: { id: requestId } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/friends/requests/received?status=PENDING
friendsRouter.get("/requests/received", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const status = (req.query.status ?? "PENDING").toString();

    const requests = await prisma.friendRequest.findMany({
      where: {
        receiverId: userId,
        status,
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        createdAt: true,
        sender: { select: publicUserSelect() },
      },
    });

    res.json({ requests });
  } catch (err) {
    next(err);
  }
});

// GET /api/friends/requests/sent?status=PENDING
friendsRouter.get("/requests/sent", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const status = (req.query.status ?? "PENDING").toString();

    const requests = await prisma.friendRequest.findMany({
      where: {
        senderId: userId,
        status,
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        createdAt: true,
        receiver: { select: publicUserSelect() },
      },
    });

    res.json({ requests });
  } catch (err) {
    next(err);
  }
});

// GET /api/friends
// Returns all accepted friends for the current user.
friendsRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;

    const accepted = await prisma.friendRequest.findMany({
      where: {
        status: "ACCEPTED",
        OR: [{ senderId: userId }, { receiverId: userId }],
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        senderId: true,
        receiverId: true,
        sender: { select: publicUserSelect() },
        receiver: { select: publicUserSelect() },
      },
    });

    // Normalize to "the other user".
    const friends = accepted.map((fr) => {
      const other = fr.senderId === userId ? fr.receiver : fr.sender;
      return { friendRequestId: fr.id, user: other };
    });

    res.json({ friends });
  } catch (err) {
    next(err);
  }
});
// gets status of a friend request with another user
// returns one of: PENDING | ACCEPTED | REJECTED | NONE
friendsRouter.get("/requests/:receiverId/status", requireAuth, async (req, res, next) => {
  try {
    const senderId = req.user.id;
    const receiverId = req.params.receiverId;

    const friendRequest = await prisma.friendRequest.findFirst({
      where: {
        OR: [
          { senderId, receiverId },
          { senderId: receiverId, receiverId: senderId },
        ],
      },
      select: {
        id: true,
        senderId: true,
        receiverId: true,
        status: true,
      },
    });

    if (!friendRequest) return res.json({ status: "NONE" });

    const direction = friendRequest.senderId === senderId ? "SENT" : "RECEIVED";
    return res.json({
      status: friendRequest.status,
      requestId: friendRequest.id,
      direction,
    });
  } catch (err) {
    next(err);
  }
});

friendsRouter.delete("/requests/:receiverId/remove", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const receiverId = req.params.receiverId;

    const existing = await prisma.friendRequest.findFirst({
      where: {
        OR: [
          { senderId: userId, receiverId },
          { senderId: receiverId, receiverId: userId },
        ],
        status: "ACCEPTED",
      },
      select: {
        id: true,
      },
    });
    if (!existing) {
      return res.status(404).json({ error: "friendship not found" });
    }
    await prisma.friendRequest.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

friendsRouter.get("/:userId", requireAuth, async (req, res, next) => {
  try {
    const userId = req.params.userId;
    if (!userId) return res.status(400).json({ error: "userId is required" });

    const friends = await prisma.friendRequest.findMany({
      where: {
        status: "ACCEPTED",
        OR: [{ senderId: userId }, { receiverId: userId }],
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        updatedAt: true,
        senderId: true,
        receiverId: true,
        sender: { select: publicUserSelect() },
        receiver: { select: publicUserSelect() },
      },
    });

    res.json({ friends });
  } catch (err) {
    next(err);
  }
});
