import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { prisma } from "../db/prisma.js";
import { uploadMedia } from "../uploads/multer.js";
import { uploadBufferToCloudinary } from "../uploads/cloudinary.js";
import { getIO } from "../sockets/io.js";
import { createAndEmitNotification } from "../sockets/notify.js";

export const postRouter = Router();
// POST /api/posts
// Protected route: creates a new post for the authenticated user.
postRouter.post("/", requireAuth, uploadMedia.single("image"), async (req, res, next) => {
  try {
    // With multipart/form-data, text fields land in req.body and the file lands in req.file.
    // Client fields:
    // - content: string
    // - image: file
    const content = (req.body?.content ?? "").trim();

    if (!content) {
      return res.status(400).json({ error: "content is required" });
    }
    if (content.length > 255) {
      return res.status(400).json({ error: "content must be 255 characters or less" });
    }

    // Never trust the client to tell us who they are; use the authenticated user.
    const userId = req.user.id;

    // If a file was included, upload it to Cloudinary and store the resulting URL.
    let photoUrl = null;
    let photoPublicId = null;
    let mediaType = null;
    if (req.file?.buffer) {
      const isVideo = req.file.mimetype?.startsWith("video/");
      const uploadResult = await uploadBufferToCloudinary({
        buffer: req.file.buffer,
        folder: "odinbook/posts",
        publicId: `${userId}-${Date.now()}`,
        resourceType: "auto",
      });

      photoUrl = uploadResult.secure_url;
      photoPublicId = uploadResult.public_id ?? null;
      mediaType = isVideo ? "VIDEO" : "IMAGE";
    }

    const post = await prisma.post.create({
      data: {
        content,
        photoUrl,
        photoPublicId,
        mediaType,
        authorId: userId,
      },
      select: {
        id: true,
        content: true,
        createdAt: true,
        authorId: true,
        photoUrl: true,
        photoPublicId: true,
        mediaType: true,
        author: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
            bio: true,
          },
        },
      },
    });
    res.status(201).json({ post });
  } catch (err) {
    next(err);
  }
});
// GET /api/posts
// Public route: returns a list of recent posts with author info.
postRouter.get("/", async (req, res, next) => {
    try {
        const posts = await prisma.post.findMany({
            orderBy: { createdAt: "desc" },
            take: 20,
            select: {
                id: true,
                content: true,
                createdAt: true,
                authorId: true,
                photoUrl: true,
              photoPublicId: true,
              mediaType: true,
                // Embed the author so the client doesn't need extra requests.
                // Keep this "public" (no email, no passwordHash).
                author: {
                  select: {
                    id: true,
                    name: true,
                    avatarUrl: true,
                    bio: true,
                  },
                },
            },
        });
        res.json({ posts });
    } catch (err) {
        next(err);
    }
});

postRouter.get("/:userId/posts", requireAuth, async (req, res, next) => {
    try {
        const userId = req.params.userId;
        if (!userId) return res.status(400).json({ error: "userId is required" });
        const posts = await prisma.post.findMany({
            where: { authorId: userId },
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                content: true,
                createdAt: true,
                authorId: true,
                photoUrl: true,
                photoPublicId: true,
                mediaType: true,
                author: {
                  select: {
                    id: true,
                    name: true,
                    avatarUrl: true,
                    bio: true,
                  },
                },
                },
        });
        res.json({ posts });
    } catch (err) {
        next(err);
    }
});

postRouter.delete("/:postId", requireAuth, async (req, res, next) => {
    try {
        const userId = req.user.id;
        const postId = req.params.postId;
        if (!postId) return res.status(400).json({ error: "postId is required" });
        const post = await prisma.post.findUnique({ where: { id: postId } });
        if (!post) return res.status(404).json({ error: "post not found" });
        if (post.authorId !== userId) {
            return res.status(403).json({ error: "you can only delete your own posts" });
        }
        await prisma.post.delete({ where: { id: postId } });
        res.status(204).end();
    } catch (err) {
        next(err);
    }
});

postRouter.get("/home", requireAuth, async (req, res, next) => {
    try {
        const userId = req.user.id;

    const friendIds = await prisma.friendRequest.findMany({
            where: {
        OR: [{ senderId: userId }, { receiverId: userId }],
                status: 'ACCEPTED',
            },
        });
        // Fetch posts from the user and their friends.
        const posts = await prisma.post.findMany({
            where: {
                OR: [
                    { authorId: userId },
                    { authorId: { in: friendIds.map(fr => fr.senderId === userId ? fr.receiverId : fr.senderId) } },
                ],
            },
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                content: true,
                createdAt: true,
                authorId: true,
                photoUrl: true,
                photoPublicId: true,
                mediaType: true,
                author: {
                  select: {
                    id: true,
                    name: true,
                    avatarUrl: true,
                    bio: true,
                  },
                },
      },
        });
        res.json({ posts });
    } catch (err) {
        next(err);
    }
});

    // GET /api/posts/:postId
    // Public route: fetch a single post (safe fields only).
    postRouter.get("/:postId", async (req, res, next) => {
      try {
        const postId = req.params.postId;
        if (!postId) return res.status(400).json({ error: "postId is required" });

        const post = await prisma.post.findUnique({
          where: { id: postId },
          select: {
            id: true,
            content: true,
            createdAt: true,
            authorId: true,
            photoUrl: true,
            photoPublicId: true,
            mediaType: true,
            author: {
              select: {
                id: true,
                name: true,
                avatarUrl: true,
                bio: true,
              },
            },
          },
        });

        if (!post) return res.status(404).json({ error: "post not found" });
        res.json({ post });
      } catch (err) {
        next(err);
      }
    });

    async function togglePostLike(req, res, next) {
      try {
        const userId = req.user.id;
        const postId = req.params.postId;
        if (!postId) return res.status(400).json({ error: "postId is required" });

        const post = await prisma.post.findUnique({
          where: { id: postId },
          select: {
            likedBy: { select: { id: true } },
            authorId: true,
            author: { select: { name: true } },
          },
        });

        if (!post) return res.status(404).json({ error: "post not found" });

        const alreadyLiked = post.likedBy.some((u) => u.id === userId);

        await prisma.post.update({
          where: { id: postId },
          data: {
            likedBy: alreadyLiked
              ? { disconnect: { id: userId } }
              : { connect: { id: userId } },
          },
        });

        // Notify the post author if someone liked their post (not unliked)
        if (!alreadyLiked && post.authorId !== userId) {
          const io = getIO();
          await createAndEmitNotification(io, {
            userId: post.authorId,
            type: 'post_like',
            data: {
              postId,
              senderId: userId,
              senderName: req.user?.name || req.user?.email || null,
              link: `/posts/${postId}`,
            },
          });
        }

        res.status(204).end();
      } catch (err) {
        next(err);
      }
    }

    // Client currently uses POST, but keep PUT as an alias.
    postRouter.post("/:postId/like", requireAuth, togglePostLike);
    postRouter.put("/:postId/like", requireAuth, togglePostLike);

    postRouter.get("/:postId/like", requireAuth, async (req, res, next) => {
      try {
        const postId = req.params.postId;
        if (!postId) return res.status(400).json({ error: "postId is required" });

        const post = await prisma.post.findUnique({
          where: { id: postId },
          select: {
            _count: { select: { likedBy: true } },
          },
        });

        if (!post) return res.status(404).json({ error: "post not found" });

        res.json({ likes: post._count.likedBy });
      } catch (err) {
        next(err);
      }
    });