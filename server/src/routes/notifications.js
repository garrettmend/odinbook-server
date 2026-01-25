import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { prisma } from "../db/prisma.js";

export const notificationsRouter = Router();

// GET /api/notifications/unread
notificationsRouter.get("/unread", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const items = await prisma.notification.findMany({
      where: { userId, read: false },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    res.json({ notifications: items });
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications/:id/read -> mark a single notification read
notificationsRouter.post("/:id/read", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: "id is required" });
    const updated = await prisma.notification.updateMany({
      where: { id, userId },
      data: { read: true },
    });
    res.json({ updated: updated.count });
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications/mark-all-read -> mark all unread for the user as read
notificationsRouter.post("/mark-all-read", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const result = await prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
    res.json({ updated: result.count });
  } catch (err) {
    next(err);
  }
});

export default notificationsRouter;
