import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import morgan from "morgan";
import { env } from "./config/env.js";
import { configurePassport, passport } from "./auth/passport.js";
import { configureCloudinary } from "./uploads/cloudinary.js";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";
import { usersRouter } from "./routes/users.js";
import { uploadsRouter } from "./routes/uploads.js";
import { postRouter } from "./routes/post.js";
import { commentRouter } from "./routes/comment.js";
import { friendsRouter } from "./routes/friends.js";
import { messageRouter } from "./routes/message.js";
import { conversationRouter } from "./routes/conversation.js";
import { notificationsRouter } from "./routes/notifications.js";

// Create and configure the Express application.  

export function createApp() {
  const app = express();

  // ESM-compatible __dirname
  const __dirname = path.dirname(fileURLToPath(import.meta.url));

  configurePassport();
  configureCloudinary();

  app.use(morgan("dev"));
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (env.nodeEnv !== "production" && /^http:\/\/localhost:\d+$/.test(origin)) {
          return cb(null, true);
        }
        return cb(null, origin === env.clientOrigin);
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(passport.initialize());

  app.use("/api", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api", usersRouter);
  app.use("/api/uploads", uploadsRouter);
  app.use("/api/posts", postRouter);
  app.use("/api/posts", commentRouter);
  app.use("/api/friends", friendsRouter);
  app.use("/api/messages", messageRouter);
  app.use("/api/conversations", conversationRouter);
  app.use("/api/notifications", notificationsRouter);


  app.use((err, req, res, next) => {
    const message = err?.message ?? "Unknown error";
    const status = err?.statusCode ?? 500;
    if (env.nodeEnv !== "production") {
      // eslint-disable-next-line no-console
      console.error(err);
    }
    const body = { error: message };
    if (env.nodeEnv !== "production" && err?.stack) {
      body.stack = err.stack;
    }
    res.status(status).json(body);
  });

  return app;
}
