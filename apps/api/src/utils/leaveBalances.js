const Company = require("../models/Company");

function ym(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function monthsDiff(startYm, endYm) {
  const [sy, sm] = startYm.split("-").map((x) => parseInt(x, 10));
  const [ey, em] = endYm.split("-").map((x) => parseInt(x, 10));
  return (ey - sy) * 12 + (em - sm);
}

function prevMonthYm(startYm) {
  const [y, m] = startYm.split("-").map((x) => parseInt(x, 10));
  const date = new Date(y, m - 1, 1);
  date.setMonth(date.getMonth() - 1);
  return ym(date);
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function startOfMonth(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  return d;
}

// Accrue monthly total leaves for the employee
async function accrueTotalIfNeeded(employee, company, asOfDate = new Date()) {
  if (!employee || !company) return;

  const policy = company.leavePolicy || {};
  const annual = Number(policy.totalAnnual) || 0;
  const strategy = (policy.accrualStrategy || "ACCRUAL").toUpperCase();
  const isLumpSum = strategy === "LUMP_SUM";

  if (!employee.leaveUsage) {
    employee.leaveUsage = { paid: 0, casual: 0, sick: 0, unpaid: 0 };
  }
  const used =
    (Number(employee.leaveUsage.paid) || 0) +
    (Number(employee.leaveUsage.casual) || 0) +
    (Number(employee.leaveUsage.sick) || 0);

  const asOfFloor = startOfMonth(asOfDate);
  employee.leaveAccrual = employee.leaveAccrual || {};
  let manualAdjustment = Number(employee.leaveAccrual.manualAdjustment);
  if (!Number.isFinite(manualAdjustment)) {
    manualAdjustment = 0;
  }

  const currentYm = ym(asOfFloor);
  const existingTotal = Number(employee.totalLeaveAvailable);

  let base = 0;
  if (annual > 0) {
    if (isLumpSum) {
      base = Math.max(0, annual - used);
    } else {
      const defaultRate = Number(policy.ratePerMonth) || 0;
      const probationRate = Number(policy.probationRatePerMonth) || 0;
      const status = String(employee.employmentStatus || "").toUpperCase();
      const isProbation = status === "PROBATION";
      const rate = Number(isProbation ? probationRate : defaultRate) || 0;

      if (rate > 0) {
        const joinDate = parseDate(employee.joiningDate);
        const policyStart = parseDate(policy.applicableFrom);
        const createdAt = parseDate(employee.createdAt);

        let accrualStart;
        if (policyStart && (!joinDate || policyStart > joinDate)) {
          accrualStart = policyStart;
        } else {
          accrualStart = joinDate || policyStart || createdAt || asOfDate;
        }
        accrualStart = startOfMonth(accrualStart);

        if (accrualStart <= asOfFloor) {
          const firstYm = ym(accrualStart);
          const baselineYm = prevMonthYm(firstYm);
          let months = monthsDiff(baselineYm, ym(asOfFloor));
          if (months < 0) months = 0;

          const potential = rate * months;
          const maxBase = Math.max(0, annual - used);
          base = Math.min(Math.max(0, potential), maxBase);
        }
      }
    }
  }

  if (employee.leaveAccrual.lastAccruedYearMonth === currentYm) {
    if (Number.isFinite(existingTotal)) {
      const computed = base + manualAdjustment;
      const delta = existingTotal - computed;
      if (Math.abs(delta) > 1e-6) {
        manualAdjustment += delta;
      }
    }
  }

  const total = base + manualAdjustment;
  employee.totalLeaveAvailable = total;
  employee.leaveAccrual.manualAdjustment = manualAdjustment;
  employee.leaveAccrual.lastAccruedYearMonth = currentYm;
  await employee.save();
}

// Populate legacy employee.leaveBalances for UI using total and type caps
async function syncLeaveBalances(employee) {
  if (!employee) return;
  const company = await Company.findById(employee.company).select(
    "leavePolicy"
  );
  await accrueTotalIfNeeded(employee, company, new Date());
  const policy = company?.leavePolicy || {};
  const caps = policy.typeCaps || {};
  const used = employee.leaveUsage || {
    paid: 0,
    casual: 0,
    sick: 0,
    unpaid: 0,
  };
  const totalAvail = Math.max(0, Number(employee.totalLeaveAvailable) || 0);
  // Expose remaining caps per type (not limited by shared total). Clients can combine with totalAvail.
  const paidAvail = Math.max(
    0,
    (Number(caps.paid) || 0) - (Number(used.paid) || 0)
  );
  const casualAvail = Math.max(
    0,
    (Number(caps.casual) || 0) - (Number(used.casual) || 0)
  );
  const sickAvail = Math.max(
    0,
    (Number(caps.sick) || 0) - (Number(used.sick) || 0)
  );
  employee.leaveBalances = {
    paid: paidAvail,
    casual: casualAvail,
    sick: sickAvail,
    unpaid: Number(used.unpaid) || 0,
  };
  await employee.save();
}

module.exports = { syncLeaveBalances, accrueTotalIfNeeded };
