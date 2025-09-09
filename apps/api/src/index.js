const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const path = require("path");
const { connectDB } = require("./config");
const { scheduleAutoPunchOut } = require("./jobs/autoPunchout");

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(cors({ origin: process.env.CLIENT_ORIGIN, credentials: true }));
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

app.get("/", (req, res) => res.json({ ok: true }));
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

connectDB().then(() => {
  const port = process.env.PORT || 4000;
  app.listen(port, () => console.log("API on " + port));
  scheduleAutoPunchOut();
});
