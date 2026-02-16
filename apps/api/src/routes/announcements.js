const router = require("express").Router();
const Announcement = require("../models/Announcement");
const Notification = require("../models/Notification");
const Employee = require("../models/Employee");
const {
  upload,
  getStoredFileId,
  deleteStoredFiles,
} = require("../utils/fileStorage");
const { auth } = require("../middleware/auth");
const { parseWithSchema } = require("../utils/zod");
const { announcementSchema } = require("../../../libs/schemas/announcement");
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function canManage(req) {
  const p = req.employee?.primaryRole;
  if (p === "ADMIN" || p === "SUPERADMIN") return true;
  const subs = req.employee?.subRoles || [];
  return subs.includes("hr");
}

function isAdminOrSuperAdmin(req) {
  const p = req.employee?.primaryRole;
  return p === "ADMIN" || p === "SUPERADMIN";
}

function hasOwn(obj, key) {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

function parseStringList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((v) => String(v || "").trim())
          .filter(Boolean)
      )
    );
  }
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parseStringList(parsed);
    } catch (_) {
      // Treat as plain string when JSON parse fails.
    }
    return [raw];
  }
  return [];
}

// List announcements for my company (non-expired first)
router.get("/", auth, async (req, res) => {
  try {
    const companyId = req.employee.company;
    const now = new Date();

    // Get mongoose documents (no .lean())
    const docs = await Announcement.find({
      company: companyId,
      isDeleted: { $ne: true },
      isActive: { $ne: false },
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
router.post("/", auth, upload.array("images", 8), async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: "Forbidden" });
  const uploadedImages = (req.files || [])
    .map((f) => getStoredFileId(f))
    .filter(Boolean);
  const inputImages = parseStringList(req.body?.images);
  const images = Array.from(new Set([...inputImages, ...uploadedImages]));

  const expiresAtInput = req.body?.expiresAt;
  const expiresAt =
    expiresAtInput === "" ||
    expiresAtInput === null ||
    typeof expiresAtInput === "undefined"
      ? new Date(Date.now() + ONE_DAY_MS)
      : expiresAtInput;

  const validation = parseWithSchema(announcementSchema, {
    company: String(req.employee.company),
    title: req.body?.title,
    message: req.body?.message,
    images,
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
  };

  const ann = await Announcement.create(payload);
  res.status(201).json({ announcement: ann });

  // Fire-and-forget in-app notifications for all employees in the company
  (async () => {
    try {
      const employees = await Employee.find({
        company: req.employee.company,
        isDeleted: { $ne: true },
        isActive: { $ne: false },
      })
        .select("_id")
        .lean();
      if (!employees.length) return;

      const docs = employees.map((emp) => ({
        company: req.employee.company,
        employee: emp._id,
        type: "ANNOUNCEMENT",
        title: validation.data.title,
        message: validation.data.message,
        link: "/announcements",
        meta: { announcementId: String(ann._id) },
      }));

      await Notification.insertMany(docs, { ordered: false });
    } catch (e) {
      console.warn(
        "[announcements] Failed to create notification entries:",
        e?.message || e
      );
    }
  })();
});

// Delete announcement (creator or ADMIN/SUPERADMIN)
router.delete("/:id", auth, async (req, res) => {
  const { id } = req.params;
  const ann = await Announcement.findOne({
    _id: id,
    company: req.employee.company,
    isDeleted: { $ne: true },
  });
  if (!ann) return res.status(404).json({ error: "Not found" });
  const isCreator = String(ann.createdBy) === String(req.employee?.id || "");
  if (!isAdminOrSuperAdmin(req) && !isCreator) {
    return res.status(403).json({ error: "Forbidden" });
  }
  ann.isDeleted = true;
  ann.isActive = false;
  await ann.save();
  res.json({ message: "Deleted" });
});

// Update announcement (creator or ADMIN/SUPERADMIN)
router.put("/:id", auth, upload.array("images", 8), async (req, res) => {
  const { id } = req.params;

  const ann = await Announcement.findOne({
    _id: id,
    company: req.employee.company,
    isDeleted: { $ne: true },
  });
  if (!ann) return res.status(404).json({ error: "Not found" });

  const isCreator = String(ann.createdBy) === String(req.employee?.id || "");
  if (!isAdminOrSuperAdmin(req) && !isCreator) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const uploadedImages = (req.files || [])
    .map((f) => getStoredFileId(f))
    .filter(Boolean);
  const existingImages = parseStringList(ann.images);
  const requestedRetainImages = hasOwn(req.body, "retainImages")
    ? parseStringList(req.body.retainImages)
    : null;

  let images = existingImages;
  if (requestedRetainImages !== null) {
    const removedImages = existingImages.filter(
      (img) => !requestedRetainImages.includes(img)
    );
    if (removedImages.length) {
      await deleteStoredFiles(removedImages);
    }
    images = requestedRetainImages;
  }
  if (uploadedImages.length) {
    images = Array.from(new Set([...images, ...uploadedImages]));
  }

  const title =
    typeof req.body?.title === "string" ? req.body.title : ann.title;
  const message =
    typeof req.body?.message === "string" ? req.body.message : ann.message;
  const expiresAtInput = req.body?.expiresAt;
  const expiresAt =
    expiresAtInput === undefined
      ? ann.expiresAt
      : expiresAtInput === "" || expiresAtInput === null
      ? undefined
      : expiresAtInput;

  const validation = parseWithSchema(announcementSchema, {
    company: String(req.employee.company || ann.company),
    title,
    message,
    images,
    expiresAt,
    createdBy: String(ann.createdBy || req.employee.id),
    isDeleted: ann.isDeleted,
    isActive: ann.isActive,
  });

  if (!validation.ok) {
    return res
      .status(400)
      .json({ error: "Invalid announcement data", details: validation.issues });
  }

  ann.title = validation.data.title;
  ann.message = validation.data.message;
  ann.images = parseStringList(validation.data.images);
  ann.expiresAt = validation.data.expiresAt;
  ann.isActive = validation.data.isActive ?? ann.isActive;
  await ann.save();

  res.json({ announcement: ann });

  // Notify everyone about the update
  (async () => {
    try {
      const employees = await Employee.find({
        company: req.employee.company,
        isDeleted: { $ne: true },
        isActive: { $ne: false },
      })
        .select("_id")
        .lean();
      if (!employees.length) return;

      const docs = employees.map((emp) => ({
        company: req.employee.company,
        employee: emp._id,
        type: "ANNOUNCEMENT",
        title: `Updated: ${validation.data.title}`,
        message: validation.data.message,
        link: "/announcements",
        meta: { announcementId: String(ann._id), updated: true },
      }));

      await Notification.insertMany(docs, { ordered: false });
    } catch (e) {
      console.warn(
        "[announcements] Failed to notify on update:",
        e?.message || e
      );
    }
  })();
});

module.exports = router;
