const router = require("express").Router();
const Announcement = require("../models/Announcement");
const { auth } = require("../middleware/auth");

function canManage(req) {
  const p = req.employee?.primaryRole;
  if (p === "ADMIN" || p === "SUPERADMIN") return true;
  const subs = req.employee?.subRoles || [];
  return subs.includes("hr");
}

// List announcements for my company (non-expired first)
router.get("/", auth, async (req, res) => {
  try {
    const companyId = req.employee.company;
    const now = new Date();

    // Get mongoose documents (no .lean())
    const docs = await Announcement.find({
      company: companyId,
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: null },
        { expiresAt: { $gt: now } },
      ],
    }).sort({ createdAt: -1 });

    // Decrypt fields on each doc, then send plain objects
    const anns = docs.map((d) => {
      d.decryptFieldsSync(); // <- decrypts title/message
      return d.toObject(); // plain object for JSON
    });

    res.json({ announcements: anns });
  } catch (e) {
    console.error("ann list error", e);
    res.status(500).json({ error: "Failed to load announcements" });
  }
});

// Create announcement (ADMIN/SUPERADMIN or HR subrole)
router.post("/", auth, async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: "Forbidden" });
  const { title, message, expiresAt } = req.body || {};
  if (!title || !message)
    return res.status(400).json({ error: "Missing title or message" });
  const data = {
    company: req.employee.company,
    title: String(title).trim(),
    message: String(message).trim(),
    createdBy: req.employee.id,
  };
  if (expiresAt) {
    const d = new Date(expiresAt);
    if (isNaN(d.getTime()))
      return res.status(400).json({ error: "Invalid expiresAt" });
    data.expiresAt = d;
  }
  const ann = await Announcement.create(data);
  res.status(201).json({ announcement: ann });
});

// Delete announcement (ADMIN/SUPERADMIN or HR)
router.delete("/:id", auth, async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: "Forbidden" });
  const { id } = req.params;
  const ann = await Announcement.findOne({
    _id: id,
    company: req.employee.company,
  });
  if (!ann) return res.status(404).json({ error: "Not found" });
  await Announcement.deleteOne({ _id: ann._id });
  res.json({ message: "Deleted" });
});

module.exports = router;
