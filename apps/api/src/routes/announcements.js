const router = require("express").Router();
const Announcement = require("../models/Announcement");
const { auth } = require("../middleware/auth");
const { parseWithSchema } = require("../utils/zod");
const { announcementSchema } = require("../../../libs/schemas/announcement");

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
  const expiresAtInput = req.body?.expiresAt;
  const expiresAt =
    expiresAtInput === "" || expiresAtInput === null
      ? undefined
      : expiresAtInput;

  const validation = parseWithSchema(announcementSchema, {
    company: String(req.employee.company),
    title: req.body?.title,
    message: req.body?.message,
    expiresAt,
    createdBy: String(req.employee.id),
  });

  if (!validation.ok) {
    return res
      .status(400)
      .json({ error: "Invalid announcement data", details: validation.issues });
  }

  const payload = {
    ...validation.data,
    title: validation.data.title.trim(),
    message: validation.data.message.trim(),
  };

  const ann = await Announcement.create(payload);
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
