const router = require("express").Router();

const { auth } = require("../middleware/auth");
const Reimbursement = require("../models/Reimbursement");
const ReimbursementType = require("../models/ReimbursementType");
const Project = require("../models/Project");
const Expense = require("../models/Expense");
const ExpenseCategory = require("../models/ExpenseCategory");
const { upload, getStoredFileId, deleteStoredFiles } = require("../utils/fileStorage");

function sendSuccess(res, message, payload = {}) {
  if (message) res.set("X-Success-Message", message);
  return res.json({ message, ...payload });
}

function isAdmin(emp) {
  return ["ADMIN", "SUPERADMIN"].includes(emp?.primaryRole);
}

function removeFiles(filenames = []) {
  deleteStoredFiles(filenames);
}

function parseNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }
  return undefined;
}

async function ensureExpenseCategory(companyId, employeeId, name = "Reimbursements") {
  let cat = await ExpenseCategory.findOne({
    company: companyId,
    name,
    isDeleted: { $ne: true },
  });
  if (cat) return cat;
  cat = await ExpenseCategory.create({
    company: companyId,
    name,
    isDefault: false,
    createdBy: employeeId,
  });
  return cat;
}

// ----- Type management -----

router.get("/types", auth, async (req, res) => {
  try {
    if (!req.employee.company)
      return res.status(400).json({ error: "Company not set for employee" });

    const includeInactive =
      String(req.query.includeInactive || "").toLowerCase() === "true";
    const filter = {
      company: req.employee.company,
      isDeleted: { $ne: true },
    };
    if (!includeInactive) filter.isActive = { $ne: false };

    const types = await ReimbursementType.find(filter)
      .sort({ name: 1 })
      .lean();
    res.json({ types });
  } catch (err) {
    console.error("reimbursement types list error", err);
    res.status(500).json({ error: "Failed to load reimbursement types" });
  }
});

router.post("/types", auth, async (req, res) => {
  if (!isAdmin(req.employee))
    return res.status(403).json({ error: "Forbidden" });
  const name = (req.body?.name || "").trim();
  const description = (req.body?.description || "").trim();
  const isActive =
    String(req.body?.isActive ?? "true").toLowerCase() !== "false";

  if (!name) return res.status(400).json({ error: "Name is required" });
  if (!req.employee.company)
    return res.status(400).json({ error: "Company not set for employee" });

  try {
    const existing = await ReimbursementType.findOne({
      company: req.employee.company,
      name,
      isDeleted: { $ne: true },
    });
    if (existing)
      return res.status(400).json({ error: "Type with this name exists" });

    const type = await ReimbursementType.create({
      company: req.employee.company,
      name,
      description,
      isActive,
      createdBy: req.employee.id,
      updatedBy: req.employee.id,
    });
    res.status(201);
    sendSuccess(res, "Reimbursement type created", { type });
  } catch (err) {
    console.error("reimbursement type create error", err);
    res.status(500).json({ error: "Failed to create type" });
  }
});

router.put("/types/:id", auth, async (req, res) => {
  if (!isAdmin(req.employee))
    return res.status(403).json({ error: "Forbidden" });
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: "Missing type id" });

  try {
    const type = await ReimbursementType.findOne({
      _id: id,
      company: req.employee.company,
      isDeleted: { $ne: true },
    });
    if (!type) return res.status(404).json({ error: "Type not found" });

    const updates = {};
    if (req.body.name !== undefined) {
      const name = String(req.body.name || "").trim();
      if (!name) return res.status(400).json({ error: "Name is required" });
      const duplicate = await ReimbursementType.findOne({
        _id: { $ne: id },
        company: req.employee.company,
        name,
        isDeleted: { $ne: true },
      });
      if (duplicate)
        return res.status(400).json({ error: "Type with this name exists" });
      updates.name = name;
    }
    if (req.body.description !== undefined)
      updates.description = String(req.body.description || "").trim();
    if (req.body.isActive !== undefined) {
      updates.isActive =
        String(req.body.isActive).toLowerCase() !== "false";
    }

    Object.assign(type, updates, { updatedBy: req.employee.id });
    await type.save();

    if (updates.name) {
      await Reimbursement.updateMany(
        { company: req.employee.company, type: type._id },
        { typeName: updates.name }
      );
    }

    sendSuccess(res, "Reimbursement type updated", { type });
  } catch (err) {
    console.error("reimbursement type update error", err);
    res.status(500).json({ error: "Failed to update type" });
  }
});

router.delete("/types/:id", auth, async (req, res) => {
  if (!isAdmin(req.employee))
    return res.status(403).json({ error: "Forbidden" });
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: "Missing type id" });

  try {
    const type = await ReimbursementType.findOne({
      _id: id,
      company: req.employee.company,
      isDeleted: { $ne: true },
    });
    if (!type) return res.status(404).json({ error: "Type not found" });

    type.isDeleted = true;
    type.isActive = false;
    type.updatedBy = req.employee.id;
    await type.save();

    sendSuccess(res, "Reimbursement type removed", { typeId: id });
  } catch (err) {
    console.error("reimbursement type delete error", err);
    res.status(500).json({ error: "Failed to delete type" });
  }
});

// ----- Reimbursements -----

router.get("/", auth, async (req, res) => {
  try {
    if (!req.employee.company)
      return res.status(400).json({ error: "Company not set for employee" });

    const query = { company: req.employee.company };
    const allowedStatuses = ["PENDING", "APPROVED", "REJECTED"];
    const statusRaw = (req.query.status || "").toString().trim().toUpperCase();
    if (statusRaw && statusRaw !== "ALL" && allowedStatuses.includes(statusRaw))
      query.status = statusRaw;

    const typeId = req.query.typeId || req.query.type;
    if (typeId) query.type = typeId;

    const projectId = req.query.projectId || req.query.project;
    if (projectId) query.project = projectId;

    if (isAdmin(req.employee)) {
      if (req.query.employeeId) query.employee = req.query.employeeId;
    } else {
      query.employee = req.employee.id;
    }

    const reimbursements = await Reimbursement.find(query)
      .sort({ createdAt: -1 })
      .populate("type", "name isActive")
      .populate("employee", "name employeeId")
      .populate("project", "title isActive isDeleted")
      .lean();

    res.json({ reimbursements });
  } catch (err) {
    console.error("reimbursements list error", err);
    res.status(500).json({ error: "Failed to load reimbursements" });
  }
});

router.post("/", auth, upload.array("attachments", 5), async (req, res) => {
  const attachments = (req.files || [])
    .map((f) => getStoredFileId(f))
    .filter(Boolean);
  try {
    if (!req.employee.company) {
      removeFiles(attachments);
      return res.status(400).json({ error: "Company not set for employee" });
    }

    const typeId = req.body.typeId || req.body.type;
    if (!typeId) {
      removeFiles(attachments);
      return res.status(400).json({ error: "Reimbursement type is required" });
    }
    const type = await ReimbursementType.findOne({
      _id: typeId,
      company: req.employee.company,
      isDeleted: { $ne: true },
      isActive: { $ne: false },
    });
    if (!type) {
      removeFiles(attachments);
      return res.status(400).json({ error: "Reimbursement type not found" });
    }

    const amount = parseNumber(req.body.amount);
    if (amount === undefined || amount < 0) {
      removeFiles(attachments);
      return res.status(400).json({ error: "Amount is required" });
    }

    const description =
      typeof req.body.description === "string"
        ? req.body.description.trim()
        : "";
    const employeeNote =
      typeof req.body.employeeNote === "string"
        ? req.body.employeeNote.trim()
        : "";

    const projectIdRaw = req.body.projectId || req.body.project;
    const projectNameInput =
      typeof req.body.projectName === "string"
        ? req.body.projectName.trim()
        : typeof req.body.projectOther === "string"
          ? req.body.projectOther.trim()
          : "";

    let project = null;
    let projectName = projectNameInput;

    if (projectIdRaw) {
      const projectDoc = await Project.findOne({
        _id: projectIdRaw,
        company: req.employee.company,
        isDeleted: { $ne: true },
      }).select("title");
      if (!projectDoc) {
        removeFiles(attachments);
        return res.status(400).json({ error: "Project not found" });
      }
      project = projectDoc._id;
      projectName = projectDoc.title || projectNameInput;
    }

    const reimbursement = await Reimbursement.create({
      company: req.employee.company,
      employee: req.employee.id,
      type: type._id,
      typeName: type.name,
      project,
      projectName: projectName || undefined,
      amount,
      description,
      employeeNote,
      status: "PENDING",
      attachments,
    });

    await reimbursement.populate([
      { path: "type", select: "name isActive" },
      { path: "employee", select: "name employeeId" },
      { path: "project", select: "title isActive isDeleted" },
    ]);

    res.status(201);
    sendSuccess(res, "Reimbursement submitted", { reimbursement });
  } catch (err) {
    console.error("reimbursement create error", err);
    removeFiles(attachments);
    res.status(500).json({ error: "Failed to submit reimbursement" });
  }
});

router.post("/:id/approve", auth, async (req, res) => {
  try {
    if (!isAdmin(req.employee))
      return res.status(403).json({ error: "Forbidden" });
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: "Missing reimbursement id" });

    const reimbursement = await Reimbursement.findById(id);
    if (!reimbursement)
      return res.status(404).json({ error: "Reimbursement not found" });

    if (
      req.employee.company &&
      reimbursement.company &&
      String(reimbursement.company) !== String(req.employee.company) &&
      req.employee.primaryRole !== "SUPERADMIN"
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (reimbursement.status !== "PENDING")
      return res.status(400).json({ error: "Request already resolved" });

    const updatedAmount = parseNumber(req.body?.amount);
    if (updatedAmount !== undefined) {
      if (updatedAmount < 0)
        return res.status(400).json({ error: "Amount must be non-negative" });
      reimbursement.amount = updatedAmount;
    }

    reimbursement.status = "APPROVED";
    reimbursement.adminNote =
      typeof req.body?.adminNote === "string"
        ? req.body.adminNote.trim()
        : reimbursement.adminNote;
    reimbursement.resolvedBy = req.employee.id;
    reimbursement.resolvedAt = new Date();
    await reimbursement.save();

    // Mirror as an expense record for finance tracking
    try {
      const category = await ensureExpenseCategory(
        reimbursement.company,
        req.employee.id
      );
      await Expense.create({
        company: reimbursement.company,
        date: reimbursement.resolvedAt || new Date(),
        category: category._id,
        categoryName: category.name,
        description: reimbursement.description || reimbursement.typeName,
        notes: reimbursement.employeeNote || "",
        amount: reimbursement.amount,
        paidBy: "bank",
        attachments: reimbursement.attachments || [],
        createdBy: req.employee.id,
        updatedBy: req.employee.id,
      });
    } catch (expErr) {
      console.error("reimbursement->expense sync error", expErr);
    }

    sendSuccess(res, "Reimbursement approved", { reimbursement });
  } catch (err) {
    console.error("reimbursement approve error", err);
    res.status(500).json({ error: "Failed to approve reimbursement" });
  }
});

router.post("/:id/reject", auth, async (req, res) => {
  try {
    if (!isAdmin(req.employee))
      return res.status(403).json({ error: "Forbidden" });
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: "Missing reimbursement id" });

    const reimbursement = await Reimbursement.findById(id);
    if (!reimbursement)
      return res.status(404).json({ error: "Reimbursement not found" });

    if (
      req.employee.company &&
      reimbursement.company &&
      String(reimbursement.company) !== String(req.employee.company) &&
      req.employee.primaryRole !== "SUPERADMIN"
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (reimbursement.status !== "PENDING")
      return res.status(400).json({ error: "Request already resolved" });

    reimbursement.status = "REJECTED";
    reimbursement.adminNote =
      typeof req.body?.adminNote === "string"
        ? req.body.adminNote.trim()
        : reimbursement.adminNote;
    reimbursement.resolvedBy = req.employee.id;
    reimbursement.resolvedAt = new Date();
    await reimbursement.save();

    sendSuccess(res, "Reimbursement rejected", { reimbursement });
  } catch (err) {
    console.error("reimbursement reject error", err);
    res.status(500).json({ error: "Failed to reject reimbursement" });
  }
});

module.exports = router;
