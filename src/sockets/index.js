import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { createAndEmitNotification } from "./notify.js";

// Map to hold active intervals for demo guest conversations, actions, and posts.
// Keyed by guest user id -> { messageIntervalId, actionIntervalId, postIntervalId, conversationId, members }
const guestDemoIntervals = new Map();

/**
 * Socket.IO setup (learner-friendly).
 *
 * Why do we need this file?
 * - HTTP/REST is "request -> response".
 * - WebSockets (via Socket.IO) keep a connection open so the server can
 *   push events to the browser instantly.
 *
 * In this app we use sockets for:
 * - live chat messages
 * - live inbox updates (new message badge / previews)
 *
 * This file ONLY wires up the realtime layer.
 * Your database writes still happen in normal Express routes (REST).
 */

/**
 * Extract a JWT from different places.
 *
 * With Socket.IO, there is no normal "Authorization" header pattern like fetch.
 * The common approach is:
 * - client sends token in `socket.auth = { token }`
 * - server reads `socket.handshake.auth.token`
 */
function getTokenFromSocketHandshake(socket) {
  const authToken = socket.handshake?.auth?.token;
  if (typeof authToken === "string" && authToken.trim()) return authToken.trim();

  // Optional fallback: some clients send a raw header.
  const header = socket.handshake?.headers?.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim();
  }

  return "";
}

/**
 * Verify the JWT and return the userId.
 *
 * IMPORTANT:
 * - This uses the same JWT secret as your REST auth.
 * - We only trust the connection if the token verifies.
 */
function verifySocketJwtAndGetUserId(token) {
  // Your JWT payload uses `{ sub: userId }`.
  const payload = jwt.verify(token, env.jwtSecret);
  const userId = payload?.sub;
  if (!userId || typeof userId !== "string") {
    throw new Error("Invalid token payload (missing sub)");
  }
  return userId;
}

/**
 * Initialize socket behavior.
 *
 * This function is called from server startup after `io` is created.
 */
export function setupSockets(io) {
  // 1) Middleware runs BEFORE the 'connection' event.
  // If we call next(err), the connection is rejected.
  io.use((socket, next) => {
    try {
      const token = getTokenFromSocketHandshake(socket);
      if (!token) return next(new Error("Missing auth token"));

      const userId = verifySocketJwtAndGetUserId(token);

      // Attach user identity to the socket so handlers can use it.
      // This is not built-in — we're defining it ourselves.
      socket.data.userId = userId;

      return next();
    } catch (err) {
      return next(new Error("Invalid auth token"));
    }
  });

  // 2) Called after auth middleware passes.
  io.on("connection", (socket) => {
    const userId = socket.data.userId;

    // Rooms are Socket.IO's way of grouping connections.
    // We'll use a per-user room so the server can do:
    //   io.to(`user:${receiverId}`).emit('inbox:update', ...)
    socket.join(`user:${userId}`);

    // Learner debug: prove the socket is live + authenticated.
    // Client can listen to this to confirm it worked.
    socket.emit("socket:ready", {
      userId,
      message: "Socket connected and authenticated",
    });

    // If this connection is the guest user, ensure the demo conversation
    // exists and start the demo message interval.
    (async () => {
      try {
        const u = await prisma.user.findUnique({ where: { id: userId } });
        if (u?.email === 'guest@odinbook.test') {
          // ensure demo convo + start interval
          await ensureGuestDemo(io, userId);
        }
      } catch (err) {
        // ignore
      }
    })();

    // On connect, send any unread notifications persisted while user was offline.
    setTimeout(async () => {
      try {
        const unread = await prisma.notification.findMany({
          where: { userId, read: false },
          orderBy: { createdAt: "asc" },
          take: 100,
        });
        console.log(`[socket] Found ${unread.length} unread notifications for user ${userId} on connect`);
        if (unread && unread.length > 0) {
          socket.emit("notifications:batch", { notifications: unread });
          console.log(`[socket] Sent notifications:batch to user ${userId}`);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.log("[socket] failed to fetch unread notifications", err?.message ?? err);
      }
    }, 1000); // Delay by 1 second to allow client to set up listeners

    // Optional: join a conversation room for a specific chat.
    // We'll actually use this in the next step (chatroom).
    socket.on("conversation:join", ({ conversationId }) => {
      if (!conversationId) return;
      socket.join(`conversation:${conversationId}`);
    });

    socket.on("conversation:create", ({ participantIds }) => {
      if (!participantIds || !Array.isArray(participantIds)) return;
      
    });

    socket.on("conversation:leave", ({ conversationId }) => {
      if (!conversationId) return;
      socket.leave(`conversation:${conversationId}`);
    });

    socket.on("disconnect", (reason) => {
      // eslint-disable-next-line no-console
      console.log(`[socket] user ${userId} disconnected: ${reason}`);
      try {
        // If this user is the guest and there are no more sockets for them,
        // stop the demo interval.
        const room = io.sockets.adapter.rooms.get(`user:${userId}`);
        const hasSockets = room && room.size > 0;
        if (!hasSockets) {
          const entry = guestDemoIntervals.get(userId);
          if (entry) {
            try { if (entry.messageIntervalId) clearInterval(entry.messageIntervalId); } catch (e) {}
            try { if (entry.actionIntervalId) clearInterval(entry.actionIntervalId); } catch (e) {}
            guestDemoIntervals.delete(userId);
            console.log(`[socket] stopped guest demo intervals for ${userId}`);
          }
        }
      } catch (err) {
        // ignore errors in cleanup
      }
    });
  });
}

// Helper: ensure a 3-person demo conversation exists for the guest and start
// a timer that posts a random message every 30s while the guest is online.
export async function ensureGuestDemo(io, guestUserId) {
  try {
    // If already running, no-op
    if (guestDemoIntervals.has(guestUserId)) return;

    // Find two other users to include
    const others = await prisma.user.findMany({ where: { NOT: { id: guestUserId } }, take: 2 });
    if (!others || others.length < 2) return;
    const memberIds = [guestUserId, others[0].id, others[1].id];

    // Try to find an existing group conversation with exactly these members
    const candidates = await prisma.conversation.findMany({
      where: { isGroup: true, members: { some: { userId: memberIds[0] } } },
      include: { members: true },
    });

    const sortedTarget = memberIds.slice().sort().join(",");
    let convo = candidates.find((c) => {
      const ids = c.members.map((m) => m.userId).slice().sort().join(",");
      return ids === sortedTarget && c.members.length === memberIds.length;
    });

    if (!convo) {
      convo = await prisma.conversation.create({
        data: {
          isGroup: true,
          members: { create: memberIds.map((id) => ({ userId: id })) },
        },
        include: { members: true },
      });

      // Emit creation events to members
      try {
        await Promise.all(convo.members.map(async (member) => {
          await createAndEmitNotification(io, {
            userId: member.userId,
            type: "conversation:created",
            data: { conversationId: convo.id, createdAt: convo.createdAt, link: `/conversations/${convo.id}` },
          });
          io.to(`user:${member.userId}`).emit("conversation:new", { conversation: convo });
          io.to(`user:${member.userId}`).emit("inbox:update", { fromUserId: guestUserId, messagePreview: "", createdAt: convo.createdAt });
        }));
      } catch (err) {
        console.log('[socket] emit failed for guest convo creation', err?.message ?? err);
      }
    }

    // Load members with names for notifications
    const members = await prisma.conversation.findUnique({ where: { id: convo.id }, include: { members: { include: { user: true } } } });

    // Sample messages
    const samples = [
      "Hey everyone — demo chat here.",
      "What's everyone up to?",
      "Here's a random thought.",
      "Check out this demo message!",
      "Hello from the demo bot.",
    ];

    // Start message interval
    const messageIntervalId = setInterval(async () => {
      try {
        // choose a sender at random (not the guest to simulate others)
        const otherMembers = members.members.filter((m) => m.userId !== guestUserId);
        if (!otherMembers || otherMembers.length === 0) return;
        const sender = otherMembers[Math.floor(Math.random() * otherMembers.length)];
        const content = samples[Math.floor(Math.random() * samples.length)];

        const message = await prisma.message.create({
          data: { content, senderId: sender.userId, receiverId: null, conversationId: convo.id },
          select: { id: true, content: true, createdAt: true, senderId: true, conversationId: true, sender: { select: { id: true, name: true } } },
        });

        // Persist notifications and emit realtime updates
        await Promise.all(members.members.map(async (member) => {
          await createAndEmitNotification(io, {
            userId: member.userId,
            type: 'message',
            data: {
              fromUserId: sender.userId,
              messagePreview: message.content ?? (message.photoUrl ? '[attachment]' : ''),
              messageId: message.id,
              conversationId: convo.id,
              createdAt: message.createdAt,
              senderName: message.sender?.name,
              link: `/conversations/${convo.id}`,
            },
          });

          io.to(`user:${member.userId}`).emit('inbox:update', {
            fromUserId: sender.userId,
            messagePreview: message.content ?? '',
            createdAt: message.createdAt,
          });
        }));

        io.to(`conversation:${convo.id}`).emit('message:new', { message });
      } catch (err) {
        console.error('[guest demo] failed to send message', err?.message ?? err);
      }
    }, 5_000);

    guestDemoIntervals.set(guestUserId, { messageIntervalId, actionIntervalId: null, conversationId: convo.id, members: members.members });
    console.log(`[socket] started guest demo message interval for ${guestUserId} in conversation ${convo.id}`);

    // Start action interval: every 5s perform a random action on guest properties
    const actionIntervalId = setInterval(async () => {
      try {
        // pick a random other user to act as the actor
        const others = members.members.filter((m) => m.userId !== guestUserId);
        if (!others || others.length === 0) return;
        const actor = others[Math.floor(Math.random() * others.length)];

        // pick a guest post as target
        const post = await prisma.post.findFirst({ where: { authorId: guestUserId } });
        if (!post) return;

        const action = Math.floor(Math.random() * 3); // 0=toggle like,1=friend req toggle,2=comment then delete

        if (action === 0) {
          // toggle like by actor on guest post
          const postWithLikes = await prisma.post.findUnique({ where: { id: post.id }, select: { likedBy: { select: { id: true } }, authorId: true } });
          const alreadyLiked = postWithLikes.likedBy.some((u) => u.id === actor.userId);
          await prisma.post.update({ where: { id: post.id }, data: { likedBy: alreadyLiked ? { disconnect: { id: actor.userId } } : { connect: { id: actor.userId } } } });
          if (!alreadyLiked && postWithLikes.authorId !== actor.userId) {
            await createAndEmitNotification(io, {
              userId: postWithLikes.authorId,
              type: 'post_like',
              data: { postId: post.id, senderId: actor.userId, senderName: actor.user?.name || null, link: `/posts/${post.id}` },
            });
          }
        } else if (action === 1) {
          // toggle friend request: create if missing, else delete (cancel)
          try {
            const fr = await prisma.friendRequest.create({ data: { senderId: actor.userId, receiverId: guestUserId } });
            // notify guest
            await createAndEmitNotification(io, {
              userId: guestUserId,
              type: 'friend_request',
              data: { senderId: actor.userId, senderName: actor.user?.name || null, requestId: fr.id, link: `/users/${actor.userId}` },
            });
          } catch (err) {
            // likely unique constraint -> cancel existing pending friend request
            try {
              const existing = await prisma.friendRequest.findFirst({ where: { senderId: actor.userId, receiverId: guestUserId } });
              if (existing) {
                await prisma.friendRequest.delete({ where: { id: existing.id } });
              }
            } catch (e) {
              // ignore
            }
          }
        } else {
          // create comment then delete it shortly after
          const comment = await prisma.comment.create({ data: { content: 'Demo comment', postId: post.id, authorId: actor.userId } });
          // notify guest about comment
          await createAndEmitNotification(io, {
            userId: guestUserId,
            type: 'comment',
            data: { commentId: comment.id, postId: post.id, commenterId: actor.userId, commenterName: actor.user?.name || null, content: comment.content, link: `/posts/${post.id}` },
          });
          // delete after 2s
          setTimeout(async () => {
            try {
              await prisma.comment.delete({ where: { id: comment.id } });
            } catch (e) {
              // ignore
            }
          }, 2000);
        }
      } catch (err) {
        console.error('[guest demo action] failed', err?.message ?? err);
      }
    }, 5_000);

    // update map entry with actionIntervalId
    let entry = guestDemoIntervals.get(guestUserId) || {};
    guestDemoIntervals.set(guestUserId, { ...entry, actionIntervalId });
    console.log(`[socket] started guest demo action interval for ${guestUserId}`);

    // Start post-creation interval: random users create posts every 5s
    const postSamples = [
      "Automated post: hello world!",
      "Random thought of the moment.",
      "Demo post — ignore me.",
      "Here's a generated update.",
      "Another sample post for testing.",
    ];

    const postIntervalId = setInterval(async () => {
      try {
        // choose a random user (not the guest) to author a post
        const totalUsers = await prisma.user.count({ where: { NOT: { id: guestUserId } } });
        if (!totalUsers || totalUsers === 0) return;
        const skip = Math.floor(Math.random() * totalUsers);
        const users = await prisma.user.findMany({ where: { NOT: { id: guestUserId } }, take: 1, skip });
        if (!users || users.length === 0) return;
        const author = users[0];
        const content = postSamples[Math.floor(Math.random() * postSamples.length)];

            // Always include media: either an image (more likely) or a video, plus caption text
            const mediaRoll = Math.random();
            let mediaData = {};
            const sampleVideos = [
              'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
              'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
              'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
            ];

            if (mediaRoll < 0.7) {
              // image (70%) - use picsum.photos seeded randomly
              const seed = Math.floor(Math.random() * 100000);
              const w = 1024;
              const h = 576;
              mediaData.photoUrl = `https://picsum.photos/seed/${seed}/${w}/${h}`;
              mediaData.mediaType = 'IMAGE';
            } else {
              // video (30%) - pick a random sample MP4
              const vid = sampleVideos[Math.floor(Math.random() * sampleVideos.length)];
              mediaData.photoUrl = vid;
              mediaData.mediaType = 'VIDEO';
            }

            const post = await prisma.post.create({
              data: { content, authorId: author.id, photoUrl: mediaData.photoUrl, mediaType: mediaData.mediaType },
              select: { id: true, content: true, createdAt: true, authorId: true, photoUrl: true, mediaType: true, author: { select: { id: true, name: true, avatarUrl: true } } },
            });

        // emit a global event so clients can react if they listen
        try {
          io.emit('post:new', { post });
        } catch (e) {
          // ignore emit failures
        }
      } catch (err) {
        console.error('[guest demo post] failed', err?.message ?? err);
      }
    }, 5_000);

    // store postIntervalId alongside others
    entry = guestDemoIntervals.get(guestUserId) || {};
    guestDemoIntervals.set(guestUserId, { ...entry, postIntervalId });
    console.log(`[socket] started guest demo post interval for ${guestUserId}`);

    // Safety timeout: stop demo after 10 minutes to prevent runaway
    setTimeout(() => {
      const entry = guestDemoIntervals.get(guestUserId);
      if (entry) {
        clearInterval(entry.messageIntervalId);
        clearInterval(entry.actionIntervalId);
        clearInterval(entry.postIntervalId);
        guestDemoIntervals.delete(guestUserId);
        console.log(`[socket] auto-stopped guest demo intervals for ${guestUserId} after timeout`);
      }
    }, 10 * 60 * 1000); // 10 minutes
  } catch (err) {
    console.error('[guest demo] setup failed', err?.message ?? err);
  }
}
