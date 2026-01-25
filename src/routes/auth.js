import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "../db/prisma.js";
import { signAccessToken } from "../auth/tokens.js";
import { getIO } from "../sockets/io.js";
import { createAndEmitNotification } from "../sockets/notify.js";

export const authRouter = Router();

// POST /api/auth/register
// Creates a new user and returns a JWT.
authRouter.post("/register", async (req, res, next) => {
  try {
    const { email, password, name } = req.body ?? {};

    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: "email already in use" });
    }

    // Never store plain passwords. Store a one-way hash.
    const passwordHash = await bcrypt.hash(password, 10);

    // Create the user in the DB.
    const user = await prisma.user.create({
      data: {
        email,
        name: name || null,
        passwordHash,
      },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        createdAt: true,
      },
    });

    // Create a JWT for this user.
    const token = signAccessToken({ userId: user.id });
    res.status(201).json({ token, user });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/guest
// Creates or returns a guest user with some seeded relations and returns a JWT.
authRouter.post("/guest", async (req, res, next) => {
  try {
    const guestEmail = "guest@odinbook.test";

    // Upsert guest user (idempotent).
    const guest = await prisma.user.upsert({
      where: { email: guestEmail },
      update: {},
      create: {
        email: guestEmail,
        name: "Guest User",
        passwordHash: await bcrypt.hash("guest", 8),
        avatarUrl: `https://www.gravatar.com/avatar/${crypto.createHash("md5").update(guestEmail.trim().toLowerCase()).digest("hex")}?s=200&d=identicon&r=pg`,
      },
    });

    // Ensure guest has some posts
    const existingPosts = await prisma.post.findMany({ where: { authorId: guest.id }, take: 1 });
    if (existingPosts.length === 0) {
      // Create a couple of sample posts
      await prisma.post.createMany({
        data: [
          { authorId: guest.id, content: "Hello from Guest!" },
          { authorId: guest.id, content: "This is a demo account with sample data." },
        ],
      });
    }

    // Find some other users to create pending friend requests from
    const others = await prisma.user.findMany({ where: { NOT: { id: guest.id } }, take: 6 });
    for (const other of others) {
      try {
        await prisma.friendRequest.create({
          data: {
            senderId: other.id,
            receiverId: guest.id,
            status: 'PENDING',
          },
        });
      } catch (e) {
        // ignore unique violations
      }
    }

    // Create notifications for those friend requests so guest sees them
    for (const other of others) {
      try {
        await createAndEmitNotification(getIO(), {
          userId: guest.id,
          type: 'friend_request',
          data: {
            senderId: other.id,
            senderName: other.name || other.email,
            link: `/users/${other.id}`,
          },
        });
      } catch (e) {
        // ignore
      }
    }

    // Create a couple of conversations/messages with other users
    if (others.length > 0) {
      for (let i = 0; i < Math.min(3, others.length); i++) {
        const participant = others[i];
        // create a simple conversation between guest and participant
        const conv = await prisma.conversation.create({
          data: {
            isGroup: false,
            members: { create: [{ userId: guest.id }, { userId: participant.id }] },
          },
        });
        await prisma.message.createMany({
          data: [
            { conversationId: conv.id, senderId: participant.id, content: `Hi Guest, this is ${participant.name || participant.email}` },
            { conversationId: conv.id, senderId: guest.id, content: `Hello ${participant.name || participant.email}, thanks for connecting.` },
          ],
        });
        // create a notification for the guest about the message
        try {
          await createAndEmitNotification(getIO(), {
            userId: guest.id,
            type: 'message',
            data: {
              senderId: participant.id,
              senderName: participant.name || participant.email,
              conversationId: conv.id,
              link: `/conversations/${conv.id}`,
              messagePreview: `Hi Guest, this is ${participant.name || participant.email}`,
            },
          })
        } catch (e) {
          // ignore
        }
        
      }
    }

    // Add likes from some users to guest posts
    const guestPosts = await prisma.post.findMany({ where: { authorId: guest.id }, take: 5 });
    if (guestPosts.length && others.length) {
      for (const p of guestPosts) {
        const liker = others[Math.floor(Math.random() * others.length)];
        try {
          await prisma.post.update({ where: { id: p.id }, data: { likedBy: { connect: { id: liker.id } } } });
        } catch (e) {
          // ignore
        }
        // create a like notification for the guest post
        try {
          await createAndEmitNotification(getIO(), {
            userId: guest.id,
            type: 'post_like',
            data: {
              senderId: liker.id,
              senderName: liker.name || liker.email,
              postId: p.id,
              link: `/posts/${p.id}`,
            },
          })
        } catch (e) {
          // ignore
        }
      }
    }

    const token = signAccessToken({ userId: guest.id });

    res.json({ token, user: { id: guest.id, email: guest.email, name: guest.name, avatarUrl: guest.avatarUrl, createdAt: guest.createdAt } });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login
// Verifies email+password and returns a JWT.
authRouter.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};

    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: "invalid credentials" });
    }

    // Compare password to stored hash.
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: "invalid credentials" });
    }

    const token = signAccessToken({ userId: user.id });

    // Return token + safe user fields.
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});
