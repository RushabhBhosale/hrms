const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "commonjs",
    moduleResolution: "node",
    esModuleInterop: true,
    target: "ES2020",
    skipLibCheck: true,
  },
});

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { connectDB } = require("./config");
const { getObjectStream } = require("./utils/s3");
const { normalizeMediaUrlsInPayload } = require("./utils/mediaUrl");
const { scheduleAutoLeaveJob } = require("./jobs/autoLeave");

const app = express();

// If you ever put Nginx/ELB in front, this helps with IPs/cookies
app.set("trust proxy", 1);

app.use(express.json());
app.use(cookieParser());

// If UI + API are same-origin (recommended), you can set origin to CLIENT_ORIGIN or true.
// With Nginx proxying to /api, same-origin calls won’t need CORS anyway.
app.use(cors({
  origin: process.env.CLIENT_ORIGIN || true,
  credentials: true,
  exposedHeaders: ["X-Success-Message"],
}));

// Allow frontend to read custom success header for toasts
app.use((req, res, next) => {
  res.header("Access-Control-Expose-Headers", "X-Success-Message");
  next();
});

function readFirstForwarded(value) {
  if (Array.isArray(value)) return String(value[0] || "").trim() || null;
  if (typeof value !== "string") return null;
  const first = value.split(",")[0];
  return first ? first.trim() : null;
}

function getRequestOrigin(req) {
  const forwardedProto = readFirstForwarded(req.headers["x-forwarded-proto"]);
  const forwardedHost = readFirstForwarded(req.headers["x-forwarded-host"]);
  const protocol = forwardedProto || req.protocol || "http";
  const host = forwardedHost || req.get("host");
  if (!host) return null;
  return `${protocol}://${host}`;
}

// Normalize media fields in all JSON responses so clients always receive full URLs.
app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (payload) => {
    try {
      const origin = getRequestOrigin(req);
      const mediaBaseUrl = origin ? `${origin}/api/files` : null;
      return originalJson(
        normalizeMediaUrlsInPayload(payload, {
          mediaBaseUrl,
        })
      );
    } catch (err) {
      console.warn("[media-url] response normalization failed:", err?.message || err);
      return originalJson(payload);
    }
  };
  next();
});

// Serve stored files directly from S3.
async function serveFile(req, res, _next) {
  const key = (req.params[0] || "").replace(/^\/+/, "");
  if (!key) return res.status(404).end();
  const s3Obj = await getObjectStream(key);
  if (s3Obj && s3Obj.Body) {
    if (s3Obj.ContentType) res.setHeader("Content-Type", s3Obj.ContentType);
    if (s3Obj.ContentLength) res.setHeader("Content-Length", s3Obj.ContentLength);
    if (s3Obj.LastModified) res.setHeader("Last-Modified", s3Obj.LastModified.toUTCString());
    return s3Obj.Body.pipe(res);
  }
  return res.status(404).end();
}

app.get("/files/*", serveFile);
app.get("/api/files/*", serveFile);

app.get("/", (req, res) => res.json({ ok: true }));

// Your routes stay as-is (no /api prefix here). Nginx will add /api on the outside.
app.use("/auth", require("./routes/auth"));
app.use("/seed", require("./routes/seed"));
app.use("/companies", require("./routes/companies"));
app.use("/onboarding", require("./routes/onboarding"));
app.use("/attendance", require("./routes/attendance"));
app.use("/leaves", require("./routes/leaves"));
app.use("/unpaid-leaves", require("./routes/unpaidLeaves"));
app.use("/documents", require("./routes/documents"));
app.use("/projects", require("./routes/projects"));
app.use("/notifications", require("./routes/notifications"));
app.use("/salary", require("./routes/salary"));
app.use("/announcements", require("./routes/announcements"));
app.use("/invoices", require("./routes/invoices"));
app.use("/expenses", require("./routes/expenses"));
app.use("/finance", require("./routes/finance"));
app.use("/reimbursements", require("./routes/reimbursements"));
app.use("/clients", require("./routes/clients"));
app.use("/masters", require("./routes/masters"));
app.use("/performance", require("./routes/performance"));

connectDB().then(() => {
  const port = process.env.PORT || 4000;
  const host = process.env.HOST || "127.0.0.1";
  app.listen(port, host, () => console.log("API on " + host + ":" + port));
  scheduleAutoLeaveJob();
});
