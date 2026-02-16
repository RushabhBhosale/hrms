const router = require("express").Router();
const PDFDocument = require("pdfkit");

const { auth } = require("../middleware/auth");
const Expense = require("../models/Expense");
const ExpenseCategory = require("../models/ExpenseCategory");
const Counter = require("../models/Counter");
const Company = require("../models/Company");
const { parseWithSchema } = require("../utils/zod");
const { expenseSchema } = require("../../../libs/schemas/expense");

const {
  upload,
  getStoredFileId,
  deleteStoredFile,
  deleteStoredFiles,
} = require("../utils/fileStorage");
const { uploadBufferToS3 } = require("../utils/s3");

function sendSuccess(res, message, payload = {}) {
  if (message) res.set("X-Success-Message", message);
  return res.json({ message, ...payload });
}

const DEFAULT_CATEGORIES = [
  "Housekeeping",
  "Tea/Coffee",
  "Stationery",
  "Travel",
  "Festival Gifts",
  "Birthday Celebrations",
  "Misc",
];

function canManage(req) {
  if (!req.employee) return false;
  const primary = req.employee.primaryRole;
  if (primary === "ADMIN" || primary === "SUPERADMIN") return true;
  return (req.employee.subRoles || []).includes("hr");
}

async function ensureDefaultCategories(companyId, employeeId) {
  const count = await ExpenseCategory.countDocuments({
    company: companyId,
    isDeleted: { $ne: true },
    isActive: { $ne: false },
  });
  if (count > 0) return;
  const docs = DEFAULT_CATEGORIES.map((name) => ({
    company: companyId,
    name,
    isDefault: true,
    createdBy: employeeId,
  }));
  try {
    await ExpenseCategory.insertMany(docs, { ordered: false });
  } catch (err) {
    if (err && err.code !== 11000)
      console.error("expense default cat err", err);
  }
}

const FREQ_INTERVALS = {
  daily: { type: "days", value: 1 },
  weekly: { type: "days", value: 7 },
  monthly: { type: "months", value: 1 },
  quarterly: { type: "months", value: 3 },
  yearly: { type: "years", value: 1 },
};

function addFrequency(date, frequency) {
  const info = FREQ_INTERVALS[frequency];
  if (!info) return null;
  const next = new Date(date.getTime());
  if (info.type === "days") {
    next.setDate(next.getDate() + info.value);
    return next;
  }
  if (info.type === "months") {
    const d = next.getDate();
    next.setDate(1);
    next.setMonth(next.getMonth() + info.value);
    const max = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(d, max));
    return next;
  }
  if (info.type === "years") {
    next.setFullYear(next.getFullYear() + info.value);
    return next;
  }
  return null;
}

function normalizeDateInput(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function computeNextDueDate(startDateInput, frequency) {
  const start = normalizeDateInput(startDateInput);
  if (!start || !FREQ_INTERVALS[frequency]) return null;
  const today = new Date();
  const todayMid = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
  if (start >= todayMid) return start;
  let cursor = new Date(start.getTime());
  let guard = 0;
  while (cursor < todayMid && guard < 500) {
    const next = addFrequency(cursor, frequency);
    if (!next) return null;
    cursor = next;
    guard += 1;
  }
  return cursor >= todayMid ? cursor : null;
}

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value === "true" || value === "1" || value.toLowerCase() === "yes";
  }
  return false;
}

function parseNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value !== "") {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }
  return undefined;
}

function removeFiles(filenames = []) {
  deleteStoredFiles(filenames);
}

async function removeFileSafe(filename) {
  await deleteStoredFile(filename);
}

async function nextVoucherNumber(companyId) {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(
    2,
    "0"
  )}`;
  const key = `voucher:${companyId}:${ym}`;
  const counter = await Counter.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  const seq = String(counter.seq).padStart(4, "0");
  return { number: `VCH-${ym}-${seq}`, sequenceKey: key };
}

function formatCurrencyINR(amount) {
  const n = Number(amount || 0);
  return `Rs. ${n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

async function generateVoucherPdf(expense, company) {
  const fileName = `voucher-${expense._id}-${Date.now()}.pdf`;
  const key = `expenses/vouchers/${String(expense.company || "unknown")}/${fileName}`;

  const doc = new PDFDocument({ margin: 50 });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on("end", resolve);
    doc.on("error", reject);
  });

  const heading = company?.name
    ? `${company.name} - Expense Voucher`
    : "Expense Voucher";
  doc.fontSize(18).text(heading, { align: "center" });
  doc.moveDown();

  doc.fontSize(12);
  const detailRows = [
    ["Voucher No.", expense.voucher?.number || "-"],
    ["Voucher Date", new Date(expense.date).toLocaleDateString("en-IN")],
    ["Category", expense.categoryName || "-"],
    ["Amount", formatCurrencyINR(expense.amount)],
    ["Paid By", String(expense.paidBy || "").toUpperCase()],
    ["Authorized By", expense.voucher?.authorizedBy || "__________________"],
  ];

  detailRows.forEach(([label, value]) => {
    doc
      .font("Helvetica-Bold")
      .text(`${label}: `, { continued: true })
      .font("Helvetica")
      .text(value);
  });

  doc.moveDown(2);
  doc.font("Helvetica-Bold").text("Notes");
  doc.font("Helvetica").text(expense.description || "");

  doc.moveDown(3);
  doc.font("Helvetica").text("Signature: ____________________________");

  doc.end();
  await done;
  const buffer = Buffer.concat(chunks);
  await uploadBufferToS3(buffer, {
    key,
    contentType: "application/pdf",
  });
  return key;
}

router.use(auth);

router.get("/categories", async (req, res) => {
  try {
    await ensureDefaultCategories(req.employee.company, req.employee.id);
    const categories = await ExpenseCategory.find({
      company: req.employee.company,
      isDeleted: { $ne: true },
      isActive: { $ne: false },
    })
      .sort({ name: 1 })
      .lean();
    res.json({ categories });
  } catch (err) {
    console.error("expense categories list err", err);
    res.status(500).json({ error: "Failed to load categories" });
  }
});

router.post("/categories", async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: "Forbidden" });
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Category name required" });
  try {
    const cat = await ExpenseCategory.create({
      company: req.employee.company,
      name,
      isDefault: false,
      createdBy: req.employee.id,
    });
    res.status(201);
    sendSuccess(res, "Category created", { category: cat });
  } catch (err) {
    if (err && err.code === 11000)
      return res.status(400).json({ error: "Category already exists" });
    console.error("expense categories create err", err);
    res.status(500).json({ error: "Failed to create category" });
  }
});

router.delete("/categories/:id", async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: "Forbidden" });
  const { id } = req.params;
  try {
    const cat = await ExpenseCategory.findOne({
      _id: id,
      company: req.employee.company,
    });
    if (!cat) return res.status(404).json({ error: "Not found" });
    const usage = await Expense.countDocuments({
      company: req.employee.company,
      category: cat._id,
      isDeleted: { $ne: true },
    });
    if (usage > 0) {
      return res
        .status(400)
        .json({
          error: "Category is in use by expenses and cannot be removed",
        });
    }
    cat.isDeleted = true;
    cat.isActive = false;
    await cat.save();
    sendSuccess(res, "Category deleted", { success: true });
  } catch (err) {
    console.error("expense categories delete err", err);
    res.status(500).json({ error: "Failed to delete category" });
  }
});

router.get("/", async (req, res) => {
  try {
    const filter = {
      company: req.employee.company,
      isDeleted: { $ne: true },
      isActive: { $ne: false },
    };
    const { from, to, category, paidBy, recurring, q } = req.query;
    if (from) {
      const d = normalizeDateInput(from);
      if (!d) return res.status(400).json({ error: "Invalid from date" });
      filter.date = { ...(filter.date || {}), $gte: d };
    }
    if (to) {
      const d = normalizeDateInput(to);
      if (!d) return res.status(400).json({ error: "Invalid to date" });
      const end = new Date(
        d.getFullYear(),
        d.getMonth(),
        d.getDate(),
        23,
        59,
        59,
        999
      );
      filter.date = { ...(filter.date || {}), $lte: end };
    }
    if (category) filter.category = category;
    if (paidBy) filter.paidBy = paidBy;
    if (recurring === "true") filter.isRecurring = true;
    if (recurring === "false") filter.isRecurring = false;
    if (q) {
      filter.$or = [
        { description: { $regex: q, $options: "i" } },
        { notes: { $regex: q, $options: "i" } },
        { categoryName: { $regex: q, $options: "i" } },
      ];
    }

    const expenses = await Expense.find(filter)
      .sort({ date: -1, createdAt: -1 })
      .populate("category", "name")
      .lean();

    res.json({ expenses });
  } catch (err) {
    console.error("expense list err", err);
    res.status(500).json({ error: "Failed to load expenses" });
  }
});

router.post("/", upload.array("attachments", 5), async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: "Forbidden" });
  const attachments = (req.files || [])
    .map((f) => getStoredFileId(f))
    .filter(Boolean);
  try {
    const date = normalizeDateInput(req.body.date);
    if (!date) return res.status(400).json({ error: "Invalid date" });
    const amount = parseNumber(req.body.amount);
    if (amount === undefined)
      return res.status(400).json({ error: "Amount is required" });
    const paidBy = String(req.body.paidBy || "").toLowerCase();
    if (!["cash", "bank", "upi", "card"].includes(paidBy))
      return res.status(400).json({ error: "Invalid payment mode" });

    const categoryId = req.body.categoryId || req.body.category;
    if (!categoryId)
      return res.status(400).json({ error: "Category is required" });
    const category = await ExpenseCategory.findOne({
      _id: categoryId,
      company: req.employee.company,
    });
    if (!category) return res.status(400).json({ error: "Category not found" });

    const isRecurring = parseBoolean(req.body.isRecurring);
    let recurring;
    if (isRecurring) {
      const frequency = String(req.body.frequency || "").toLowerCase();
      const startDate = normalizeDateInput(req.body.startDate);
      if (!FREQ_INTERVALS[frequency]) {
        return res.status(400).json({ error: "Invalid recurring frequency" });
      }
      if (!startDate)
        return res.status(400).json({ error: "Recurring start date required" });
      const reminderDaysBefore = Math.max(
        0,
        parseInt(req.body.reminderDaysBefore || "0", 10) || 0
      );
      const nextDueDate = computeNextDueDate(startDate, frequency);
      recurring = {
        frequency,
        startDate,
        nextDueDate,
        reminderDaysBefore,
      };
    }

    const voucherEnabled = parseBoolean(req.body.voucherEnabled);
    const voucherAuthorizedBy = req.body.voucherAuthorizedBy
      ? String(req.body.voucherAuthorizedBy).trim()
      : "";
    let voucher;
    if (voucherEnabled) {
      const { number, sequenceKey } = await nextVoucherNumber(
        req.employee.company
      );
      voucher = {
        number,
        sequenceKey,
        authorizedBy: voucherAuthorizedBy,
        generatedAt: new Date(),
      };
    }

    const validation = parseWithSchema(expenseSchema, {
      company: String(req.employee.company),
      date,
      category: String(category._id),
      categoryName: category.name,
      description: req.body.description || "",
      notes: req.body.notes || "",
      amount,
      paidBy,
      attachments,
      isRecurring,
      recurring,
      hasVoucher: voucherEnabled,
      voucher,
      createdBy: String(req.employee.id),
      updatedBy: String(req.employee.id),
    });

    if (!validation.ok) {
      removeFiles(attachments);
      return res
        .status(400)
        .json({ error: "Invalid expense data", details: validation.issues });
    }

    const expense = await Expense.create(validation.data);

    if (voucherEnabled) {
      try {
        const company = await Company.findById(req.employee.company).select(
          "name"
        );
        await removeFileSafe(expense.voucher?.pdfFile);
        const pdfFile = await generateVoucherPdf(expense, company);
        expense.voucher.pdfFile = pdfFile;
        expense.markModified("voucher");
        await expense.save();
      } catch (err) {
        console.error("voucher pdf create err", err);
      }
    }

    const populated = await expense.populate("category", "name");
    res.status(201);
    sendSuccess(res, "Expense created", { expense: populated });
  } catch (err) {
    console.error("expense create err", err);
    removeFiles(attachments);
    res.status(500).json({ error: "Failed to create expense" });
  }
});

router.put("/:id", upload.array("attachments", 5), async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: "Forbidden" });
  const attachments = (req.files || [])
    .map((f) => getStoredFileId(f))
    .filter(Boolean);
  try {
    const expense = await Expense.findOne({
      _id: req.params.id,
      company: req.employee.company,
    });
    if (!expense) {
      removeFiles(attachments);
      return res.status(404).json({ error: "Not found" });
    }

    if (req.body.date) {
      const date = normalizeDateInput(req.body.date);
      if (!date) {
        removeFiles(attachments);
        return res.status(400).json({ error: "Invalid date" });
      }
      expense.date = date;
    }

    if (req.body.amount !== undefined) {
      const amount = parseNumber(req.body.amount);
      if (amount === undefined) {
        removeFiles(attachments);
        return res.status(400).json({ error: "Invalid amount" });
      }
      expense.amount = amount;
    }

    if (req.body.paidBy) {
      const paidBy = String(req.body.paidBy || "").toLowerCase();
      if (!["cash", "bank", "upi", "card"].includes(paidBy)) {
        removeFiles(attachments);
        return res.status(400).json({ error: "Invalid payment mode" });
      }
      expense.paidBy = paidBy;
    }

    if (req.body.categoryId || req.body.category) {
      const categoryId = req.body.categoryId || req.body.category;
      const category = await ExpenseCategory.findOne({
        _id: categoryId,
        company: req.employee.company,
      });
      if (!category) {
        removeFiles(attachments);
        return res.status(400).json({ error: "Category not found" });
      }
      expense.category = category._id;
      expense.categoryName = category.name;
    }

    if (req.body.description !== undefined) {
      expense.description = req.body.description;
    }

    if (req.body.notes !== undefined) {
      expense.notes = req.body.notes;
    }

    const voucherEnabledInput = req.body.voucherEnabled;
    const voucherAuthorizedByInput = req.body.voucherAuthorizedBy;
    let regenerateVoucher = false;
    if (voucherEnabledInput !== undefined) {
      const voucherEnabled = parseBoolean(voucherEnabledInput);
      if (!voucherEnabled && expense.hasVoucher) {
        await removeFileSafe(expense.voucher?.pdfFile);
        expense.hasVoucher = false;
        expense.voucher = undefined;
        expense.markModified("voucher");
      } else if (voucherEnabled && !expense.hasVoucher) {
        const { number, sequenceKey } = await nextVoucherNumber(
          req.employee.company
        );
        expense.hasVoucher = true;
        expense.voucher = {
          number,
          sequenceKey,
          authorizedBy: voucherAuthorizedByInput
            ? String(voucherAuthorizedByInput).trim()
            : "",
          generatedAt: new Date(),
        };
        expense.markModified("voucher");
        regenerateVoucher = true;
      }
    }

    if (voucherAuthorizedByInput !== undefined && expense.hasVoucher) {
      expense.voucher = {
        ...(expense.voucher || {}),
        authorizedBy: String(voucherAuthorizedByInput || "").trim(),
      };
      expense.markModified("voucher");
      regenerateVoucher = true;
    }

    const isRecurring =
      req.body.isRecurring !== undefined
        ? parseBoolean(req.body.isRecurring)
        : expense.isRecurring;

    expense.isRecurring = isRecurring;

    if (!isRecurring) {
      expense.recurring = undefined;
      expense.markModified("recurring");
    } else {
      const frequency = req.body.frequency
        ? String(req.body.frequency).toLowerCase()
        : expense.recurring?.frequency;
      if (!FREQ_INTERVALS[frequency]) {
        removeFiles(attachments);
        return res.status(400).json({ error: "Invalid recurring frequency" });
      }
      const startDate = req.body.startDate
        ? normalizeDateInput(req.body.startDate)
        : expense.recurring?.startDate;
      if (!startDate) {
        removeFiles(attachments);
        return res.status(400).json({ error: "Recurring start date required" });
      }
      const reminder =
        req.body.reminderDaysBefore !== undefined
          ? Math.max(0, parseInt(req.body.reminderDaysBefore || "0", 10) || 0)
          : expense.recurring?.reminderDaysBefore || 0;
      const nextDueDate = computeNextDueDate(startDate, frequency);
      expense.recurring = {
        frequency,
        startDate,
        nextDueDate,
        reminderDaysBefore: reminder,
      };
      expense.markModified("recurring");
    }

    const removeListRaw = req.body.removeAttachments;
    let removeList = [];
    if (removeListRaw) {
      try {
        if (Array.isArray(removeListRaw)) {
          removeList = removeListRaw;
        } else {
          removeList = JSON.parse(removeListRaw);
        }
      } catch (_) {
        removeList = [];
      }
    }

    if (removeList.length) {
      const toDelete = expense.attachments.filter((f) =>
        removeList.includes(String(f))
      );
      if (toDelete.length) {
        expense.attachments = expense.attachments.filter(
          (f) => !removeList.includes(String(f))
        );
        removeFiles(toDelete);
      }
    }

    if (attachments.length) {
      expense.attachments = [...expense.attachments, ...attachments];
    }

    const updatedById = String(req.employee.id);
    const recurringData =
      expense.isRecurring && expense.recurring
        ? {
            frequency: expense.recurring.frequency,
            startDate: expense.recurring.startDate,
            nextDueDate: expense.recurring.nextDueDate,
            reminderDaysBefore: expense.recurring.reminderDaysBefore,
          }
        : undefined;

    const voucherData =
      expense.hasVoucher && expense.voucher
        ? {
            number: expense.voucher.number,
            authorizedBy: expense.voucher.authorizedBy,
            sequenceKey: expense.voucher.sequenceKey,
            pdfFile: expense.voucher.pdfFile,
            generatedAt: expense.voucher.generatedAt,
          }
        : undefined;

    const validation = parseWithSchema(expenseSchema, {
      company: String(expense.company),
      date: expense.date,
      category: String(expense.category),
      categoryName: expense.categoryName,
      description: expense.description || "",
      notes: expense.notes || "",
      amount: expense.amount,
      paidBy: expense.paidBy,
      attachments: (expense.attachments || []).map((f) => String(f)),
      isRecurring: expense.isRecurring,
      recurring: recurringData,
      hasVoucher: expense.hasVoucher,
      voucher: voucherData,
      createdBy: expense.createdBy ? String(expense.createdBy) : undefined,
      updatedBy: updatedById,
    });

    if (!validation.ok) {
      removeFiles(attachments);
      return res
        .status(400)
        .json({ error: "Invalid expense data", details: validation.issues });
    }

    expense.updatedBy = updatedById;
    await expense.save();

    if (
      expense.hasVoucher &&
      (regenerateVoucher || !expense.voucher?.pdfFile)
    ) {
      try {
        await removeFileSafe(expense.voucher?.pdfFile);
        const company = await Company.findById(expense.company).select("name");
        const pdfFile = await generateVoucherPdf(expense, company);
        expense.voucher.pdfFile = pdfFile;
        expense.markModified("voucher");
        await expense.save();
      } catch (err) {
        console.error("voucher pdf update err", err);
      }
    }

    const populated = await expense.populate("category", "name");
    sendSuccess(res, "Expense updated", { expense: populated });
  } catch (err) {
    console.error("expense update err", err);
    removeFiles(attachments);
    res.status(500).json({ error: "Failed to update expense" });
  }
});

router.delete("/:id", async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ error: "Forbidden" });
  try {
    const expense = await Expense.findOne({
      _id: req.params.id,
      company: req.employee.company,
    });
    if (!expense) return res.status(404).json({ error: "Not found" });
    expense.isDeleted = true;
    expense.isActive = false;
    await expense.save();
    sendSuccess(res, "Expense deleted", { success: true });
  } catch (err) {
    console.error("expense delete err", err);
    res.status(500).json({ error: "Failed to delete expense" });
  }
});

module.exports = router;
