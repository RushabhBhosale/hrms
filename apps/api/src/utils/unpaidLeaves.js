const Leave = require("../models/Leave");

function startOfDay(value) {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function normalizeAllocations(allocations) {
  const hasAlloc = allocations || {};
  return {
    paid: Number(hasAlloc.paid || 0),
    casual: Number(hasAlloc.casual || 0),
    sick: Number(hasAlloc.sick || 0),
    unpaid: Number(hasAlloc.unpaid || 0),
  };
}

function distributeLeaveAcrossMonths(leave) {
  const start = startOfDay(new Date(leave.startDate));
  const end = startOfDay(new Date(leave.endDate));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return {};
  }
  const allocations = normalizeAllocations(leave.allocations);
  const countsByMonth = {};
  const cursor = new Date(start);
  while (cursor <= end) {
    if (!isWeekend(cursor)) {
      const key = monthKey(cursor);
      countsByMonth[key] = (countsByMonth[key] || 0) + 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  const totalWorkingDays = Object.values(countsByMonth).reduce(
    (sum, count) => sum + count,
    0
  );

  if (!totalWorkingDays) {
    const totalAllocated =
      allocations.paid + allocations.casual + allocations.sick + allocations.unpaid;
    if (!Number.isFinite(totalAllocated) || totalAllocated <= 0) return {};
    const key = monthKey(start);
    return {
      [key]: {
        paid: allocations.paid,
        casual: allocations.casual,
        sick: allocations.sick,
        unpaid: allocations.unpaid,
        total: totalAllocated,
      },
    };
  }

  const portions = {};
  for (const [key, days] of Object.entries(countsByMonth)) {
    const ratio = days / totalWorkingDays;
    const paid = allocations.paid * ratio;
    const casual = allocations.casual * ratio;
    const sick = allocations.sick * ratio;
    const unpaid = allocations.unpaid * ratio;
    portions[key] = {
      paid,
      casual,
      sick,
      unpaid,
      total: paid + casual + sick + unpaid,
    };
  }
  return portions;
}

async function computeUnpaidTakenForMonth({
  employeeId,
  companyId,
  month,
  employmentStart,
}) {
  if (
    typeof month !== "string" ||
    !/^\d{4}-\d{2}$/.test(month)
  ) {
    return 0;
  }
  const [year, monthPart] = month.split("-").map((v) => Number(v));
  if (!Number.isFinite(year) || !Number.isFinite(monthPart)) return 0;
  const monthStart = new Date(year, monthPart - 1, 1);
  const monthEnd = new Date(year, monthPart, 0);
  const employmentStartDay = employmentStart
    ? startOfDay(new Date(employmentStart))
    : null;
  if (employmentStartDay && employmentStartDay.getTime() > monthEnd.getTime()) {
    return 0;
  }
  const leaves = await Leave.find({
    employee: employeeId,
    company: companyId,
    status: "APPROVED",
    startDate: { $lte: monthEnd },
    endDate: { $gte: monthStart },
  }).lean();
  let total = 0;
  for (const leave of leaves) {
    let leaveStart = startOfDay(leave.startDate);
    let leaveEnd = startOfDay(leave.endDate);
    if (employmentStartDay && leaveEnd < employmentStartDay) continue;
    if (employmentStartDay && leaveStart < employmentStartDay) {
      leaveStart = employmentStartDay;
    }
    const changed =
      employmentStartDay && leaveStart.getTime() !== startOfDay(leave.startDate).getTime();
    const normalizedLeave = changed
      ? { ...leave, startDate: leaveStart, endDate: leaveEnd }
      : leave;
    const portions = distributeLeaveAcrossMonths(normalizedLeave);
    const amount =
      (portions[month]?.unpaid && Number.isFinite(portions[month]?.unpaid)
        ? portions[month].unpaid
        : 0);
    total += amount;
  }
  return round2(total);
}

module.exports = {
  startOfDay,
  isWeekend,
  monthKey,
  distributeLeaveAcrossMonths,
  computeUnpaidTakenForMonth,
  round2,
};
