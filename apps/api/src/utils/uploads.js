const fs = require("fs");
const path = require("path");
const multer = require("multer");

const projectRoot = path.resolve(__dirname, "../..");

function resolveUploadsDir() {
  const fromEnv = process.env.UPLOADS_DIR;
  if (typeof fromEnv === "string" && fromEnv.trim()) {
    const trimmed = fromEnv.trim();
    return path.isAbsolute(trimmed)
      ? trimmed
      : path.resolve(projectRoot, trimmed);
  }
  return path.join(projectRoot, "uploads");
}

const uploadsDir = resolveUploadsDir();

try {
  fs.mkdirSync(uploadsDir, { recursive: true });
} catch (err) {
  console.error(`[uploads] Failed to ensure uploads directory at ${uploadsDir}:`, err);
  throw err;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname || "").slice(0, 10);
    cb(null, ext ? `${unique}${ext}` : unique);
  },
});

const upload = multer({ storage });

module.exports = {
  uploadsDir,
  upload,
};
