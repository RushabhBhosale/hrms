const http = require("http");
const https = require("https");
const path = require("path");
const multer = require("multer");
const Employee = require("../models/Employee");
const {
  s3Enabled,
  uploadStreamToS3,
  uploadBufferToS3,
  getObjectBuffer,
  deleteFromS3,
} = require("./s3");
const { extractStorageKey, normalizeSingleMediaUrl } = require("./mediaUrl");

if (!s3Enabled) {
  throw new Error(
    "S3 is required for file storage. Please configure AWS_BUCKET_NAME, AWS_REGION, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY.",
  );
}
const MAX_LOGO_BYTES = 10 * 1024 * 1024; // 10MB
const DEFAULT_FILES_PREFIX =
  process.env.S3_FILES_PREFIX ||
  process.env.AWS_S3_FILES_PREFIX ||
  "files";
const DEFAULT_IMAGE_FOLDER =
  process.env.S3_IMAGE_FOLDER ||
  process.env.S3_UPLOAD_FOLDER ||
  "hrms/logos";
const OBJECT_ID_REGEX = /^[a-f\d]{24}$/i;

function sanitizePrefix(value) {
  if (!value) return "";
  return String(value).replace(/^\/+/, "").replace(/\/+$/, "");
}

function buildUniqueFilename(originalName = "") {
  const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const ext = path.extname(originalName || "").slice(0, 10);
  return ext ? `${unique}${ext}` : unique;
}

function buildObjectKey(originalName = "", folder = DEFAULT_FILES_PREFIX) {
  const safeFolder = sanitizePrefix(folder);
  const filename = buildUniqueFilename(originalName);
  return safeFolder ? `${safeFolder}/${filename}` : filename;
}

function buildImageObjectKey(publicId, originalName = "", folder = DEFAULT_IMAGE_FOLDER) {
  const safeFolder = sanitizePrefix(folder);
  if (publicId) {
    const ext = path.extname(originalName || "").slice(0, 10);
    const safeId = String(publicId).replace(/[^a-zA-Z0-9._/-]/g, "-");
    const key = ext ? `${safeId}${ext}` : safeId;
    return safeFolder ? `${safeFolder}/${key}` : key;
  }
  return buildObjectKey(originalName, folder);
}

function sanitizeEmployeeStorageId(value) {
  if (value === undefined || value === null) return "";
  return String(value)
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "-");
}

function getEmployeeStorageId(employee) {
  if (!employee) return "";
  return (
    sanitizeEmployeeStorageId(employee.employeeId) ||
    sanitizeEmployeeStorageId(employee._id) ||
    sanitizeEmployeeStorageId(employee.id)
  );
}

async function resolveEmployeeStorageId(candidate) {
  const raw = String(candidate || "").trim();
  if (!raw) return "";

  const direct = sanitizeEmployeeStorageId(raw);
  if (!OBJECT_ID_REGEX.test(raw)) {
    return direct;
  }

  try {
    const employee = await Employee.findById(raw).select("employeeId").lean();
    return sanitizeEmployeeStorageId(employee?.employeeId) || direct;
  } catch (_) {
    return direct;
  }
}

async function inferEmployeeFolder(req) {
  if (!req) return null;
  const route = `${req.baseUrl || ""}${req.path || ""}`.toLowerCase();
  const isEmployeeSpecific =
    route.includes("/auth/me") ||
    route.includes("/documents") ||
    route.includes("/employees");
  if (!isEmployeeSpecific) return null;

  const explicitEmployeeId =
    sanitizeEmployeeStorageId(req.body?.employeeId) ||
    sanitizeEmployeeStorageId(req.employee?.employeeId);

  const subFolder = route.includes("photo") || route.includes("avatar") ? "profile" : "documents";
  if (explicitEmployeeId) {
    return `employees/${explicitEmployeeId}/${subFolder}`;
  }

  const targetId =
    (req.params && (req.params.employeeId || req.params.id)) ||
    req.body?.employee ||
    req.employee?.id;
  if (!targetId) return null;

  const employeeStorageId = await resolveEmployeeStorageId(targetId);
  if (!employeeStorageId) return null;

  return `employees/${employeeStorageId}/${subFolder}`;
}

function createS3Storage() {
  return {
    _handleFile(req, file, cb) {
      inferEmployeeFolder(req)
        .catch(() => null)
        .then((resolvedFolder) => {
          const folder = resolvedFolder || DEFAULT_FILES_PREFIX;
          const key = buildObjectKey(file.originalname, folder);
          return uploadStreamToS3(file.stream, {
            key,
            contentType: file.mimetype,
          }).then(({ url }) => ({ key, url }));
        })
        .then(({ key, url }) =>
          cb(null, {
            key,
            filename: key,
            location: url || key,
          })
        )
        .catch((err) => cb(err));
    },
    _removeFile(_req, file, cb) {
      const key = file?.key || file?.filename;
      if (!key) return cb(null);
      deleteFromS3(key)
        .catch(() => {})
        .finally(() => cb(null));
    },
  };
}

const storage = createS3Storage();

const upload = multer({ storage });
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_LOGO_BYTES },
});
const imageUpload = logoUpload;
const avatarUpload = logoUpload;

function isHttpUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

function getStoredFileId(file) {
  if (!file) return null;
  const urlFirst = file.location || file.url;
  if (isHttpUrl(urlFirst)) return normalizeSingleMediaUrl(urlFirst);
  const key = file.key || file.filename;
  if (key) return normalizeSingleMediaUrl(key);
  return urlFirst ? normalizeSingleMediaUrl(urlFirst) : null;
}

async function persistImageFromFile(file, options = {}) {
  if (!file) throw new Error("No image file provided");
  if (!/^image\//i.test(file.mimetype || "")) throw new Error("File must be an image");

  const key = buildImageObjectKey(options.publicId, file.originalname, options.folder);
  const uploadResult = file.buffer
    ? await uploadBufferToS3(file.buffer, {
        key,
        contentType: file.mimetype,
      })
    : file.stream
    ? await uploadStreamToS3(file.stream, {
        key,
        contentType: file.mimetype,
      })
    : null;

  if (!uploadResult || !(uploadResult.url || uploadResult.key)) {
    throw new Error("Failed to upload image to S3");
  }
  return normalizeSingleMediaUrl(uploadResult.url || uploadResult.key);
}

function fetchBufferFromUrl(url) {
  const client = url.startsWith("https") ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject);
  });
}

async function loadFileBuffer(fileId) {
  if (!fileId) return null;
  const value = String(fileId);
  try {
    if (isHttpUrl(value)) {
      const keyFromUrl = extractStorageKey(value);
      if (keyFromUrl) {
        const fromS3 = await getObjectBuffer(keyFromUrl);
        if (fromS3) return fromS3;
      }
      return await fetchBufferFromUrl(value);
    }
    const key = extractStorageKey(value) || value;
    return await getObjectBuffer(key);
  } catch (err) {
    console.warn("[file-storage] failed to load file buffer", value, err?.message || err);
    return null;
  }
}

async function deleteStoredFile(fileId) {
  if (!fileId) return;
  const value = String(fileId);
  try {
    if (isHttpUrl(value)) {
      const keyFromUrl = extractStorageKey(value);
      if (keyFromUrl) {
        await deleteFromS3(keyFromUrl);
      }
      return;
    }
    const key = extractStorageKey(value) || value;
    await deleteFromS3(key);
  } catch (err) {
    console.warn("[file-storage] delete failed:", err?.message || err);
  }
}

async function deleteStoredFiles(ids = []) {
  if (!Array.isArray(ids)) return;
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    await deleteStoredFile(id);
  }
}

module.exports = {
  upload,
  logoUpload,
  imageUpload,
  avatarUpload,
  persistImageFromFile,
  loadFileBuffer,
  isHttpUrl,
  getStoredFileId,
  deleteStoredFile,
  deleteStoredFiles,
  buildObjectKey,
  buildImageObjectKey,
  getEmployeeStorageId,
};
