const { buildPublicUrl } = require("./s3");

const MEDIA_FIELD_NAMES = new Set([
  "profileImage",
  "documents",
  "document",
  "logo",
  "logoSquare",
  "logoHorizontal",
  "logoUrl",
  "images",
  "image",
  "attachments",
  "attachment",
  "pdfFile",
  "partyLogo",
  "file",
  "fileId",
  "fileUrl",
]);

function isHttpUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

function encodePathForUrl(value = "") {
  return String(value)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function decodePathSegments(value = "") {
  return String(value)
    .split("/")
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch (_) {
        return part;
      }
    })
    .join("/");
}

function isAmazonS3Hostname(host) {
  return (
    host.endsWith(".amazonaws.com") &&
    (host === "s3.amazonaws.com" ||
      host.startsWith("s3.") ||
      host.startsWith("s3-") ||
      host.includes(".s3.") ||
      host.includes(".s3-"))
  );
}

function isLocalHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

function extractKeyFromConfiguredBase(parsed, rawPath) {
  const configuredBases = [
    process.env.AWS_S3_PUBLIC_BASE_URL,
    process.env.VITE_S3_PUBLIC_BASE_URL,
  ].filter(Boolean);

  for (const base of configuredBases) {
    try {
      const parsedBase = new URL(base);
      if (parsed.origin !== parsedBase.origin) continue;
      const basePath = parsedBase.pathname
        .replace(/^\/+/, "")
        .replace(/\/+$/, "");
      if (!basePath) return decodePathSegments(rawPath);
      if (rawPath.startsWith(`${basePath}/`)) {
        return decodePathSegments(rawPath.slice(basePath.length + 1));
      }
    } catch (_) {
      // Ignore malformed base URL values.
    }
  }
  return null;
}

function extractStorageKeyFromUrl(value) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    const rawPath = parsed.pathname.replace(/^\/+/, "");
    if (!rawPath) return null;

    if (isLocalHost(host)) {
      if (rawPath.startsWith("uploads/")) {
        return decodePathSegments(rawPath.slice("uploads/".length));
      }
      if (rawPath.startsWith("files/")) {
        return decodePathSegments(rawPath.slice("files/".length));
      }
      if (rawPath.startsWith("api/files/")) {
        return decodePathSegments(rawPath.slice("api/files/".length));
      }
      return null;
    }

    const fromConfiguredBase = extractKeyFromConfiguredBase(parsed, rawPath);
    if (fromConfiguredBase) return fromConfiguredBase;

    if (!isAmazonS3Hostname(host)) return null;

    const isPathStyleHost =
      host === "s3.amazonaws.com" || host.startsWith("s3.") || host.startsWith("s3-");
    if (!isPathStyleHost) return decodePathSegments(rawPath);

    const slash = rawPath.indexOf("/");
    if (slash <= 0 || slash === rawPath.length - 1) return null;
    return decodePathSegments(rawPath.slice(slash + 1));
  } catch (_) {
    return null;
  }
}

function extractStorageKey(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  if (isHttpUrl(raw)) {
    return extractStorageKeyFromUrl(raw);
  }

  if (raw.startsWith("/uploads/")) {
    return decodePathSegments(raw.slice("/uploads/".length));
  }
  if (raw.startsWith("uploads/")) {
    return decodePathSegments(raw.slice("uploads/".length));
  }
  if (raw.startsWith("/files/")) {
    return decodePathSegments(raw.slice("/files/".length));
  }
  if (raw.startsWith("/api/files/")) {
    return decodePathSegments(raw.slice("/api/files/".length));
  }
  if (raw.startsWith("api/files/")) {
    return decodePathSegments(raw.slice("api/files/".length));
  }

  return decodePathSegments(raw.replace(/^\/+/, ""));
}

function buildMediaUrlFromKey(key, options = {}) {
  const mediaBaseUrl = String(options.mediaBaseUrl || "").trim();
  if (mediaBaseUrl) {
    return `${mediaBaseUrl.replace(/\/+$/, "")}/${encodePathForUrl(key)}`;
  }
  return buildPublicUrl(key) || key;
}

function normalizeSingleMediaUrl(value, options = {}) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;

  const key = extractStorageKey(trimmed);
  if (!key) return trimmed;

  return buildMediaUrlFromKey(key, options);
}

function normalizeMediaFieldValue(value, options, seen) {
  if (value === null || typeof value === "undefined") return value;
  if (typeof value === "string") return normalizeSingleMediaUrl(value, options);
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeMediaFieldValue(entry, options, seen));
  }
  if (typeof value === "object") {
    return normalizeMediaUrlsInPayload(value, options, seen);
  }
  return value;
}

function normalizeMediaUrlsInPayload(payload, options = {}, seen = new WeakSet()) {
  if (payload === null || typeof payload === "undefined") return payload;
  if (typeof payload !== "object") return payload;

  if (Array.isArray(payload)) {
    return payload.map((entry) => normalizeMediaUrlsInPayload(entry, options, seen));
  }

  if (typeof payload.toJSON === "function") {
    try {
      return normalizeMediaUrlsInPayload(payload.toJSON(), options, seen);
    } catch (_) {
      // Fall through to best-effort object traversal.
    }
  }

  if (seen.has(payload)) return payload;
  seen.add(payload);

  const output = {};
  for (const [key, value] of Object.entries(payload)) {
    if (MEDIA_FIELD_NAMES.has(key)) {
      output[key] = normalizeMediaFieldValue(value, options, seen);
    } else {
      output[key] = normalizeMediaUrlsInPayload(value, options, seen);
    }
  }

  seen.delete(payload);
  return output;
}

module.exports = {
  extractStorageKey,
  normalizeSingleMediaUrl,
  normalizeMediaUrlsInPayload,
};
