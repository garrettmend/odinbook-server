import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { prisma } from "../db/prisma.js";
import { uploadMedia } from "../uploads/multer.js";
import { uploadBufferToCloudinary } from "../uploads/cloudinary.js";
import { getIO } from "../sockets/io.js";
import { createAndEmitNotification } from "../sockets/notify.js";

export const messageRouter = Router();

// POST /api/messages
// Protected route: creates a new message in a conversation.
messageRouter.post("/:receiverId", requireAuth, uploadMedia.single("image"), async (req, res, next) => {
    try {
        // With multipart/form-data, text fields land in req.body and the file lands in req.file.
        // Client fields:
        // - content: string
        // - image: file
        const content = (req.body?.content ?? "").trim();
        const imageFile = req.file;
        const receiverId = req.params.receiverId;
        if (!receiverId) return res.status(400).json({ error: "receiverId is required" });
        if (!content && !imageFile) {
            return res.status(400).json({ error: "either content or an attachment is required" });
        }
        // Never trust the client to tell us who they are; use the authenticated user.
        const userId = req.user.id;
        if (userId === receiverId) {
            return res.status(400).json({ error: "cannot message yourself" });
        }
        // If an attachment was included, upload it to Cloudinary and store the resulting URL.
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
                receiverId,
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
                sender: {
                    select: {
                        id: true,
                        name: true,
                        avatarUrl: true,
                    },
                },
                receiver: {
                    select: {
                        id: true,
                        name: true,
                        avatarUrl: true,
                    },
                },
            },
        });

        // Persist notification and REALTIME (Socket.IO)
        // We already saved the message to the database via Prisma.
        // Now we "push" an event to the receiver so their UI can update instantly.
        //
        // This is intentionally best-effort: if sockets are down for some reason,
        // we still want the REST API request to succeed.
        try {
            const io = getIO();

            // Create a persistent notification for the receiver.
            await createAndEmitNotification(io, {
                userId: receiverId,
                type: "message",
                data: {
                    fromUserId: userId,
                    messagePreview: message.content ?? (message.photoUrl ? "[attachment]" : ""),
                    messageId: message.id,
                    createdAt: message.createdAt,
                        senderName: message.sender?.name,
                        link: `/messages/${userId}`,
                },
            });

            // A very simple event: "a new message was created".
            // The receiver listens for this and appends the message to the chat.
            io.to(`user:${receiverId}`).emit("message:new", { message });

            // Inbox update is typically a lightweight payload (preview + counts).
            io.to(`user:${receiverId}`).emit("inbox:update", {
                fromUserId: userId,
                messagePreview: message.content ?? (message.photoUrl ? "[attachment]" : ""),
                createdAt: message.createdAt,
            });
        } catch (err) {
            // eslint-disable-next-line no-console
            console.log("[socket] emit failed", err?.message ?? err);
        }

        res.status(201).json({ message });
    } catch (err) {
        next(err);
    }
});

// GET /api/messages/:otherUserId
// Protected route: returns messages between the authenticated user and another user.
messageRouter.get("/:otherUserId", requireAuth, async (req, res, next) => {
    try {
        const userId = req.user.id;
        const otherUserId = req.params.otherUserId;
        if (!otherUserId) return res.status(400).json({ error: "otherUserId is required" });
        const messages = await prisma.message.findMany({
            where: {
                OR: [
                    { senderId: userId, receiverId: otherUserId },
                    { senderId: otherUserId, receiverId: userId },
                ],
            },
            orderBy: { createdAt: "asc" },
            select: {
                id: true,
                content: true,
                photoUrl: true,
                photoPublicId: true,
                createdAt: true,
                senderId: true,
                receiverId: true,
                conversationId: true,
                sender: {
                    select: {
                        id: true,
                        name: true,
                        avatarUrl: true,
                    },
                },
                receiver: {
                    select: {
                        id: true,
                        name: true,
                        avatarUrl: true,
                    },
                },
                mediaType: true,
            },
        });
        res.json({ messages });
    } catch (err) {
        next(err);
    }
});