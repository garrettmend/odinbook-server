import { v2 as cloudinary } from "cloudinary";
import streamifier from "streamifier";
import { env, hasCloudinaryConfigured } from "../config/env.js";

// Cloudinary needs global configuration (cloud name + API key/secret).
// We call this once during app startup.
export function configureCloudinary() {
  // In dev/learning environments you might not have Cloudinary env vars.
  // Instead of crashing on startup, we no-op here and throw only when you
  // actually try to upload.
  if (!hasCloudinaryConfigured()) return;

  cloudinary.config({
    cloud_name: env.cloudinaryCloudName,
    api_key: env.cloudinaryApiKey,
    api_secret: env.cloudinaryApiSecret,
  });
}

// Upload an in-memory Buffer to Cloudinary.
// Why streaming? Cloudinary's Node SDK provides an upload_stream API which
// accepts a stream instead of needing a temp file path on disk.
export async function uploadBufferToCloudinary({ buffer, folder, publicId, resourceType = "image" }) {
  if (!hasCloudinaryConfigured()) {
    throw new Error("Cloudinary is not configured (missing env vars)");
  }

  // Wrap the callback-style Cloudinary API in a Promise so we can `await` it.
  return await new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        // Cloudinary folder (purely organizational)
        folder,
        // public_id is Cloudinary's identifier for the asset.
        // If you pass a stable value (like userId), you can keep exactly one
        // avatar per user.
        public_id: publicId,
        // If an asset with this public_id already exists, replace it.
        overwrite: true,
        // Cloudinary distinguishes between image/video/raw.
        // Use "auto" when you might upload either image/* or video/*.
        resource_type: resourceType,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      },
    );

    // Convert the Buffer into a readable stream and pipe it into Cloudinary.
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
}

// Delete an image by Cloudinary public_id.
// This is used to avoid orphaned images when a user uploads a new avatar.
export async function deleteFromCloudinary(publicId) {
  return await deleteFromCloudinaryWithOptions(publicId);
}

export async function deleteFromCloudinaryWithOptions(
  publicId,
  { resourceType = "image" } = {},
) {
  // Deletion is best-effort; if Cloudinary isn't configured, just skip.
  if (!hasCloudinaryConfigured()) return;
  if (!publicId) return;
  await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
}
