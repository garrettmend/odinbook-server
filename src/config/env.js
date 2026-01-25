import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, "../..");

// Load environment variables from server/.env.
// This is monorepo-safe: no matter what your process.cwd is, we load the same file.
dotenv.config({ path: path.resolve(serverRoot, ".env") });

function getEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",

  // Prisma reads DATABASE_URL via prisma.config.ts.
  // For Postgres this should look like:
  //   postgresql://USER:PASSWORD@HOST:5432/DB_NAME?schema=public
  databaseUrl: getEnv("DATABASE_URL"),

  // JWT settings used for signing and verifying access tokens.
  jwtSecret: getEnv("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",

  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME ?? "",
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY ?? "",
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET ?? "",
};

export function hasCloudinaryConfigured() {
  return Boolean(
    env.cloudinaryCloudName && env.cloudinaryApiKey && env.cloudinaryApiSecret,
  );
}
