const router = require("express").Router();
const mongoose = require("mongoose");
const { auth } = require("../middleware/auth");
const { requirePrimary } = require("../middleware/roles");
const Kra = require("../models/Kra");
const Appraisal = require("../models/Appraisal");
const Employee = require("../models/Employee");
const Company = require("../models/Company");
const { Types } = mongoose;

function isAdmin(req) {
  return ["ADMIN", "SUPERADMIN"].includes(req.employee?.primaryRole);
}

function normalizeDate(value) {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

function toObjectId(id) {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return new mongoose.Types.ObjectId(id);
}

async function resolveCompanyId(req) {
  if (req.employee?.company) return req.employee.company;
  if (["ADMIN", "SUPERADMIN"].includes(req.employee?.primaryRole)) {
    const company = await Company.findOne({ admin: req.employee.id })
      .select("_id")
      .lean();
    return company?._id || null;
  }
  return null;
}

async function loadKraWindow(companyId) {
  if (!companyId) return {};
  const company = await Company.findById(companyId).select("kraWindow").lean();
  return company?.kraWindow || {};
}

router.get("/kras/window", auth, async (req, res) => {
  try {
    const companyId = await resolveCompanyId(req);
    if (!companyId) return res.status(400).json({ error: "Company not found" });
    const window = await loadKraWindow(companyId);
    res.json({
      window: {
        openFrom: window?.openFrom || null,
        openTo: window?.openTo || null,
      },
    });
  } catch (e) {
    console.error("[performance] get kra window error", e);
    res.status(500).json({ error: "Failed to load KRA window" });
  }
});

router.patch(
  "/kras/window",
  auth,
  requirePrimary(["ADMIN", "SUPERADMIN"]),
  async (req, res) => {
    try {
      const companyId = await resolveCompanyId(req);
      if (!companyId) return res.status(400).json({ error: "Company not found" });

      const openFrom = normalizeDate(req.body?.openFrom);
      const openTo = normalizeDate(req.body?.openTo);
      if (openFrom && openTo && openFrom > openTo) {
        return res
          .status(400)
          .json({ error: "Start date must be before end date" });
      }

      const company = await Company.findById(companyId).select("kraWindow");
      if (!company) return res.status(404).json({ error: "Company not found" });

      company.kraWindow = company.kraWindow || {};
      company.kraWindow.openFrom = openFrom || undefined;
      company.kraWindow.openTo = openTo || undefined;
      await company.save();

      res.json({
        window: {
          openFrom: company.kraWindow?.openFrom || null,
          openTo: company.kraWindow?.openTo || null,
        },
      });
    } catch (e) {
      console.error("[performance] update kra window error", e);
      res.status(500).json({ error: "Failed to update KRA window" });
    }
  }
);

// Question bank: list distinct questions created by admin (grouped by questionKey)
router.get(
  "/questions",
  auth,
  requirePrimary(["ADMIN", "SUPERADMIN"]),
  async (req, res) => {
    try {
      const companyId = await resolveCompanyId(req);
      if (!companyId) return res.status(400).json({ error: "Company not found" });

      const questions = await Kra.aggregate([
        { $match: { company: new Types.ObjectId(String(companyId)) } },
        {
          $group: {
            _id: "$questionKey",
            questionKey: { $first: "$questionKey" },
            title: { $first: "$title" },
            description: { $first: "$description" },
            roleKey: { $first: "$roleKey" },
            count: { $sum: 1 },
            createdAt: { $min: "$createdAt" },
            updatedAt: { $max: "$updatedAt" },
          },
        },
        { $sort: { createdAt: -1 } },
      ]);

      res.json({ questions });
    } catch (e) {
      console.error("[performance] list questions error", e);
      res.status(500).json({ error: "Failed to load questions" });
    }
  }
);

// Update title/description for all KRAs sharing a questionKey
router.patch(
  "/questions/:questionKey",
  auth,
  requirePrimary(["ADMIN", "SUPERADMIN"]),
  async (req, res) => {
    try {
      const companyId = await resolveCompanyId(req);
      if (!companyId) return res.status(400).json({ error: "Company not found" });

      const { title, description } = req.body || {};
      const normalizedTitle = title && String(title).trim();
      const normalizedDesc =
        description === undefined || description === null
          ? undefined
          : String(description).trim();

      if (!normalizedTitle) {
        return res.status(400).json({ error: "Title is required" });
      }

      const result = await Kra.updateMany(
        {
          company: companyId,
          questionKey: req.params.questionKey,
        },
        {
          $set: {
            title: normalizedTitle,
            description: normalizedDesc || undefined,
          },
        }
      );

      res.json({ ok: true, modified: result.modifiedCount });
    } catch (e) {
      console.error("[performance] update question error", e);
      res.status(500).json({ error: "Failed to update question" });
    }
  }
);

// Delete all KRAs belonging to a questionKey
router.delete(
  "/questions/:questionKey",
  auth,
  requirePrimary(["ADMIN", "SUPERADMIN"]),
  async (req, res) => {
    try {
      const companyId = await resolveCompanyId(req);
      if (!companyId) return res.status(400).json({ error: "Company not found" });

      const result = await Kra.deleteMany({
        company: companyId,
        questionKey: req.params.questionKey,
      });

      res.json({ ok: true, deleted: result.deletedCount });
    } catch (e) {
      console.error("[performance] delete question error", e);
      res.status(500).json({ error: "Failed to delete question" });
    }
  }
);

router.get("/kras", auth, async (req, res) => {
  try {
    const companyId = await resolveCompanyId(req);
    if (!companyId) return res.status(400).json({ error: "Company not found" });

    const listAll =
      isAdmin(req) &&
      String(req.query.all || "")
        .trim()
        .toLowerCase() === "true";

    const filter = {
      company: companyId,
    };

    if (!listAll) {
      if (isAdmin(req) && req.query.employeeId) {
        const id = toObjectId(req.query.employeeId);
        if (id) filter.employee = id;
      } else if (!isAdmin(req) && req.query.employeeId) {
        const targetId = toObjectId(req.query.employeeId);
        if (targetId) {
          const targetEmp = await Employee.findOne({
            _id: targetId,
            company: companyId,
          })
            .select("reportingPerson reportingPersons")
            .lean();
          const isReportingPerson =
            String(targetEmp?.reportingPerson || "") ===
              String(req.employee.id) ||
            (Array.isArray(targetEmp?.reportingPersons) &&
              targetEmp.reportingPersons.some(
                (id) => String(id) === String(req.employee.id)
              ));
          if (isReportingPerson) {
            filter.employee = targetId;
          } else {
            filter.employee = req.employee.id;
          }
        } else {
          filter.employee = req.employee.id;
        }
      } else {
        filter.employee = req.employee.id;
      }
    }

    const kras = await Kra.find(filter)
      .select(
        "company employee title description status periodStart periodEnd metrics selfReview managerReview adminReview selfReviewEnabled selfReviewOpenFrom selfReviewOpenTo createdAt updatedAt"
      )
      .sort({ createdAt: -1 })
      .populate("employee", "name email employeeId")
      .lean();
    res.json({ kras });
  } catch (e) {
    console.error("[performance] list kras error", e);
    res.status(500).json({ error: "Failed to load KRAs" });
  }
});

router.post(
  "/kras",
  auth,
  requirePrimary(["ADMIN", "SUPERADMIN"]),
  async (req, res) => {
    const companyId = await resolveCompanyId(req);
    if (!companyId) return res.status(400).json({ error: "Company not found" });

    const {
      employeeId,
      roleKey,
      applyToAllRoles,
      title,
      description,
      periodStart,
      periodEnd,
    } = req.body || {};
    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: "Title is required" });
    }

    const targetIds = [];
    if (applyToAllRoles === true) {
      const all = await Employee.find({
        company: companyId,
        isDeleted: { $ne: true },
        isActive: { $ne: false },
      })
        .select("_id")
        .lean();
      targetIds.push(...all.map((e) => e._id));
    } else if (employeeId) {
      const employee = await Employee.findOne({
        _id: employeeId,
        company: companyId,
      });
      if (!employee)
        return res.status(400).json({ error: "Employee not found" });
      targetIds.push(employee._id);
    } else if (roleKey) {
      const all = await Employee.find({
        company: companyId,
        isDeleted: { $ne: true },
        isActive: { $ne: false },
      })
        .select("_id primaryRole subRoles")
        .lean();
      const normalizedRole = String(roleKey).toLowerCase();
      const matches = all.filter((e) => {
        const subs = (e.subRoles || []).map((r) => String(r).toLowerCase());
        const primary = String(e.primaryRole || "").toLowerCase();
        return subs.includes(normalizedRole) || primary === normalizedRole;
      });
      if (!matches.length)
        return res
          .status(400)
          .json({ error: "No employees found for that role" });
      targetIds.push(...matches.map((e) => e._id));
    } else {
      return res.status(400).json({ error: "Choose a role, employee, or select all roles" });
    }

    const questionKey = new Types.ObjectId().toString();

    const payload = {
      company: companyId,
      questionKey,
      roleKey: applyToAllRoles ? undefined : roleKey || undefined,
      title: String(title).trim(),
      description: description ? String(description).trim() : undefined,
      periodStart: normalizeDate(periodStart),
      periodEnd: normalizeDate(periodEnd),
      createdBy: req.employee.id,
    };

    const docs = targetIds.map((empId) => ({
      ...payload,
      employee: empId,
    }));
    const kras = await Kra.insertMany(docs);
    res.status(201).json({ kras, created: kras.length });
  }
);

router.delete(
  "/kras/:id",
  auth,
  requirePrimary(["ADMIN", "SUPERADMIN"]),
  async (req, res) => {
    try {
      const kra = await Kra.findOneAndDelete({
        _id: req.params.id,
        company: req.employee.company,
      });
      if (!kra) return res.status(404).json({ error: "KRA not found" });
      res.json({ ok: true });
    } catch (e) {
      console.error("[performance] delete kra error", e);
      res.status(500).json({ error: "Failed to delete KRA" });
    }
  }
);

router.patch(
  "/kras/:id",
  auth,
  requirePrimary(["ADMIN", "SUPERADMIN"]),
  async (req, res) => {
    try {
      const kra = await Kra.findOne({
        _id: req.params.id,
        company: req.employee.company,
      });
      if (!kra) return res.status(404).json({ error: "KRA not found" });

      const selfReviewOpenFrom = normalizeDate(req.body?.selfReviewOpenFrom);
      const selfReviewOpenTo = normalizeDate(req.body?.selfReviewOpenTo);
      if (selfReviewOpenFrom && selfReviewOpenTo && selfReviewOpenFrom > selfReviewOpenTo) {
        return res
          .status(400)
          .json({ error: "Self-review start must be before end date" });
      }

      if (req.body?.selfReviewEnabled !== undefined) {
        kra.selfReviewEnabled = !!req.body.selfReviewEnabled;
      }
      if (req.body?.status) {
        kra.status =
          req.body.status === "CLOSED" ? "CLOSED" : req.body.status === "ACTIVE" ? "ACTIVE" : kra.status;
      }
      kra.selfReviewOpenFrom = selfReviewOpenFrom || undefined;
      kra.selfReviewOpenTo = selfReviewOpenTo || undefined;

      await kra.save();

      res.json({ kra });
    } catch (e) {
      console.error("[performance] update kra window error", e);
      res.status(500).json({ error: "Failed to update KRA" });
    }
  }
);

router.patch("/kras/:id/self-review", auth, async (req, res) => {
  try {
    const kra = await Kra.findOne({
      _id: req.params.id,
      company: req.employee.company,
    });
    if (!kra) return res.status(404).json({ error: "KRA not found" });

    const isOwner = String(kra.employee) === String(req.employee.id);
    if (!isOwner && !isAdmin(req))
      return res.status(403).json({ error: "Forbidden" });

    if (kra.status === "CLOSED") {
      return res.status(403).json({ error: "KRA is closed" });
    }

    const window = await loadKraWindow(kra.company);
    const now = new Date();
    if (window?.openFrom && now < window.openFrom) {
      return res.status(403).json({ error: "Self-review window is not open yet" });
    }
    if (window?.openTo && now > window.openTo) {
      return res.status(403).json({ error: "Self-review window is closed" });
    }

    const ratingRaw = req.body?.rating;
    const rating =
      ratingRaw === undefined || ratingRaw === null
        ? undefined
        : Number(ratingRaw);
    const answer =
      typeof req.body?.answer === "string"
        ? req.body.answer.trim()
        : undefined;

    kra.selfReview = {
      answer,
      rating: Number.isFinite(rating) ? rating : undefined,
      submittedAt: new Date(),
    };
    await kra.save();
    res.json({ kra });
  } catch (e) {
    console.error("[performance] self-review error", e);
    res.status(500).json({ error: "Failed to save self review" });
  }
});

router.patch("/kras/:id/manager-review", auth, async (req, res) => {
  try {
    const kra = await Kra.findOne({
      _id: req.params.id,
      company: req.employee.company,
    });
    if (!kra) return res.status(404).json({ error: "KRA not found" });

    const emp = await Employee.findById(kra.employee)
      .select("reportingPerson reportingPersons company")
      .lean();
    const isReportingPerson =
      String(emp?.reportingPerson || "") === String(req.employee.id) ||
      (Array.isArray(emp?.reportingPersons) &&
        emp.reportingPersons.some(
          (id) => String(id) === String(req.employee.id)
        ));

    if (!isReportingPerson && !isAdmin(req))
      return res.status(403).json({ error: "Forbidden" });

    const ratingRaw = req.body?.rating;
    const rating =
      ratingRaw === undefined || ratingRaw === null
        ? undefined
        : Number(ratingRaw);
    const comments =
      typeof req.body?.comments === "string"
        ? req.body.comments.trim()
        : undefined;

    kra.managerReview = {
      manager: req.employee.id,
      rating: Number.isFinite(rating) ? rating : undefined,
      comments,
      submittedAt: new Date(),
    };
    await kra.save();
    res.json({ kra });
  } catch (e) {
    console.error("[performance] manager-review error", e);
    res.status(500).json({ error: "Failed to save manager review" });
  }
});

router.patch(
  "/kras/:id/admin-review",
  auth,
  requirePrimary(["ADMIN", "SUPERADMIN"]),
  async (req, res) => {
    try {
      const kra = await Kra.findOne({
        _id: req.params.id,
        company: req.employee.company,
      });
      if (!kra) return res.status(404).json({ error: "KRA not found" });

      const ratingRaw = req.body?.rating;
      const rating =
        ratingRaw === undefined || ratingRaw === null
          ? undefined
          : Number(ratingRaw);
      const comments =
        typeof req.body?.comments === "string"
          ? req.body.comments.trim()
          : undefined;

      kra.adminReview = {
        admin: req.employee.id,
        rating: Number.isFinite(rating) ? rating : undefined,
        comments,
        submittedAt: new Date(),
      };
      // Optionally close the KRA when admin review is captured
      if (kra.status !== "CLOSED") kra.status = "CLOSED";
      await kra.save();
      res.json({ kra });
    } catch (e) {
      console.error("[performance] admin-review error", e);
      res.status(500).json({ error: "Failed to save admin review" });
    }
  }
);

router.get("/appraisals", auth, async (req, res) => {
  try {
    const filter = {
      company: req.employee.company,
    };
    if (!isAdmin(req)) {
      filter.employee = req.employee.id;
    } else if (req.query.employeeId) {
      const id = toObjectId(req.query.employeeId);
      if (id) filter.employee = id;
    }
    const appraisals = await Appraisal.find(filter)
      .sort({ createdAt: -1 })
      .populate("employee", "name email employeeId")
      .populate("kraResults.kra", "title")
      .lean();
    res.json({ appraisals });
  } catch (e) {
    console.error("[performance] list appraisals error", e);
    res.status(500).json({ error: "Failed to load appraisals" });
  }
});

router.post(
  "/appraisals",
  auth,
  requirePrimary(["ADMIN", "SUPERADMIN"]),
  async (req, res) => {
    const { employeeId, periodStart, periodEnd, overallRating, summary } =
      req.body || {};
    if (!employeeId) {
      return res.status(400).json({ error: "Employee is required" });
    }
    const employee = await Employee.findOne({
      _id: employeeId,
      company: req.employee.company,
    });
    if (!employee)
      return res.status(400).json({ error: "Employee not found" });

    const overall =
      overallRating === undefined || overallRating === null
        ? undefined
        : Number(overallRating);
    const kraResultsInput = Array.isArray(req.body?.kraResults)
      ? req.body.kraResults
      : [];
    const kraIds = kraResultsInput
      .map((k) => k?.kra)
      .map(toObjectId)
      .filter(Boolean);
    const validKras = kraIds.length
      ? await Kra.find({
          _id: { $in: kraIds },
          company: req.employee.company,
        })
          .select("_id")
          .lean()
      : [];
    const validSet = new Set(validKras.map((k) => String(k._id)));

    const kraResults = kraResultsInput
      .slice(0, 20)
      .map((item) => {
        const id = toObjectId(item?.kra);
        if (!id || !validSet.has(String(id))) return null;
        const rating =
          item?.rating === undefined || item?.rating === null
            ? undefined
            : Number(item.rating);
        const comments =
          typeof item?.comments === "string"
            ? item.comments.trim()
            : undefined;
        return {
          kra: id,
          rating: Number.isFinite(rating) ? rating : undefined,
          comments,
        };
      })
      .filter(Boolean);

    const payload = {
      company: req.employee.company,
      employee: employee._id,
      periodStart: normalizeDate(periodStart),
      periodEnd: normalizeDate(periodEnd),
      overallRating: Number.isFinite(overall) ? overall : undefined,
      summary: summary ? String(summary).trim() : undefined,
      kraResults,
      createdBy: req.employee.id,
    };

    const appraisal = await Appraisal.create(payload);
    res.status(201).json({ appraisal });
  }
);

module.exports = router;
