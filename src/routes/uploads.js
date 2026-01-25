import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { upload } from "../uploads/multer.js";
import {
  deleteFromCloudinary,
  uploadBufferToCloudinary,
} from "../uploads/cloudinary.js";

export const uploadsRouter = Router();

// POST /api/uploads/avatar
// This route lets an authenticated user upload a profile avatar.
// Key idea: we store the *Cloudinary URL* in our DB, not the raw image bytes.
uploadsRouter.post(
  "/avatar",
  // 1) Require a valid JWT; Passport will attach the current user to req.user
  requireAuth,
  // 2) Parse multipart/form-data and extract a single file from the "avatar" field.
  //    Our Multer config uses memory storage, so the file ends up as req.file.buffer.
  upload.single("avatar"),
  async (req, res, next) => {
    try {
      // If the client forgot to send a file (or sent the wrong field name), fail fast.
      if (!req.file?.buffer) {
        return res.status(400).json({ error: "missing avatar file" });
      }

      // Never trust the client to tell us who they are; use the authenticated user.
      const userId = req.user.id;

      // Read the previous avatarPublicId so we can delete the old Cloudinary asset later.
      // (This prevents orphaned images from piling up.)
      const existing = await prisma.user.findUnique({
        where: { id: userId },
        select: { avatarPublicId: true },
      });

      // Upload the raw image bytes to Cloudinary.
      // Cloudinary returns metadata including a public_id (used for deletes) and secure_url.
      const uploadResult = await uploadBufferToCloudinary({
        buffer: req.file.buffer,
        folder: "odinbook/avatars",
        // Using a stable publicId (userId) makes "one avatar per user" easy.
        // Depending on Cloudinary settings, this can overwrite the previous upload.
        publicId: userId,
      });

      // Persist the new avatar URL + Cloudinary public ID in our database.
      // We select only safe fields to return to the client.
      const updated = await prisma.user.update({
        where: { id: userId },
        data: {
          avatarUrl: uploadResult.secure_url,
          avatarPublicId: uploadResult.public_id,
        },
        select: {
          id: true,
          email: true,
          name: true,
          avatarUrl: true,
          avatarPublicId: true,
        },
      });

      // If Cloudinary created a new asset ID (instead of overwriting), delete the old one.
      if (
        existing?.avatarPublicId &&
        existing.avatarPublicId !== uploadResult.public_id
      ) {
        await deleteFromCloudinary(existing.avatarPublicId);
      }

      // Return the updated user; the client can render user.avatarUrl immediately.
      res.json({ user: updated });
    } catch (err) {
      // Delegate errors (Cloudinary/DB/etc.) to the centralized Express error handler.
      next(err);
    }
  },
);
