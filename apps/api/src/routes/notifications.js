const router = require("express").Router();
const { auth } = require("../middleware/auth");
const Notification = require("../models/Notification");

function clampInt(v, { min, max, fallback }) {
  const n = parseInt(String(v), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

// List notifications for current user
router.get("/", auth, async (req, res) => {
  const limit = clampInt(req.query.limit, { min: 1, max: 100, fallback: 20 });
  const page = clampInt(req.query.page, { min: 1, max: 100000, fallback: 1 });
  const unreadOnly = String(req.query.unread || "").toLowerCase() === "true";
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // read notifications older than 24h are hidden

  const companyId = req.employee.company || null;
  const baseQuery = {
    company: companyId,
    employee: req.employee.id,
  };

  const query = unreadOnly
    ? { ...baseQuery, readAt: null }
    : {
        ...baseQuery,
        $or: [{ readAt: null }, { readAt: { $gte: cutoff } }],
      };

  const [unreadCount, total, notifications] = await Promise.all([
    Notification.countDocuments({ ...baseQuery, readAt: null }),
    Notification.countDocuments(query),
    Notification.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);

  res.json({
    notifications,
    unreadCount,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    total,
    limit,
  });
});

// Mark one as read
router.put("/:id/read", auth, async (req, res) => {
  const companyId = req.employee.company || null;
  const updated = await Notification.findOneAndUpdate(
    {
      _id: req.params.id,
      company: companyId,
      employee: req.employee.id,
    },
    { $set: { readAt: new Date() } },
    { new: true }
  ).lean();

  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json({ notification: updated });
});

// Mark all as read
router.post("/read-all", auth, async (req, res) => {
  const now = new Date();
  const companyId = req.employee.company || null;
  const r = await Notification.updateMany(
    {
      company: companyId,
      employee: req.employee.id,
      readAt: null,
    },
    { $set: { readAt: now } }
  );
  res.json({ success: true, modified: r.modifiedCount || r.nModified || 0 });
});

module.exports = router;
