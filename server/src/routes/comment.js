import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { prisma } from "../db/prisma.js";
import { getIO } from "../sockets/io.js";
import { createAndEmitNotification } from "../sockets/notify.js";

export const commentRouter = Router();

// POST /api/posts/:postId/comments
// Protected route: creates a new comment on the specified post for the authenticated user.
commentRouter.post("/:postId/comments", requireAuth, async (req, res, next) => {
    try {
        const content = String(req.body?.content ?? "").trim();

        if (!content) {
            return res.status(400).json({ error: "content is required" });
        }
        if (content.length > 255) {
            return res.status(400).json({ error: "content must be 255 characters or less" });
        }

        // Post IDs are cuid() strings in this project.
        const postId = req.params.postId;
        if (!postId) return res.status(400).json({ error: "postId is required" });

        // Never trust the client to tell us who they are; use the authenticated user.
        const userId = req.user.id;
        const comment = await prisma.comment.create({
            data: { 
                content,
                postId,
                authorId: userId,
            },
            select: {
                id: true,
                content: true,
                createdAt: true,
                author: {
                    select: {
                        id: true,
                        name: true,
                        avatarUrl: true,
                        bio: true,
                    },
                },
                postId: true,
            },
        });

        // Notify the post author about the new comment
        const post = await prisma.post.findUnique({
            where: { id: postId },
            select: { authorId: true },
        });
        if (post && post.authorId !== userId) { // Don't notify if commenting on own post
            const io = getIO();
            await createAndEmitNotification(io, {
                userId: post.authorId,
                type: 'comment',
                data: {
                    commentId: comment.id,
                    postId,
                    commenterId: userId,
                    commenterName: comment.author.name,
                    content: comment.content,
                    link: `/posts/${postId}`,
                },
            });
        }

        res.status(201).json({ comment });
    } catch (err) {
        next(err);
    }
});

commentRouter.get("/:postId/comments", requireAuth, async (req, res, next) => {
    try {
        const postId = req.params.postId;
        if (!postId) return res.status(400).json({ error: "postId is required" });

        const comments = await prisma.comment.findMany({
            where: { postId },
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                content: true,
                createdAt: true,
                author: {
                    select: {
                        id: true,
                        name: true,
                        avatarUrl: true,
                        bio: true,
                    },
                },
                postId: true,
            },
        });
        res.json({ comments });
    } catch (err) {
        next(err);
    }
});

async function toggleCommentLike(req, res, next) {
    try {
        const userId = req.user.id;
        const commentId = req.params.commentId;
        if (!commentId) return res.status(400).json({ error: "commentId is required" });

        const comment = await prisma.comment.findUnique({
            where: { id: commentId },
            select: {
                likedBy: { select: { id: true } },
                authorId: true,
                author: { select: { name: true } },
                postId: true,
            },
        });

        if (!comment) return res.status(404).json({ error: "comment not found" });

        const alreadyLiked = comment.likedBy.some((u) => u.id === userId);

        await prisma.comment.update({
            where: { id: commentId },
            data: {
                likedBy: alreadyLiked
                    ? { disconnect: { id: userId } }
                    : { connect: { id: userId } },
            },
        });

        // Notify the comment author if someone liked their comment (not unliked)
        if (!alreadyLiked && comment.authorId !== userId) {
            const io = getIO();
            await createAndEmitNotification(io, {
                userId: comment.authorId,
                type: 'comment_like',
                data: {
                    commentId,
                    likerId: userId,
                    likerName: req.user.name,
                    link: `/posts/${comment.postId ?? ''}`,
                },
            });
        }

        res.status(204).end();
    } catch (err) {
        next(err);
    }
}

// NOTE: This router is mounted at /api/posts.
// Post likes already use /api/posts/:postId/like, so comment likes must NOT use the same pattern.
commentRouter.post("/comments/:commentId/like", requireAuth, toggleCommentLike);
commentRouter.put("/comments/:commentId/like", requireAuth, toggleCommentLike);

commentRouter.get("/comments/:commentId/like", requireAuth, async (req, res, next) => {
    try {
        const commentId = req.params.commentId;
        if (!commentId) return res.status(400).json({ error: "commentId is required" });

        const comment = await prisma.comment.findUnique({
            where: { id: commentId },
            select: {
                _count: { select: { likedBy: true } },
            },
        });

        if (!comment) return res.status(404).json({ error: "comment not found" });

        res.json({ likes: comment._count.likedBy });
    } catch (err) {
        next(err);
    }
});


