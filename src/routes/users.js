import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { prisma } from "../db/prisma.js";
import { upload } from "../uploads/multer.js";
import { uploadBufferToCloudinary } from "../uploads/cloudinary.js";

export const usersRouter = Router();

// GET /api/me
// Protected route: returns the authenticated user.
// If the request has a valid Bearer token, req.user is populated by Passport.
usersRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "unauthorized" });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        bio: true,
        avatarUrl: true,
        avatarPublicId: true,
        createdAt: true,
      },
    });

    if (!user) return res.status(404).json({ error: "user not found" });
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

// GET /api/users/:userId
// Public route: returns a user's public profile.
// Keep this response "public" (no email, no passwordHash).
usersRouter.get("/users/:userId", async (req, res, next) => {
  try {
    const userId = req.params.userId;
    if (!userId) return res.status(400).json({ error: "userId is required" });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        bio: true,
        avatarUrl: true,
        createdAt: true,
      },
    });

    if (!user) return res.status(404).json({ error: "user not found" });
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

usersRouter.put("/me", requireAuth, upload.single("image"), async (req, res, next) => {
  try {
    const userId = req.user.id;
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : undefined;
    const bio = typeof req.body?.bio === "string" ? req.body.bio.trim() : undefined;

    if (name !== undefined && name.length === 0) {
      return res.status(400).json({ error: "name cannot be empty" });
    }
    if (bio !== undefined && bio.length > 255) {
      return res.status(400).json({ error: "bio must be 255 characters or less" });
    }

    const data = {};
    if (name !== undefined) data.name = name;
    if (bio !== undefined) data.bio = bio;

    if (req.file?.buffer) {
      const uploadResult = await uploadBufferToCloudinary({
        buffer: req.file.buffer,
        folder: "odinbook/avatars",
        publicId: `${userId}-${Date.now()}`,
      });

      data.avatarUrl = uploadResult.secure_url;
      if (uploadResult.public_id) {
        data.avatarPublicId = uploadResult.public_id;
      }
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        bio: true,
        avatarUrl: true,
        avatarPublicId: true,
        createdAt: true,
      },
    });
    res.json({ user: updated });
  } catch (err) {
    next(err);
  }
});

usersRouter.get("/search", requireAuth, async (req, res, next) => {
  try {
    const name = typeof req.query?.name === "string" ? req.query.name.trim() : "";
    if (!name) return res.status(400).json({ error: "name is required" });
    const users = await prisma.user.findMany({
      where: {
        name: {
          contains: name,
          mode: "insensitive",
        },
      },
      select: {
        id: true,
        name: true,
        avatarUrl: true,
      },
      take: 10,
    });
    res.json({ users });
  } catch (err) {
    next(err);
  }
});
