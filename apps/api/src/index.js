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
const { uploadsDir } = require("./utils/uploads");
const { scheduleAutoPunchOut } = require("./jobs/autoPunchOut");

const app = express();

// If you ever put Nginx/ELB in front, this helps with IPs/cookies
app.set("trust proxy", 1);

app.use(express.json());
app.use(cookieParser());

// If UI + API are same-origin (recommended), you can set origin to CLIENT_ORIGIN or true.
// With Nginx proxying to /api, same-origin calls won’t need CORS anyway.
app.use(cors({
  origin: process.env.CLIENT_ORIGIN || true,
  credentials: true
}));

// Expose uploaded assets on both /uploads (convenient for local dev)
// and /api/uploads (works when the API sits behind an /api proxy).
app.use("/uploads", express.static(uploadsDir));
app.use("/api/uploads", express.static(uploadsDir));

app.get("/", (req, res) => res.json({ ok: true }));

// Your routes stay as-is (no /api prefix here). Nginx will add /api on the outside.
app.use("/auth", require("./routes/auth"));
app.use("/seed", require("./routes/seed"));
app.use("/companies", require("./routes/companies"));
app.use("/attendance", require("./routes/attendance"));
app.use("/leaves", require("./routes/leaves"));
app.use("/documents", require("./routes/documents"));
app.use("/projects", require("./routes/projects"));
app.use("/salary", require("./routes/salary"));
app.use("/announcements", require("./routes/announcements"));
app.use("/invoices", require("./routes/invoices"));
app.use("/expenses", require("./routes/expenses"));
app.use("/finance", require("./routes/finance"));
app.use("/masters", require("./routes/masters"));

connectDB().then(() => {
  const port = process.env.PORT || 4000;
  const host = process.env.HOST || "127.0.0.1";
  app.listen(port, host, () => console.log("API on " + host + ":" + port));
  scheduleAutoPunchOut();
});
