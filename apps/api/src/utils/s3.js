const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");

const bucket = process.env.AWS_BUCKET_NAME;
const region = process.env.AWS_REGION;
const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
const customEndpoint = process.env.AWS_S3_ENDPOINT;
const FALLBACK_BUCKET = "peracto-hrms";
const FALLBACK_REGION = "ap-south-1";
const defaultAcl = (() => {
  // Respect explicit ACLs; leave undefined to rely on bucket policy/object ownership.
  const raw = (process.env.AWS_S3_ACL || "").trim();
  if (!raw) return undefined;
  if (raw.toLowerCase() === "none") return undefined;
  return raw;
})();

const s3Enabled = !!bucket && !!region;
const hasStaticCredentials = !!accessKeyId && !!secretAccessKey;

let s3Client = null;
if (s3Enabled) {
  const clientConfig = {
    region,
    forcePathStyle: process.env.AWS_S3_FORCE_PATH_STYLE === "true",
  };
  if (customEndpoint) clientConfig.endpoint = customEndpoint;
  if (hasStaticCredentials) {
    clientConfig.credentials = {
      accessKeyId,
      secretAccessKey,
    };
  }
  s3Client = new S3Client(clientConfig);
}

function encodeKeyForUrl(key = "") {
  return String(key)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function buildPublicUrl(key) {
  const customBase = (
    process.env.AWS_S3_PUBLIC_BASE_URL || process.env.VITE_S3_PUBLIC_BASE_URL || ""
  ).trim();
  if (customBase) {
    return `${customBase.replace(/\/$/, "")}/${encodeKeyForUrl(key)}`;
  }
  const publicBucket = bucket || FALLBACK_BUCKET;
  const publicRegion = region || FALLBACK_REGION;
  return `https://${publicBucket}.s3.${publicRegion}.amazonaws.com/${encodeKeyForUrl(key)}`;
}

let loggedAclFallback = false;
function isAclUnsupportedError(err) {
  const code = String(err?.name || err?.Code || err?.code || "").toLowerCase();
  const message = String(err?.message || "").toLowerCase();
  return (
    code.includes("accesscontrollistnotsupported") ||
    code.includes("putobjectacl") ||
    ((code.includes("invalidrequest") || code.includes("accessdenied")) &&
      (message.includes("acl") ||
        message.includes("access control list") ||
        message.includes("putobjectacl")))
  );
}

async function withAclFallback(params, run) {
  try {
    return await run(params);
  } catch (err) {
    if (!params?.ACL || !isAclUnsupportedError(err)) throw err;
    if (!loggedAclFallback) {
      loggedAclFallback = true;
      console.warn(
        "[s3] Upload ACL was rejected by bucket policy/object ownership. Retrying without ACL. Set AWS_S3_ACL=none to avoid this warning.",
      );
    }
    const { ACL, ...withoutAcl } = params;
    return run(withoutAcl);
  }
}

async function uploadStreamToS3(stream, { key, contentType } = {}) {
  if (!s3Enabled || !s3Client) {
    throw new Error("S3 is not configured");
  }
  const params = {
    Bucket: bucket,
    Key: key,
    Body: stream,
    ...(contentType ? { ContentType: contentType } : {}),
    ...(defaultAcl ? { ACL: defaultAcl } : {}),
  };
  const result = await withAclFallback(params, async (finalParams) => {
    const uploader = new Upload({
      client: s3Client,
      params: finalParams,
    });
    return uploader.done();
  });
  return {
    key,
    etag: result?.ETag || null,
    url: buildPublicUrl(key),
  };
}

async function uploadBufferToS3(buffer, options = {}) {
  if (!s3Enabled || !s3Client) {
    throw new Error("S3 is not configured");
  }
  const params = {
    Bucket: bucket,
    Key: options.key,
    Body: buffer,
    ...(defaultAcl ? { ACL: defaultAcl } : {}),
  };
  if (options.contentType) params.ContentType = options.contentType;
  await withAclFallback(params, async (finalParams) =>
    s3Client.send(new PutObjectCommand(finalParams))
  );
  return {
    key: options.key,
    url: buildPublicUrl(options.key),
  };
}

async function getObjectBuffer(key) {
  if (!s3Enabled || !s3Client) return null;
  try {
    const res = await s3Client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
    if (!res || !res.Body) return null;
    const chunks = [];
    for await (const chunk of res.Body) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch (err) {
    console.warn("[s3] getObjectBuffer failed:", err?.message || err);
    return null;
  }
}

async function getObjectStream(key) {
  if (!s3Enabled || !s3Client) return null;
  try {
    const res = await s3Client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
    if (!res || !res.Body) return null;
    return res;
  } catch (err) {
    console.warn("[s3] getObjectStream failed:", err?.message || err);
    return null;
  }
}

async function deleteFromS3(key) {
  if (!s3Enabled || !s3Client || !key) return;
  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
  } catch (err) {
    console.warn("[s3] delete failed:", err?.message || err);
  }
}

module.exports = {
  s3Enabled,
  uploadStreamToS3,
  uploadBufferToS3,
  getObjectBuffer,
  getObjectStream,
  deleteFromS3,
  buildPublicUrl,
};
