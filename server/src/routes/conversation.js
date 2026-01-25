import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { prisma } from "../db/prisma.js";
import { getIO } from "../sockets/io.js";
import { createAndEmitNotification } from "../sockets/notify.js";
import { uploadMedia } from "../uploads/multer.js";
import { uploadBufferToCloudinary } from "../uploads/cloudinary.js";

export const conversationRouter = Router();

conversationRouter.post("/", requireAuth, async (req, res, next) => {
    try {
        const { participantId, title } = req.body ?? {};
        if (!participantId) {
            return res.status(400).json({ error: "participantId is required" });
        }

        const userId = req.user.id;

        const participantIds = Array.isArray(participantId)
            ? participantId
            : [participantId];

        const uniqueParticipantIds = [...new Set(
            participantIds
                .filter((id) => typeof id === "string" && id.trim())
                .map((id) => id.trim())
                .filter((id) => id !== userId),
        )];

        if (uniqueParticipantIds.length === 0) {
            return res.status(400).json({ error: "participantId must include another user" });
        }

        const memberIds = [userId, ...uniqueParticipantIds];
        const isGroup = memberIds.length > 2;

        // Check if a 1:1 conversation already exists.
        if (!isGroup) {
            const otherUserId = uniqueParticipantIds[0];

            const existing = await prisma.conversation.findFirst({
                where: {
                    isGroup: false,
                    AND: [
                        { members: { some: { userId } } },
                        { members: { some: { userId: otherUserId } } },
                        { members: { every: { userId: { in: [userId, otherUserId] } } } },
                    ],
                },
                select: {
                    id: true,
                    title: true,
                    isGroup: true,
                    createdAt: true,
                    updatedAt: true,
                    members: {
                        select: {
                            userId: true,
                            user: { select: { id: true, name: true, avatarUrl: true } },
                        },
                    },
                },
            });

            if (existing) {
                return res.status(409).json({ error: "conversation already exists", conversation: existing });
            }
        }

        // For group conversations, avoid duplicates with the exact same member set.
        if (isGroup) {
            const candidates = await prisma.conversation.findMany({
                where: {
                    isGroup: true,
                    members: {
                        // All members must be within the requested set.
                        every: { userId: { in: memberIds } },
                        // At least one known member to reduce the scan.
                        some: { userId: memberIds[0] },
                    },
                },
                select: {
                    id: true,
                    title: true,
                    isGroup: true,
                    createdAt: true,
                    updatedAt: true,
                    _count: { select: { members: true } },
                    members: {
                        select: {
                            userId: true,
                            user: { select: { id: true, name: true, avatarUrl: true } },
                        },
                    },
                },
            });

            const existingGroup = candidates.find(
                (c) => c._count.members === memberIds.length,
            );

            if (existingGroup) {
                return res.status(409).json({ error: "conversation already exists", conversation: existingGroup });
            }
        }

        const conversation = await prisma.conversation.create({
            data: {
                title: typeof title === "string" && title.trim() ? title.trim() : null,
                isGroup,
                members: {
                    create: memberIds.map((id) => ({ userId: id })),
                },
            },
            select: {
                id: true,
                title: true,
                isGroup: true,
                createdAt: true,
                updatedAt: true,
                members: {
                    select: {
                        userId: true,
                        user: { select: { id: true, name: true, avatarUrl: true } },
                    },
                },
            },
        });

        res.status(201).json({ conversation });

        try {
            const io = getIO();
            // Persist a notification and emit realtime events for each member.
            await Promise.all(conversation.members.map(async (member) => {
                await createAndEmitNotification(io, {
                    userId: member.userId,
                    type: "conversation:created",
                    data: {
                        conversationId: conversation.id,
                        createdAt: conversation.createdAt,
                        link: `/conversations/${conversation.id}`,
                    },
                });

                io.to(`user:${member.userId}`).emit("conversation:new", { conversation });
                io.to(`user:${member.userId}`).emit("inbox:update", {
                    fromUserId: userId,
                    messagePreview: "",
                    createdAt: conversation.createdAt,
                });
            }));
        } catch (err) {
            console.log("[socket] emit failed", err?.message ?? err);
        }

    } catch (err) {
        next(err);
    }
});

conversationRouter.get("/", requireAuth, async (req, res, next) => {
    try {
        const userId = req.user.id;
        const conversations = await prisma.conversation.findMany({
            where: {
                members: { some: { userId } },
            },
            orderBy: { updatedAt: "desc" },
            select: {
                id: true,
                title: true,
                isGroup: true,
                createdAt: true,
                updatedAt: true,
                members: {
                    select: {
                        userId: true,
                        user: { select: { id: true, name: true, avatarUrl: true } },
                    },
                },
                messages: {
                    orderBy: { createdAt: "desc" },
                    take: 1,
                    select: {
                        id: true,
                        content: true,
                        createdAt: true,
                        senderId: true,
                    },
                },
            },
        });

        // Add author info to messages
        for (const conversation of conversations) {
            if (conversation.messages && conversation.messages.length > 0) {
                const message = conversation.messages[0];
                const author = await prisma.user.findUnique({
                    where: { id: message.senderId },
                    select: { id: true, name: true },
                });
                message.author = author;
            }
        }

        res.json({ conversations });
    }
    catch (err) {
        next(err);
    }
});

conversationRouter.get("/search", requireAuth, async (req, res, next) => {
    try {
        const userId = req.user.id;
        const title = typeof req.query?.title === "string" ? req.query.title.trim() : "";
        if (!title) {
            return res.status(400).json({ error: "title is required" });
        }
        const conversations = await prisma.conversation.findMany({
            where: {
                title: { contains: title, mode: "insensitive" },
                members: { some: { userId } },
            },
            select: {
                id: true,
                title: true,
                isGroup: true,
                createdAt: true,
                updatedAt: true,
                members: {
                    select: {
                        userId: true,
                        user: { select: { id: true, name: true, avatarUrl: true } },
                    },
                },
            },
        });
        if (!conversations || conversations.length === 0) {
            return res.status(404).json({ error: "conversation not found" });
        }
        res.json({ conversations });
    } catch (err) {
        next(err);
    }
});

conversationRouter.get("/:conversationId", requireAuth, async (req, res, next) => {
    try {
        const userId = req.user.id;
        const conversationId = req.params.conversationId;
        if (!conversationId) {
            return res.status(400).json({ error: "conversationId is required" });
        }
        const conversation = await prisma.conversation.findFirst({
            where: {
                id: conversationId,
                members: { some: { userId } },
            },
            select: {
                id: true,
                title: true,
                isGroup: true,
                createdAt: true,
                updatedAt: true,
                members: {
                    select: {
                        userId: true,
                        user: { select: { id: true, name: true, avatarUrl: true } },
                    },
                },
            },
        });
        if (!conversation) {
            return res.status(404).json({ error: "conversation not found" });
        }
        res.json({ conversation });
    } catch (err) {
        next(err);
    }
});

conversationRouter.delete("/:conversationId", requireAuth, async (req, res, next) => {
    try {
        const userId = req.user.id;
        const conversationId = req.params.conversationId;
        if (!conversationId) {
            return res.status(400).json({ error: "conversationId is required" });
        }
        const conversation = await prisma.conversation.findFirst({
            where: {
                id: conversationId,
                members: { some: { userId } },
            },
        });
        if (!conversation) {
            return res.status(404).json({ error: "conversation not found" });
        }
        await prisma.conversation.delete({
            where: { id: conversationId },
        });
        res.status(204).end();
    } catch (err) {
        next(err);
    }
});

conversationRouter.put("/:conversationId/members", requireAuth, async (req, res, next) => {
    try {
        const userId = req.user.id;
        const conversationId = req.params.conversationId;
        const { memberIds } = req.body ?? {};
        if (!conversationId) {
            return res.status(400).json({ error: "conversationId is required" });
        }
        if (!Array.isArray(memberIds) || memberIds.length === 0) {
            return res.status(400).json({ error: "memberIds must be a non-empty array" });
        }
        const conversation = await prisma.conversation.findFirst({
            where: {
                id: conversationId,
                members: { some: { userId } },
            },
        });
        if (!conversation) {
            return res.status(404).json({ error: "conversation not found" });
        }
        const uniqueMemberIds = [...new Set(
            memberIds
                .filter((id) => typeof id === "string" && id.trim())
                .map((id) => id.trim()),
        )];

        if (uniqueMemberIds.length === 0) {
            return res.status(400).json({ error: "memberIds must include valid user ids" });
        }
        const updatedConversation = await prisma.conversation.update({
            where: { id: conversationId },
            data: {
                members: {
                    createMany: {
                        data: uniqueMemberIds.map((id) => ({ userId: id })),
                        skipDuplicates: true,
                    },
                },
            },
            select: {
                id: true,
                title: true,
                isGroup: true,
                createdAt: true,
                updatedAt: true,
                members: {
                    select: {
                        userId: true,
                        user: { select: { id: true, name: true, avatarUrl: true } },
                    },
                },
            },
        });
        res.json({ conversation: updatedConversation });

        try {
            const io = getIO();

            await Promise.all(updatedConversation.members.map(async (member) => {
                await createAndEmitNotification(io, {
                    userId: member.userId,
                    type: "conversation:updated",
                    data: {
                        conversationId: updatedConversation.id,
                        createdAt: updatedConversation.updatedAt,
                        link: `/conversations/${updatedConversation.id}`,
                    },
                });

                io.to(`user:${member.userId}`).emit("conversation:update", {
                    conversation: updatedConversation,
                });

                io.to(`user:${member.userId}`).emit("inbox:update", {
                    fromUserId: userId,
                    messagePreview: "[added to conversation]",
                    createdAt: updatedConversation.updatedAt,
                });
            }));
        } catch (err) {
            console.log("[socket] emit failed", err?.message ?? err);
        }
    } catch (err) {
        next(err);
    }
});


// GET /api/conversations/:conversationId/messages
// Protected route: returns messages for a conversation.
conversationRouter.get("/:conversationId/messages", requireAuth, async (req, res, next) => {
    try {
        const userId = req.user.id;
        const conversationId = req.params.conversationId;
        if (!conversationId) return res.status(400).json({ error: "conversationId is required" });

        const conversation = await prisma.conversation.findFirst({
            where: { id: conversationId, members: { some: { userId } } },
            select: { id: true },
        });
        if (!conversation) return res.status(404).json({ error: "conversation not found" });

        const messages = await prisma.message.findMany({
            where: { conversationId },
            orderBy: { createdAt: "asc" },
            select: {
                id: true,
                content: true,
                photoUrl: true,
                photoPublicId: true,
                mediaType: true,
                createdAt: true,
                senderId: true,
                receiverId: true,
                conversationId: true,
                sender: { select: { id: true, name: true, avatarUrl: true } },
            },
        });

        res.json({ messages });
    } catch (err) {
        next(err);
    }
});

// POST /api/conversations/:conversationId/messages
// Protected route: create a message in a conversation.
conversationRouter.post(
    "/:conversationId/messages",
    requireAuth,
    uploadMedia.single("image"),
    async (req, res, next) => {
        try {
            const userId = req.user.id;
            const conversationId = req.params.conversationId;
            const content = (req.body?.content ?? "").trim();
            const imageFile = req.file;

            if (!conversationId) return res.status(400).json({ error: "conversationId is required" });
            if (!content && !imageFile) {
                return res.status(400).json({ error: "either content or an attachment is required" });
            }

            const conversation = await prisma.conversation.findFirst({
                where: { id: conversationId, members: { some: { userId } } },
                select: {
                    id: true,
                    members: { select: { userId: true } },
                },
            });
            if (!conversation) return res.status(404).json({ error: "conversation not found" });

            let photoUrl = null;
            let photoPublicId = null;
            let mediaType = null;
            if (imageFile?.buffer) {
                const isVideo = imageFile.mimetype?.startsWith("video/");
                const uploadResult = await uploadBufferToCloudinary({
                    buffer: imageFile.buffer,
                    folder: "odinbook/messages",
                    publicId: `${userId}-${Date.now()}`,
                    resourceType: "auto",
                });
                photoUrl = uploadResult.secure_url;
                photoPublicId = uploadResult.public_id;
                mediaType = isVideo ? "VIDEO" : "IMAGE";
            }

            const message = await prisma.message.create({
                data: {
                    content: content ? content : null,
                    photoUrl,
                    photoPublicId,
                    mediaType,
                    senderId: userId,
                    receiverId: null,
                    conversationId,
                },
                select: {
                    id: true,
                    content: true,
                    photoUrl: true,
                    photoPublicId: true,
                    mediaType: true,
                    createdAt: true,
                    senderId: true,
                    receiverId: true,
                    conversationId: true,
                    sender: { select: { id: true, name: true, avatarUrl: true } },
                },
            });

            try {
                const io = getIO();
                // Persist notifications for members and emit realtime updates.
                await Promise.all(conversation.members.map(async (member) => {
                    await createAndEmitNotification(io, {
                        userId: member.userId,
                        type: "message",
                        data: {
                            fromUserId: userId,
                            messagePreview: message.content ?? (message.photoUrl ? "[attachment]" : ""),
                            messageId: message.id,
                            conversationId,
                            createdAt: message.createdAt,
                            senderName: message.sender?.name,
                            link: `/conversations/${conversationId}`,
                        },
                    });

                    io.to(`user:${member.userId}`).emit("inbox:update", {
                        fromUserId: userId,
                        messagePreview: message.content ?? (message.photoUrl ? "[attachment]" : ""),
                        createdAt: message.createdAt,
                    });
                }));

                io.to(`conversation:${conversationId}`).emit("message:new", { message });
            } catch (err) {
                console.log("[socket] emit failed", err?.message ?? err);
            }

            res.status(201).json({ message });
        } catch (err) {
            next(err);
        }
    },
);

