const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const mongoose = require("mongoose");
const { connectDB } = require("../src/config");
const Employee = require("../src/models/Employee");
const Leave = require("../src/models/Leave");
const AttendancePenalty = require("../src/models/AttendancePenalty");
const Company = require("../src/models/Company");
const { computeDerivedBalances } = require("../src/utils/leaveMath");

function startOfDay(value) {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function refundPenalty({ penalty, employee, company }) {
  if (!penalty || !employee) return { refunded: false };
  if (!employee.leaveUsage) {
    employee.leaveUsage = { paid: 0, casual: 0, sick: 0, unpaid: 0 };
  }

  const caps = company?.leavePolicy?.typeCaps || {};
  const used = employee.leaveUsage;
  const allocations = penalty.allocations || {};

  const typedRefund =
    numberOrZero(allocations.paid) +
    numberOrZero(allocations.casual) +
    numberOrZero(allocations.sick);

  employee.totalLeaveAvailable = Math.max(
    0,
    numberOrZero(employee.totalLeaveAvailable) + typedRefund
  );

  for (const type of ["paid", "casual", "sick", "unpaid"]) {
    const current = numberOrZero(used[type]);
    const delta = numberOrZero(allocations[type]);
    used[type] = Math.max(0, current - delta);
  }

  const derived = computeDerivedBalances(caps, used);
  employee.leaveBalances = derived;
  await employee.save();

  penalty.resolvedAt = new Date();
  penalty.resolvedBy = employee._id;
  await penalty.save();

  return {
    refunded: true,
    typedRefund,
    unpaidRefund: numberOrZero(allocations.unpaid),
  };
}

async function run() {
  await connectDB();
  const companyCache = new Map();
  let employeesChecked = 0;
  let leavesDeletedTotal = 0;
  let penaltiesResolvedTotal = 0;

  const employees = await Employee.find({ company: { $exists: true } });
  console.log(`[cleanup] loaded ${employees.length} employees with company`);

  for (const [idx, emp] of employees.entries()) {
    try {
      emp.decryptFieldsSync?.();
    } catch (_) {}
    const joinRaw = emp.joiningDate;
    const employmentStart = emp.joiningDate
      ? startOfDay(emp.joiningDate)
      : null;
    if (!employmentStart || Number.isNaN(employmentStart.getTime())) {
      console.log(
        `[cleanup] skip ${emp.name || emp._id} (no employment start) [${
          idx + 1
        }/${employees.length}] ` + `(joining raw=${joinRaw || "null"})`
      );
      employeesChecked += 1;
      continue;
    }

    const preLeaves = await Leave.find({
      employee: emp._id,
      startDate: { $lt: employmentStart },
      $or: [
        { isAuto: true },
        { autoPenalty: { $exists: true } },
        { reason: { $regex: /auto\s*leave/i } },
      ],
    })
      .select("startDate endDate isAuto autoPenalty reason")
      .lean();

    const penalties = await AttendancePenalty.find({
      employee: emp._id,
      resolvedAt: null,
      date: { $lt: employmentStart },
    });

    if (preLeaves.length || penalties.length) {
      const sampleLeaves = preLeaves
        .slice(0, 5)
        .map(
          (l) =>
            `${new Date(l.startDate).toISOString().slice(0, 10)}${l.isAuto ? " [auto]" : ""}`
        )
        .join(", ");
      const samplePenalties = penalties
        .slice(0, 3)
        .map((p) => new Date(p.date).toISOString().slice(0, 10))
        .join(", ");
      console.log(
        `[cleanup] ${emp.name || emp._id} (joining=${employmentStart
          .toISOString()
          .slice(0, 10)}) pre-check: leaves=${preLeaves.length}${
          sampleLeaves ? ` (${sampleLeaves})` : ""
        }, penalties=${penalties.length}${
          samplePenalties ? ` (${samplePenalties})` : ""
        }`
      );
    }

    const leavesResult = await Leave.deleteMany({
      employee: emp._id,
      startDate: { $lt: employmentStart },
      $or: [
        { isAuto: true },
        { autoPenalty: { $exists: true } },
        { reason: { $regex: /auto\s*leave/i } },
      ],
    });
    const deletedLeaves = leavesResult?.deletedCount || 0;
    leavesDeletedTotal += deletedLeaves;

    if (!penalties.length && deletedLeaves === 0) {
      console.log(
        `[cleanup] ${
          emp.name || emp._id
        }: nothing to remove (joining=${employmentStart
          .toISOString()
          .slice(0, 10)})`
      );
      employeesChecked += 1;
      continue;
    }

    let company = companyCache.get(String(emp.company));
    if (!company) {
      company = await Company.findById(emp.company).select("leavePolicy");
      companyCache.set(String(emp.company), company);
    }

    for (const penalty of penalties) {
      const res = await refundPenalty({ penalty, employee: emp, company });
      if (res.refunded) penaltiesResolvedTotal += 1;
    }

    console.log(
      `[cleanup] ${emp.name || emp._id} (joining=${employmentStart
        .toISOString()
        .slice(0, 10)}): removed leaves=${deletedLeaves}, penalties=${
        penalties.length
      }`
    );
    employeesChecked += 1;
  }

  console.log(
    `[cleanup] completed for ${employeesChecked} employees — ` +
      `auto leaves removed: ${leavesDeletedTotal}, penalties resolved: ${penaltiesResolvedTotal}`
  );
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("[cleanup] failed:", err);
  mongoose.disconnect();
});
