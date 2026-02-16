const router = require("express").Router();
const { auth } = require("../middleware/auth");
const { parseWithSchema } = require("../utils/zod");
const Client = require("../models/Client");
const Project = require("../models/Project");
const { clientSchema } = require("../../../libs/schemas/client");
const { upload, getStoredFileId } = require("../utils/fileStorage");

function allowAdminOrHR(req, res, next) {
  if (!req.employee) return res.status(401).json({ error: "Unauthorized" });
  const isAdmin = ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole);
  const isHr = (req.employee.subRoles || []).includes("hr");
  if (isAdmin || isHr) return next();
  return res.status(403).json({ error: "Forbidden" });
}

function sendSuccess(res, message, payload = {}) {
  if (message) res.set("X-Success-Message", message);
  return res.json({ message, ...payload });
}

// List clients for the company with project counts
router.get("/", auth, allowAdminOrHR, async (req, res) => {
  try {
    const companyId = req.employee.company;
    const clients = await Client.find({
      company: companyId,
      isDeleted: { $ne: true },
    })
      .sort({ name: 1 })
      .lean();

    // Count linked projects (tolerate legacy empty-string client values)
    const projects = await Project.find({
      company: companyId,
      isDeleted: { $ne: true },
    })
      .select("client")
      .lean();
    const countMap = projects.reduce((acc, p) => {
      const key = p.client ? String(p.client) : "";
      if (!key) return acc;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const payload = clients.map((c) => ({
      ...c,
      projectsCount: countMap[String(c._id)] || 0,
    }));
    res.json({ clients: payload });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load clients" });
  }
});

// Create client
router.post("/", auth, allowAdminOrHR, upload.single("logo"), async (req, res) => {
  const validation = parseWithSchema(clientSchema, req.body || {});
  if (!validation.ok) {
    return res
      .status(400)
      .json({ error: "Invalid client data", details: validation.issues });
  }
  try {
    const data = validation.data;
    if (req.file) {
      const logo = getStoredFileId(req.file);
      if (logo) data.logo = logo;
    }
    const client = await Client.create({
      ...data,
      company: req.employee.company,
      createdBy: req.employee.id,
    });
    sendSuccess(res, "Client added", { client });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to create client" });
  }
});

// Update client
router.put("/:id", auth, allowAdminOrHR, upload.single("logo"), async (req, res) => {
  const validation = parseWithSchema(clientSchema.partial(), req.body || {});
  if (!validation.ok) {
    return res
      .status(400)
      .json({ error: "Invalid client data", details: validation.issues });
  }
  try {
    const data = validation.data;
    if (req.file) {
      const logo = getStoredFileId(req.file);
      if (logo) data.logo = logo;
    }
    const client = await Client.findOneAndUpdate(
      { _id: req.params.id, company: req.employee.company },
      { $set: data },
      { new: true }
    );
    if (!client) return res.status(404).json({ error: "Client not found" });
    sendSuccess(res, "Client updated", { client });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to update client" });
  }
});

module.exports = router;
