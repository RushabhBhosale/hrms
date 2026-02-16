const router = require("express").Router();
const mongoose = require("mongoose");
const Leave = require("../models/Leave");
const Employee = require("../models/Employee");
const UnpaidLeaveAdjustment = require("../models/UnpaidLeaveAdjustment");
const { auth } = require("../middleware/auth");
const {
  distributeLeaveAcrossMonths,
  round2,
  startOfDay,
} = require("../utils/unpaidLeaves");

function monthValid(value) {
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value);
}

function formatMonthKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function getMonthBounds(month) {
  const [year, monthPart] = month.split("-").map((v) => Number(v));
  const start = new Date(year, monthPart - 1, 1);
  const end = new Date(year, monthPart, 0);
  return { start, end };
}

function canAdjustUnpaid(req) {
  const me = req.employee;
  if (!me) return false;
  if (["ADMIN", "SUPERADMIN"].includes(me.primaryRole)) return true;
  const subs = me.subRoles || [];
  return subs.includes("hr");
}

function normalizeEmployeeId(emp) {
  if (!emp) return null;
  if (typeof emp === "string") return emp;
  if (emp._id) return String(emp._id);
  return null;
}

function computeAttendanceStart(emp) {
  if (!emp) return null;
  const joining = emp.joiningDate ? startOfDay(emp.joiningDate) : null;
  const attendance =
    emp.attendanceStartDate && !Number.isNaN(new Date(emp.attendanceStartDate).getTime())
      ? startOfDay(emp.attendanceStartDate)
      : null;
  if (attendance && joining && attendance < joining) return joining;
  return attendance || joining;
}

async function summarizeLeaves({
  companyId,
  employeeIds,
  monthKey,
  employmentStartById = new Map(),
  attendanceStartById = new Map(),
}) {
  const result = new Map();
  if (!employeeIds.length) return result;
  const { end } = getMonthBounds(monthKey);
  const leaves = await Leave.find({
    company: companyId,
    employee: { $in: employeeIds },
    status: "APPROVED",
    startDate: { $lte: end },
  }).lean();
  for (const employeeId of employeeIds) {
    result.set(employeeId, { takenBefore: 0, takenThisMonth: 0 });
  }
  for (let leave of leaves) {
    const empId = normalizeEmployeeId(leave.employee);
    if (!empId || !result.has(empId)) continue;
    const employmentStart = employmentStartById.get(empId);
    const autoStart = attendanceStartById.get(empId) || employmentStart;
    const boundary = leave.isAuto ? autoStart : employmentStart;
    if (boundary) {
      const startBoundary = startOfDay(boundary);
      const leaveStart = startOfDay(leave.startDate);
      const leaveEnd = startOfDay(leave.endDate);
      if (leaveEnd < startBoundary) continue;
      if (leaveStart < startBoundary) {
        leave = {
          ...leave,
          startDate: startBoundary,
        };
      }
    }
    const portions = distributeLeaveAcrossMonths(leave);
    for (const [key, portion] of Object.entries(portions)) {
      const unpaid = Number(portion?.unpaid || 0);
      if (!Number.isFinite(unpaid) || unpaid === 0) continue;
      const entry = result.get(empId);
      if (key === monthKey) {
        entry.takenThisMonth += unpaid;
      } else if (key < monthKey) {
        entry.takenBefore += unpaid;
      }
    }
  }
  for (const [id, entry] of result.entries()) {
    result.set(id, {
      takenBefore: round2(entry.takenBefore),
      takenThisMonth: round2(entry.takenThisMonth),
    });
  }
  return result;
}

function buildAdjustmentMap(adjustments, monthKey) {
  const map = new Map();
  for (const doc of adjustments) {
    const empId = normalizeEmployeeId(doc.employee);
    if (!empId) continue;
    const current = map.get(empId) || {
      deductedBefore: 0,
      deductedCurrent: 0,
      note: null,
    };
    const deductedValue = Number(doc.deducted || 0);
    if (doc.month === monthKey) {
      current.deductedCurrent = deductedValue;
      current.note = doc.note || null;
    } else if (doc.month < monthKey) {
      current.deductedBefore += deductedValue;
    }
    map.set(empId, current);
  }
  return map;
}

function buildRow(emp, monthKey, takenMap, adjustmentMap) {
  const empId = String(emp._id || emp.id);
  const taken = takenMap.get(empId) || {
    takenBefore: 0,
    takenThisMonth: 0,
  };
  const adjustment = adjustmentMap.get(empId) || {
    deductedBefore: 0,
    deductedCurrent: 0,
    note: null,
  };
  const carryBefore = round2(taken.takenBefore - adjustment.deductedBefore);
  const available = round2(carryBefore + taken.takenThisMonth);
  const deducted = round2(adjustment.deductedCurrent);
  const carryAfter = round2(available - deducted);
  const maxDeductable = round2(Math.max(0, available));
  return {
    employeeId: empId,
    name: emp.name || "",
    email: emp.email || "",
    taken: round2(taken.takenThisMonth),
    takenBefore: round2(taken.takenBefore),
    carryBefore,
    available,
    deducted,
    carryAfter,
    maxDeductable,
    note: adjustment.note || null,
  };
}

function computeSummary(rows) {
  const totals = {
    totalTaken: 0,
    totalDeducted: 0,
    totalAvailable: 0,
    totalCarryBefore: 0,
    totalCarryAfter: 0,
    totalMaxDeductable: 0,
  };
  for (const row of rows) {
    totals.totalTaken += row.taken;
    totals.totalDeducted += row.deducted;
    totals.totalAvailable += row.available;
    totals.totalCarryBefore += row.carryBefore;
    totals.totalCarryAfter += row.carryAfter;
    totals.totalMaxDeductable += row.maxDeductable;
  }
  for (const key of Object.keys(totals)) {
    totals[key] = round2(totals[key]);
  }
  return totals;
}

router.get("/adjustments", auth, async (req, res) => {
  try {
    if (!canAdjustUnpaid(req))
      return res.status(403).json({ error: "Forbidden" });
    const companyId = req.employee.company;
    if (!companyId)
      return res.status(400).json({ error: "Company not found" });
    const companyFilter = mongoose.Types.ObjectId.isValid(companyId)
      ? new mongoose.Types.ObjectId(companyId)
      : companyId;

    const scope = typeof req.query.scope === "string" ? req.query.scope : "month";

    if (scope === "all") {
      // Aggregate all adjustments across months per employee
      const employees = await Employee.find({
        company: companyFilter,
        isDeleted: { $ne: true },
        isActive: { $ne: false },
      })
        .select("name email")
        .lean();
      const adjustments = await UnpaidLeaveAdjustment.aggregate([
        {
          $match: {
            company: companyFilter,
            isDeleted: { $ne: true },
            isActive: { $ne: false },
          },
        },
        {
          $group: {
            _id: "$employee",
            deducted: { $sum: { $ifNull: ["$deducted", 0] } },
          },
        },
      ]);
      const deductedById = new Map(
        adjustments.map((a) => [String(a._id), round2(a.deducted)])
      );
      const rows = employees
        .map((emp) => ({
          employeeId: String(emp._id),
          name: emp.name || "",
          email: emp.email || "",
          taken: 0,
          takenBefore: 0,
          carryBefore: 0,
          available: 0,
          deducted: deductedById.get(String(emp._id)) || 0,
          carryAfter: 0,
          maxDeductable: 0,
        }))
        .filter((r) => r.deducted > 0)
        .sort((a, b) => a.name.localeCompare(b.name));
      const summary = {
        totalTaken: 0,
        totalDeducted: round2(
          rows.reduce((sum, r) => sum + (r.deducted || 0), 0)
        ),
        totalAvailable: 0,
        totalCarryBefore: 0,
        totalCarryAfter: 0,
        totalMaxDeductable: 0,
      };
      return res.json({ scope: "all", rows, summary });
    }

    const requestedMonth = typeof req.query.month === "string" ? req.query.month : "";
    const month = monthValid(requestedMonth)
      ? requestedMonth
      : formatMonthKey(new Date());
    const filterEmployeeId =
      req.query.employeeId && typeof req.query.employeeId === "string"
        ? req.query.employeeId
        : null;

    const employees = await Employee.find({
      company: companyFilter,
      isDeleted: { $ne: true },
      isActive: { $ne: false },
    })
      .select("name email joiningDate attendanceStartDate")
      .lean();
    let filtered = employees;
    if (filterEmployeeId) {
      filtered = employees.filter(
        (emp) => String(emp._id) === filterEmployeeId
      );
    }
    const employeeIds = filtered.map((emp) => String(emp._id));
    const employmentStartById = new Map(
      filtered.map((emp) => {
        const start = emp?.joiningDate;
        return [String(emp._id), start ? startOfDay(start) : null];
      })
    );
    const attendanceStartById = new Map(
      filtered.map((emp) => [
        String(emp._id),
        computeAttendanceStart(emp),
      ])
    );
    const takenMap = await summarizeLeaves({
      companyId: companyFilter,
      employeeIds,
      monthKey: month,
      employmentStartById,
      attendanceStartById,
    });

    const adjustments = await UnpaidLeaveAdjustment.find({
      company: companyFilter,
      employee: { $in: employeeIds },
      month: { $lte: month },
      isDeleted: { $ne: true },
      isActive: { $ne: false },
    }).lean();
    const adjustmentMap = buildAdjustmentMap(adjustments, month);

    const rows = filtered
      .map((emp) => buildRow(emp, month, takenMap, adjustmentMap))
      .sort((a, b) => a.name.localeCompare(b.name));
    const summary = computeSummary(rows);

    res.json({ month, rows, summary });
  } catch (err) {
    console.error("[unpaid-leaves] fetch failed:", err);
    res.status(500).json({ error: "Failed to load unpaid leave adjustments" });
  }
});

router.post("/adjustments", auth, async (req, res) => {
  try {
    if (!canAdjustUnpaid(req))
      return res.status(403).json({ error: "Forbidden" });
    const companyId = req.employee.company;
    if (!companyId)
      return res.status(400).json({ error: "Company not found" });

    const { employeeId, month: requestedMonth, deducted, note } = req.body || {};
    if (!employeeId || typeof employeeId !== "string")
      return res.status(400).json({ error: "Employee is required" });
    if (!monthValid(requestedMonth))
      return res.status(400).json({ error: "Invalid month" });

    const employee = await Employee.findOne({
      _id: employeeId,
      company: companyId,
      isDeleted: { $ne: true },
      isActive: { $ne: false },
    }).lean();
    if (!employee)
      return res.status(404).json({ error: "Employee not found" });

    const month = requestedMonth;
    const employmentStart = employee?.joiningDate || null;
    const employmentStartById = new Map([
      [employeeId, employmentStart ? startOfDay(employmentStart) : null],
    ]);
    const attendanceStartById = new Map([
      [employeeId, computeAttendanceStart(employee)],
    ]);
    const takenMap = await summarizeLeaves({
      companyId,
      employeeIds: [employeeId],
      monthKey: month,
      employmentStartById,
      attendanceStartById,
    });
    const takenData = takenMap.get(employeeId) || {
      takenBefore: 0,
      takenThisMonth: 0,
    };
    const previousAdjustments = await UnpaidLeaveAdjustment.find({
      company: companyId,
      employee: employeeId,
      month: { $lt: month },
      isDeleted: { $ne: true },
      isActive: { $ne: false },
    }).lean();
    const deductedBefore = previousAdjustments.reduce(
      (acc, doc) => acc + Number(doc.deducted || 0),
      0
    );
    const carryBefore = round2(takenData.takenBefore - deductedBefore);
    const available = round2(carryBefore + takenData.takenThisMonth);
    const maxDeductable = round2(Math.max(0, available));

    const requestedDeducted =
      typeof deducted === "number" ? deducted : Number(deducted || 0);
    if (!Number.isFinite(requestedDeducted) || requestedDeducted < 0) {
      return res
        .status(400)
        .json({ error: "Deduction must be a non-negative number" });
    }
    const finalDeducted = round2(requestedDeducted);
    if (finalDeducted > maxDeductable + 1e-6) {
      return res.status(400).json({
        error: "Cannot deduct more than available unpaid leaves",
        maxDeductable,
        available,
      });
    }

    const sanitizedNote =
      typeof note === "string" && note.trim().length ? note.trim() : null;
    await UnpaidLeaveAdjustment.findOneAndUpdate(
      {
        company: companyId,
        employee: employeeId,
        month,
      },
      {
        company: companyId,
        employee: employeeId,
        month,
        deducted: finalDeducted,
        note: sanitizedNote,
        updatedBy: req.employee.id,
        isDeleted: false,
        isActive: true,
        $setOnInsert: { createdBy: req.employee.id },
      },
      {
        upsert: true,
        new: true,
      }
    );

    const combinedAdjustments = [
      ...previousAdjustments,
      { employee: employeeId, month, deducted: finalDeducted, note: sanitizedNote },
    ];
    const adjustmentMap = buildAdjustmentMap(combinedAdjustments, month);
    const row = buildRow(employee, month, takenMap, adjustmentMap);
    res.json({ month, row });
  } catch (err) {
    console.error("[unpaid-leaves] save failed:", err);
    res.status(500).json({ error: "Failed to save unpaid leave adjustment" });
  }
});

module.exports = router;
