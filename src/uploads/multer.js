import multer from "multer";

function buildMulter({ maxBytes, allowedMimePrefixes, errorMessage }) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes },
    fileFilter: (req, file, cb) => {
      const mimetype = file?.mimetype ?? "";
      const allowed = allowedMimePrefixes.some((prefix) => mimetype.startsWith(prefix));
      if (!allowed) return cb(new Error(errorMessage));
      cb(null, true);
    },
  });
}

// Image-only uploads (avatars, etc.)
export const uploadImages = buildMulter({
  maxBytes: 5 * 1024 * 1024,
  allowedMimePrefixes: ["image/"],
  errorMessage: "Only image uploads are allowed",
});

// Posts/messages can be images or videos.
// Note: this stores files in memory; keep an eye on maxBytes.
export const uploadMedia = buildMulter({
  maxBytes: 25 * 1024 * 1024,
  allowedMimePrefixes: ["image/", "video/"],
  errorMessage: "Only image or video uploads are allowed",
});

// Back-compat: existing routes import { upload }.
export const upload = uploadImages;
