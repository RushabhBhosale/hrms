const router = require("express").Router();
const { auth } = require("../middleware/auth");
const Attendance = require("../models/Attendance");
const Employee = require("../models/Employee");
const Leave = require("../models/Leave");
const Company = require("../models/Company");
const Project = require("../models/Project");
const Task = require("../models/Task");
const AttendanceRequest = require("../models/AttendanceRequest");
const AttendanceOverride = require("../models/AttendanceOverride");
const CompanyDayOverride = require("../models/CompanyDayOverride");
const AttendancePenalty = require("../models/AttendancePenalty");
const { sendMail, isEmailEnabled } = require("../utils/mailer");
const { runAutoPunchOut } = require("../jobs/autoPunchOut");
const { runDailyStatusEmailJob } = require("../jobs/dailyStatusEmail");
const { accrueTotalIfNeeded } = require("../utils/leaveBalances");
const { computeDerivedBalances } = require("../utils/leaveMath");
const {
  DEFAULT_SANDWICH_MIN_DAYS,
  normalizeSandwichMinDays,
} = require("../utils/sandwich");
const { requirePrimary } = require("../middleware/roles");

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function getAttendanceStartDate(employee) {
  if (!employee) return null;
  const joining =
    employee.joiningDate && !Number.isNaN(new Date(employee.joiningDate).getTime())
      ? startOfDay(employee.joiningDate)
      : null;
  const attendanceRaw = employee.attendanceStartDate;
  const attendance =
    attendanceRaw && !Number.isNaN(new Date(attendanceRaw).getTime())
      ? startOfDay(attendanceRaw)
      : null;
  if (attendance && joining && attendance < joining) return joining;
  return attendance || joining;
}

// Build yyyy-mm-dd for server-local date
function dateKeyLocal(d) {
  const x = startOfDay(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Treat manual time inputs as belonging to a company-configured timezone.
// If ATTENDANCE_TZ_OFFSET_MINUTES is provided (minutes ahead of UTC), use that.
// Otherwise fall back to the host machine's timezone offset for the target date.
const CONFIGURED_ATTENDANCE_OFFSET_MINUTES = (() => {
  const raw = process.env.ATTENDANCE_TZ_OFFSET_MINUTES;
  if (raw === undefined) return null;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
})();

function resolveAttendanceOffsetMinutes(year, month, day, options = {}) {
  const rawOverride = options.timezoneOffsetMinutes;
  if (Number.isFinite(rawOverride)) return rawOverride;
  if (CONFIGURED_ATTENDANCE_OFFSET_MINUTES !== null)
    return CONFIGURED_ATTENDANCE_OFFSET_MINUTES;
  // Use midday to avoid DST midnight transitions impacting offset lookup.
  const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return -probe.getTimezoneOffset();
}

function buildUtcDateFromLocal(dateKey, timeValue, options = {}) {
  if (dateKey === null || dateKey === undefined)
    throw new Error("Invalid date");

  const normalizedDate = String(dateKey).trim();
  const [yearStr, monthStr, dayStr] = normalizedDate.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);
  if (![year, month, day].every((n) => Number.isFinite(n)))
    throw new Error("Invalid date");

  if (timeValue === null || timeValue === undefined)
    throw new Error("Invalid time");

  const normalizedTime = String(timeValue).trim();
  const [hhRaw, mmRaw] = normalizedTime.split(":");
  const hours = parseInt(hhRaw, 10);
  const minutes = parseInt(mmRaw, 10);
  if (!Number.isFinite(hours) || hours < 0 || hours > 23)
    throw new Error("Invalid hours");
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 59)
    throw new Error("Invalid minutes");

  const offsetMs =
    resolveAttendanceOffsetMinutes(year, month, day, options) * 60000;
  const utcMillis = Date.UTC(year, month - 1, day, hours, minutes);
  return new Date(utcMillis - offsetMs);
}

function extractTimezoneOptions(payload) {
  if (!payload) return {};
  const raw = payload.timezoneOffsetMinutes;
  if (raw === undefined || raw === null) return {};
  const normalized =
    typeof raw === "string" ? raw.trim() : raw;
  if (typeof normalized === "string" && normalized === "") return {};
  const parsed = Number(normalized);
  if (Number.isFinite(parsed)) {
    return { timezoneOffsetMinutes: parsed };
  }
  return {};
}

function httpError(message, status = 400) {
  const err = new Error(message);
  err.statusCode = status;
  return err;
}

function normalizeTimeString(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  const [hhRaw, mmRaw] = str.split(":");
  const hours = parseInt(hhRaw, 10);
  const minutes = parseInt(mmRaw, 10);
  if (!Number.isFinite(hours) || hours < 0 || hours > 23) return null;
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function validatePunchWindowInput(
  dateValue,
  punchIn,
  punchOut,
  timezoneOptions = {}
) {
  if (!dateValue) throw httpError("Missing date");
  const day = startOfDay(new Date(dateValue));
  if (Number.isNaN(day.getTime())) throw httpError("Invalid date");

  const normalizedIn = normalizeTimeString(punchIn);
  const normalizedOut = normalizeTimeString(punchOut);
  if (!normalizedIn || !normalizedOut)
    throw httpError("Both punch-in and punch-out times are required");

  const options = extractTimezoneOptions(timezoneOptions);
  const dateKey = dateKeyLocal(day);

  let punchInDate;
  let punchOutDate;
  try {
    punchInDate = buildUtcDateFromLocal(dateKey, normalizedIn, options);
  } catch (err) {
    throw httpError(err?.message || "Invalid punch-in time");
  }
  try {
    punchOutDate = buildUtcDateFromLocal(dateKey, normalizedOut, options);
  } catch (err) {
    throw httpError(err?.message || "Invalid punch-out time");
  }

  const nextDay = new Date(day);
  nextDay.setDate(nextDay.getDate() + 1);
  if (!(punchInDate >= day && punchInDate < nextDay))
    throw httpError("Punch-in must fall within the selected day");
  if (!(punchOutDate >= day && punchOutDate < nextDay))
    throw httpError("Punch-out must fall within the selected day");
  if (!(punchOutDate > punchInDate))
    throw httpError("Punch-out must be after punch-in");

  const MAX_SPAN_MS = 16 * 60 * 60 * 1000;
  const windowMs = Math.min(
    MAX_SPAN_MS,
    Math.max(0, punchOutDate.getTime() - punchInDate.getTime())
  );

  return {
    day,
    punchInDate,
    punchOutDate,
    punchIn: normalizedIn,
    punchOut: normalizedOut,
    windowMs,
    timezoneOptions: options,
  };
}

async function applyManualAttendanceWindow({
  employeeId,
  date,
  punchIn,
  punchOut,
  timezoneOptions,
  resolvedBy,
}) {
  if (!employeeId) throw httpError("Missing employeeId");

  const { day, punchInDate, punchOutDate, windowMs } =
    validatePunchWindowInput(date, punchIn, punchOut, timezoneOptions);

  let record = await Attendance.findOne({ employee: employeeId, date: day });

  if (!record) {
    record = await Attendance.create({
      employee: employeeId,
      date: day,
      firstPunchIn: punchInDate,
      lastPunchIn: undefined,
      lastPunchOut: punchOutDate,
      workedMs: windowMs,
    });
    await resolveAutoLeavePenaltyForDay(employeeId, day, resolvedBy);
    return record;
  }

  record.firstPunchIn = punchInDate;
  record.lastPunchOut = punchOutDate;
  record.lastPunchIn = undefined;
  record.workedMs = windowMs;

  if (record.autoPunchOut) {
    record.autoPunchOut = false;
    record.autoPunchResolvedAt = new Date();
    record.autoPunchOutAt = punchOutDate;
    record.autoPunchLastIn = undefined;
  }

  if (record.manualFillRequest) {
    record.manualFillRequest.status = "COMPLETED";
    record.manualFillRequest.resolvedAt = new Date();
    record.manualFillRequest.resolvedBy = resolvedBy;
  }

  await record.save();
  await resolveAutoLeavePenaltyForDay(employeeId, day, resolvedBy);

  return record;
}

function isAdminUser(emp) {
  return ["ADMIN", "SUPERADMIN"].includes(emp?.primaryRole);
}

function canViewManualRequests(emp) {
  return (
    isAdminUser(emp) ||
    (emp?.subRoles || []).some((r) => ["hr", "manager"].includes(r))
  );
}

const ATTENDANCE_ISSUE_TYPES = {
  AUTO_PUNCH: "autoPunch",
  MISSING_PUNCH_OUT: "missingPunchOut",
  NO_ATTENDANCE: "noAttendance",
};

function getSandwichPolicyConfig(company) {
  const cfg = company?.leavePolicy?.sandwich || {};
  const enabled = !!cfg.enabled;
  const minDays = normalizeSandwichMinDays(
    cfg.minDays,
    DEFAULT_SANDWICH_MIN_DAYS
  );
  return { enabled, minDays };
}

function shouldApplySandwichRange(rangeStart, rangeEnd, policy) {
  if (!policy?.enabled) return false;
  const start = startOfDay(rangeStart);
  const end = startOfDay(rangeEnd);
  if (end < start) return false;
  const totalDays =
    Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
  return totalDays > policy.minDays;
}

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeAllocations(alloc = {}) {
  return {
    paid: numberOrZero(alloc.paid),
    casual: numberOrZero(alloc.casual),
    sick: numberOrZero(alloc.sick),
    unpaid: numberOrZero(alloc.unpaid),
  };
}

function pickAutoLeaveType(allocations) {
  const normalized = normalizeAllocations(allocations);
  if (normalized.paid > 0) return "PAID";
  if (normalized.casual > 0) return "CASUAL";
  if (normalized.sick > 0) return "SICK";
  return "UNPAID";
}

function buildAutoLeaveReason(day) {
  return `Auto leave: Missing attendance on ${dateKeyLocal(day)}`;
}

async function ensureAutoLeaveDocument({ employee, penalty, allocations, day }) {
  if (!employee || !penalty) return;
  const targetDay = startOfDay(day);
  const normalizedAllocations = normalizeAllocations(allocations || {});
  const fallbackType =
    normalizedAllocations.unpaid > 0 ? "UNPAID" : null;
  const payload = {
    employee: employee._id,
    company: employee.company,
    type: pickAutoLeaveType(normalizedAllocations),
    fallbackType,
    startDate: targetDay,
    endDate: targetDay,
    reason: buildAutoLeaveReason(targetDay),
    status: "APPROVED",
    allocations: normalizedAllocations,
    isAuto: true,
    autoPenalty: penalty._id,
  };
  if (employee.reportingPerson) {
    payload.approver = employee.reportingPerson;
  }
  await Leave.findOneAndUpdate(
    { autoPenalty: penalty._id },
    { $set: payload },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function deleteAutoLeaveDocument({ penalty, employeeId, day }) {
  if (!penalty) return;
  const res = await Leave.deleteOne({ autoPenalty: penalty._id });
  if (res?.deletedCount && res.deletedCount > 0) return;
  if (!employeeId) return;
  const targetDay = startOfDay(day);
  await Leave.deleteMany({
    employee: employeeId,
    startDate: targetDay,
    endDate: targetDay,
    isAuto: true,
    autoPenalty: { $exists: false },
  });
}

async function ensureAutoLeavePenaltyForDay(employeeId, day) {
  if (!employeeId || !day) return null;
  const targetDay = startOfDay(day);
  let penalty = await AttendancePenalty.findOne({
    employee: employeeId,
    date: targetDay,
    resolvedAt: null,
  });
  if (penalty) {
    const employeeLite = await Employee.findById(employeeId).select(
      "company reportingPerson"
    );
    if (employeeLite) {
      await ensureAutoLeaveDocument({
        employee: employeeLite,
        penalty,
        allocations: penalty.allocations || {},
        day: targetDay,
      });
    }
    return penalty;
  }

  const employee = await Employee.findById(employeeId);
  if (!employee || !employee.company) return null;
  const attendanceStart = getAttendanceStartDate(employee);
  if (attendanceStart && targetDay < attendanceStart) {
    return null;
  }
  const company = await Company.findById(employee.company).select("leavePolicy");
  if (!company) return null;

  await accrueTotalIfNeeded(employee, company, targetDay);

  const caps = company.leavePolicy?.typeCaps || {};
  if (!employee.leaveUsage) {
    employee.leaveUsage = { paid: 0, casual: 0, sick: 0, unpaid: 0 };
  }
  const used = employee.leaveUsage;
  used.paid = numberOrZero(used.paid);
  used.casual = numberOrZero(used.casual);
  used.sick = numberOrZero(used.sick);
  used.unpaid = numberOrZero(used.unpaid);

  const totalAvail = Math.max(0, numberOrZero(employee.totalLeaveAvailable));
  let poolRemaining = totalAvail;
  let remaining = 1;
  const allocations = { paid: 0, casual: 0, sick: 0, unpaid: 0 };
  const typeOrder = ["paid", "casual", "sick"];

  for (const type of typeOrder) {
    if (remaining <= 0) break;
    const cap = Math.max(0, numberOrZero(caps[type]));
    const usedType = numberOrZero(used[type]);
    const capRemain = Math.max(0, cap - usedType);
    if (capRemain <= 0 || poolRemaining <= 0) continue;
    const take = Math.min(remaining, Math.min(capRemain, poolRemaining));
    if (take <= 0) continue;
    allocations[type] += take;
    used[type] = usedType + take;
    poolRemaining -= take;
    remaining -= take;
  }

  if (remaining > 0) {
    allocations.unpaid += remaining;
    used.unpaid += remaining;
    remaining = 0;
  }

  const derived = computeDerivedBalances(caps, used);
  const nextLeaveUsage = {
    paid: numberOrZero(used.paid),
    casual: numberOrZero(used.casual),
    sick: numberOrZero(used.sick),
    unpaid: numberOrZero(used.unpaid),
  };
  const nextTotalLeave = Math.max(0, poolRemaining);
  employee.leaveUsage = nextLeaveUsage;
  employee.leaveBalances = derived;
  employee.totalLeaveAvailable = nextTotalLeave;
  await Employee.updateOne(
    { _id: employee._id },
    {
      $set: {
        leaveUsage: nextLeaveUsage,
        leaveBalances: derived,
        totalLeaveAvailable: nextTotalLeave,
      },
    }
  );

  penalty = await AttendancePenalty.create({
    employee: employee._id,
    company: employee.company,
    date: targetDay,
    units:
      allocations.paid +
      allocations.casual +
      allocations.sick +
      allocations.unpaid,
    allocations,
  });
  await ensureAutoLeaveDocument({
    employee,
    penalty,
    allocations,
    day: targetDay,
  });
  return penalty;
}

async function resolveAutoLeavePenaltyForDay(employeeId, day, resolvedBy) {
  if (!employeeId || !day) return;
  const targetDay = startOfDay(day);
  const penalty = await AttendancePenalty.findOne({
    employee: employeeId,
    date: targetDay,
    resolvedAt: null,
  });
  if (!penalty) return;

  const employee = await Employee.findById(employeeId);
  if (!employee) return;
  if (!employee.leaveUsage) {
    employee.leaveUsage = { paid: 0, casual: 0, sick: 0, unpaid: 0 };
  }
  const company = employee.company
    ? await Company.findById(employee.company).select("leavePolicy")
    : null;
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

  const types = ["paid", "casual", "sick", "unpaid"];
  for (const type of types) {
    const current = numberOrZero(used[type]);
    const delta = numberOrZero(allocations[type]);
    used[type] = Math.max(0, current - delta);
  }

  const derived = computeDerivedBalances(caps, used);
  const nextLeaveUsage = {
    paid: numberOrZero(used.paid),
    casual: numberOrZero(used.casual),
    sick: numberOrZero(used.sick),
    unpaid: numberOrZero(used.unpaid),
  };
  employee.leaveUsage = nextLeaveUsage;
  employee.leaveBalances = derived;
  await Employee.updateOne(
    { _id: employee._id },
    {
      $set: {
        leaveUsage: nextLeaveUsage,
        leaveBalances: derived,
        totalLeaveAvailable: employee.totalLeaveAvailable,
      },
    }
  );

  penalty.resolvedAt = new Date();
  penalty.resolvedBy = resolvedBy || employeeId;
  await penalty.save();
  await deleteAutoLeaveDocument({
    penalty,
    employeeId,
    day: targetDay,
  });
}

async function cleanupAutoPenaltiesBeforeStart(employeeId, startDate) {
  if (!employeeId || !startDate) return;
  const cutoff = startOfDay(startDate);
  const penalties = await AttendancePenalty.find({
    employee: employeeId,
    date: { $lt: cutoff },
    resolvedAt: null,
  }).lean();
  for (const p of penalties) {
    try {
      await resolveAutoLeavePenaltyForDay(employeeId, p.date, employeeId);
    } catch (err) {
      console.error(
        "[attendance] failed to resolve old auto penalty",
        err?.message || err
      );
    }
  }
  await Leave.deleteMany({
    employee: employeeId,
    endDate: { $lt: cutoff },
    isAuto: true,
  });
}

function getDayThresholds(workHours) {
  const wh = workHours || {};
  const rawFull =
    Number.isFinite(wh?.minFullDayHours) && wh.minFullDayHours > 0
      ? wh.minFullDayHours
      : 6;
  const rawHalf =
    Number.isFinite(wh?.minHalfDayHours) && wh.minHalfDayHours >= 0
      ? wh.minHalfDayHours
      : 3;
  const fullHours = rawFull;
  const halfHours = Math.min(rawHalf, fullHours);
  return {
    fullHours,
    halfHours,
    fullMs: fullHours * 3600000,
    halfMs: halfHours * 3600000,
  };
}

async function buildMonthlyLeaveSummary({
  employeeId,
  start,
  end,
  company,
  companyOverridesByKey,
  now = new Date(),
  employmentStart,
  attendanceStart,
}) {
  const companyOverrideMap =
    companyOverridesByKey && typeof companyOverridesByKey.get === "function"
      ? companyOverridesByKey
      : new Map();
  const attendanceStartDay = attendanceStart ? startOfDay(attendanceStart) : null;

  const rangeStart = (() => {
    const base = startOfDay(start || new Date());
    if (!employmentStart) return base;
    const employmentDay = startOfDay(employmentStart);
    return employmentDay > base ? employmentDay : base;
  })();

  if (!(end > rangeStart)) {
    return {
      leaveDays: 0,
      halfDayLeaves: 0,
      leaveDates: [],
      bankHolidays: [],
    };
  }

  const overrides = await AttendanceOverride.find({
    employee: employeeId,
    date: { $gte: rangeStart, $lt: end },
  })
    .select("date ignoreHoliday ignoreHalfDay")
    .lean();
  const overrideByKey = new Map(
    overrides.map((o) => [dateKeyLocal(o.date), o])
  );

  const bankHolidayMap = new Map();
  (company?.bankHolidays || [])
    .filter((h) => h.date >= rangeStart && h.date < end)
    .forEach((h) => {
      const key = dateKeyLocal(h.date);
      if (overrideByKey.get(key)?.ignoreHoliday) return;
      bankHolidayMap.set(key, h.name || "Holiday");
    });
  for (const [key, o] of companyOverrideMap) {
    if (o.type === "WORKING") bankHolidayMap.delete(key);
    if (o.type === "HOLIDAY") {
      const label = bankHolidayMap.get(key) || "Company holiday";
      bankHolidayMap.set(key, label);
    }
  }
  const bankHolidayKeys = Array.from(bankHolidayMap.keys()).sort();
  const bankHolidayDetails = bankHolidayKeys.map((key) => ({
    date: key,
    name: bankHolidayMap.get(key) || "Holiday",
  }));
  const bankHolidaySet = new Set(bankHolidayKeys);

  const leaves = await Leave.find({
    employee: employeeId,
    status: "APPROVED",
    startDate: { $lte: end },
    endDate: { $gte: rangeStart },
  }).lean();

  const sandwichPolicy = getSandwichPolicyConfig(company);
  const approvedLeaveSet = new Set();
  const sandwichDaySet = new Set();
  for (const l of leaves) {
    let leaveStart = startOfDay(l.startDate);
    let leaveEnd = startOfDay(l.endDate);
    if (leaveEnd < rangeStart) continue;
    if (leaveStart < rangeStart) leaveStart = rangeStart;
    if (leaveEnd > end) leaveEnd = new Date(end.getTime() - 1);
    const applySandwich = shouldApplySandwichRange(
      leaveStart,
      leaveEnd,
      sandwichPolicy
    );
    for (
      let cursor = new Date(leaveStart);
      cursor <= leaveEnd;
      cursor.setDate(cursor.getDate() + 1)
    ) {
      const key = dateKeyLocal(cursor);
      let isWeekend = cursor.getDay() === 0 || cursor.getDay() === 6;
      const compOv = companyOverrideMap.get(key);
      if (compOv?.type === "WORKING" || compOv?.type === "HALF_DAY")
        isWeekend = false;
      let isHoliday = bankHolidaySet.has(key);
      if (compOv?.type === "WORKING") isHoliday = false;
      if (compOv?.type === "HOLIDAY") isHoliday = true;

      if (!isWeekend && !isHoliday) {
        approvedLeaveSet.add(key);
      } else if (applySandwich && (isWeekend || isHoliday)) {
        sandwichDaySet.add(key);
        approvedLeaveSet.add(key);
      }
    }
  }

  const attRecords = await Attendance.find({
    employee: employeeId,
    date: { $gte: rangeStart, $lt: end },
  })
    .select("date firstPunchIn lastPunchOut lastPunchIn workedMs")
    .lean();
  const attendanceByKey = new Map(
    attRecords.map((r) => [dateKeyLocal(r.date), r])
  );

  const { fullMs: fullDayMs, halfMs: halfDayMs } = getDayThresholds(
    company?.workHours
  );
  const leaveDateSet = new Set();
  let leaveUnits = 0;
  let halfDayCount = 0;

  for (
    let cursor = new Date(rangeStart);
    cursor < end;
    cursor.setDate(cursor.getDate() + 1)
  ) {
    const day = new Date(cursor);
    const key = dateKeyLocal(day);
    const rec = attendanceByKey.get(key);
    const compOv = companyOverrideMap.get(key);
    const ov = overrideByKey.get(key);
    const isSandwichDay = sandwichDaySet.has(key);
    const beforeAttendanceWindow =
      attendanceStartDay && day < attendanceStartDay;

    let isWeekend = day.getDay() === 0 || day.getDay() === 6;
    if (compOv?.type === "WORKING" || compOv?.type === "HALF_DAY")
      isWeekend = false;

    let isHoliday = bankHolidaySet.has(key);
    if (compOv?.type === "WORKING") isHoliday = false;
    if (compOv?.type === "HOLIDAY") isHoliday = true;
    if (ov?.ignoreHoliday) isHoliday = false;
    if (isSandwichDay) {
      isWeekend = false;
      isHoliday = false;
    }

    const inFuture = day > now;
    const hasApprovedLeave = approvedLeaveSet.has(key);
    if (beforeAttendanceWindow && !hasApprovedLeave) continue;

    let timeSpentMs = 0;
    if (rec) {
      timeSpentMs = rec.workedMs || 0;
      if (rec.lastPunchIn && !rec.lastPunchOut) {
        const recDay = startOfDay(new Date(rec.date));
        if (recDay.getTime() === startOfDay(now).getTime()) {
          timeSpentMs += now.getTime() - new Date(rec.lastPunchIn).getTime();
        }
      }
      if (!timeSpentMs && rec.firstPunchIn && rec.lastPunchOut) {
        timeSpentMs =
          new Date(rec.lastPunchOut).getTime() -
          new Date(rec.firstPunchIn).getTime();
      }
    }

    const meetsFullDay = timeSpentMs >= fullDayMs;
    const meetsHalfDay = !meetsFullDay && timeSpentMs >= halfDayMs;
    const meetsHalfOrBetter = meetsFullDay || timeSpentMs >= halfDayMs;
    let dayType = meetsFullDay ? "FULL_DAY" : "HALF_DAY";

    let status = "";
    if (inFuture) status = "";
    else if (isWeekend) status = "WEEKEND";
    else if (isHoliday) status = "HOLIDAY";
    else if (rec && timeSpentMs > 0) {
      status = meetsHalfOrBetter ? "WORKED" : "LEAVE";
    } else if (hasApprovedLeave) {
      status = "LEAVE";
    } else if (!rec || timeSpentMs <= 0) {
      status = "LEAVE";
    } else {
      status = "WORKED";
    }

    let leaveUnit = 0;
    if (!inFuture && !isWeekend && !isHoliday) {
      if (status === "LEAVE") {
        leaveUnit = 1;
      } else if (status === "WORKED") {
        if (meetsFullDay) leaveUnit = 0;
        else if (meetsHalfDay) leaveUnit = 0.5;
        else leaveUnit = 1;
      }
    }

    if (!inFuture && !isWeekend && !isHoliday && compOv?.type === "HALF_DAY") {
      if ((!rec || timeSpentMs <= 0) && leaveUnit === 0) {
        status = "LEAVE";
        leaveUnit = 0.5;
        dayType = "HALF_DAY";
      }
    }

    if (ov?.ignoreHalfDay && status === "WORKED" && dayType === "HALF_DAY") {
      dayType = "FULL_DAY";
      leaveUnit = 0;
    }

    if (leaveUnit > 0) {
      leaveDateSet.add(key);
      if (Math.abs(leaveUnit - 0.5) < 1e-6) halfDayCount += 1;
    }
    leaveUnits += leaveUnit;
  }

  return {
    leaveDays: Math.round(leaveUnits * 100) / 100,
    halfDayLeaves: halfDayCount,
    leaveDates: Array.from(leaveDateSet).sort(),
    bankHolidays: bankHolidayKeys,
    bankHolidayDetails,
  };
}

async function collectAttendanceIssues({
  employeeId,
  start,
  endExclusive,
  employeeDoc,
}) {
  const todayStart = startOfDay(new Date());
  const end = endExclusive ? startOfDay(endExclusive) : todayStart;

  const employee =
    employeeDoc ||
    (await Employee.findById(employeeId)
      .select("company joiningDate attendanceStartDate")
      .lean());

  const employmentStartRaw = employee?.joiningDate;
  const employmentStart = employmentStartRaw
    ? startOfDay(employmentStartRaw)
    : null;
  const attendanceStart = getAttendanceStartDate(employee);
  const effectiveStart = attendanceStart || employmentStart;

  let rangeStart = start ? startOfDay(start) : effectiveStart || todayStart;
  if (effectiveStart && rangeStart < effectiveStart) {
    rangeStart = effectiveStart;
  }

  if (!(end > rangeStart)) return [];
  if (effectiveStart) {
    await cleanupAutoPenaltiesBeforeStart(employeeId, effectiveStart);
  }

  const [records, company, companyOverrides, overrides, leaves] = await Promise.all([
    Attendance.find({
      employee: employeeId,
      date: { $gte: rangeStart, $lt: end },
    })
      .select(
        "date firstPunchIn lastPunchOut autoPunchOut autoPunchOutAt autoPunchLastIn"
      )
      .lean(),
    employee?.company
      ? Company.findById(employee.company).select("bankHolidays").lean()
      : null,
    employee?.company
      ? CompanyDayOverride.find({
          company: employee.company,
          date: { $gte: rangeStart, $lt: end },
        })
          .select("date type")
          .lean()
      : [],
    AttendanceOverride.find({
      employee: employeeId,
      date: { $gte: rangeStart, $lt: end },
    })
      .select("date ignoreHoliday")
      .lean(),
    Leave.find({
      employee: employeeId,
      status: { $in: ["PENDING", "APPROVED"] },
      startDate: { $lte: end },
      endDate: { $gte: rangeStart },
    })
      .select("startDate endDate status")
      .lean(),
  ]);

  const attendanceByKey = new Map(records.map((r) => [dateKeyLocal(r.date), r]));
  const overrideByKey = new Map(overrides.map((o) => [dateKeyLocal(o.date), o]));
  const companyOverrideByKey = new Map(
    (companyOverrides || []).map((o) => [dateKeyLocal(o.date), o])
  );

  const holidaySet = new Set(
    (company?.bankHolidays || [])
      .filter((h) => h.date >= rangeStart && h.date < end)
      .map((h) => dateKeyLocal(h.date))
  );

  const leaveKeys = new Set();
  for (const leave of leaves) {
    const startDay = leave.startDate < rangeStart ? new Date(rangeStart) : startOfDay(leave.startDate);
    const endBound = leave.endDate >= end ? new Date(end.getTime() - 1) : leave.endDate;
    const endDay = startOfDay(endBound);
    for (let cursor = new Date(startDay); cursor <= endDay; cursor.setDate(cursor.getDate() + 1)) {
      leaveKeys.add(dateKeyLocal(cursor));
    }
  }

  const issues = [];
  const missingAttendanceDays = [];
  for (let cursor = new Date(rangeStart); cursor < end; cursor.setDate(cursor.getDate() + 1)) {
    const day = startOfDay(cursor);
    if (day >= todayStart) break;
    if (effectiveStart && day < effectiveStart) continue;

    const key = dateKeyLocal(day);
    const rec = attendanceByKey.get(key);

    let isWeekend = day.getDay() === 0 || day.getDay() === 6;
    const compOverride = companyOverrideByKey.get(key);
    if (compOverride?.type === "WORKING") isWeekend = false;

    let isHoliday = holidaySet.has(key);
    if (compOverride?.type === "HOLIDAY") {
      isHoliday = true;
      isWeekend = false;
    }

    const override = overrideByKey.get(key);
    if (override?.ignoreHoliday) isHoliday = false;

    if (isWeekend || isHoliday) continue;
    if (leaveKeys.has(key)) continue;

    if (!rec || !rec.firstPunchIn) {
      issues.push({ date: key, type: ATTENDANCE_ISSUE_TYPES.NO_ATTENDANCE });
      missingAttendanceDays.push(new Date(day));
      continue;
    }

    if (!rec.lastPunchOut) {
      issues.push({ date: key, type: ATTENDANCE_ISSUE_TYPES.MISSING_PUNCH_OUT });
      continue;
    }

    if (rec.autoPunchOut) {
      issues.push({
        date: key,
        type: ATTENDANCE_ISSUE_TYPES.AUTO_PUNCH,
        autoPunchOutAt: rec.autoPunchOutAt
          ? new Date(rec.autoPunchOutAt).toISOString()
          : rec.lastPunchOut
          ? new Date(rec.lastPunchOut).toISOString()
          : undefined,
      });
    }
  }

  if (missingAttendanceDays.length) {
    for (const d of missingAttendanceDays) {
      try {
        await ensureAutoLeavePenaltyForDay(employeeId, d);
      } catch (err) {
        console.error("auto-penalty error", err?.message || err);
      }
    }
  }

  return issues;
}

router.post("/punch", auth, async (req, res) => {
  const { action } = req.body;
  if (!["in", "out"].includes(action))
    return res.status(400).json({ error: "Invalid action" });

  const rawLocation =
    typeof req.body.location === "string" ? req.body.location.trim() : "";
  const locationLabel = rawLocation ? rawLocation.slice(0, 140) : "";
  const triggerDailyStatusEmail =
    req.body?.triggerDailyStatusEmail === true ||
    req.body?.triggerDailyStatusEmail === "true" ||
    req.body?.triggerDailyStatusEmail === 1 ||
    req.body?.triggerDailyStatusEmail === "1";

  const today = startOfDay(new Date());

  if (action === "in") {
    const employeeDoc = await Employee.findById(req.employee.id)
      .select("company joiningDate attendanceStartDate")
      .lean();
    const fallbackStart = new Date(today);
    fallbackStart.setDate(fallbackStart.getDate() - 365);
    const startBoundary =
      getAttendanceStartDate(employeeDoc) ||
      (employeeDoc?.joiningDate ? new Date(employeeDoc.joiningDate) : null);
    const lookbackStart = startBoundary || fallbackStart;
    const issues = await collectAttendanceIssues({
      employeeId: req.employee.id,
      start: lookbackStart,
      endExclusive: today,
      employeeDoc,
    });
    if (issues.length) {
      const issueCount = issues.length;
      return res.status(409).json({
        error: `You still have ${issueCount} pending attendance ${
          issueCount === 1 ? "issue" : "issues"
        }. Open Resolve Attendance Issues to continue.`,
        issues,
        issueCount,
      });
    }
  }

  let record = await Attendance.findOne({
    employee: req.employee.id,
    date: today,
  });
  const now = new Date();
  if (!record) {
    if (action === "out")
      return res.status(400).json({ error: "Must punch in first" });
    record = await Attendance.create({
      employee: req.employee.id,
      date: today,
      firstPunchIn: now,
      lastPunchIn: now,
      firstPunchInLocation: locationLabel || undefined,
      lastPunchInLocation: locationLabel || undefined,
    });
    return res.json({ attendance: record });
  }

  if (action === "in") {
    if (!record.lastPunchIn) {
      if (!record.firstPunchIn) record.firstPunchIn = now;
      record.lastPunchIn = now;
      record.lastPunchOut = undefined;
    }
    if (locationLabel) {
      if (!record.firstPunchInLocation) {
        record.firstPunchInLocation = locationLabel;
      }
      record.lastPunchInLocation = locationLabel;
    }
  } else {
    if (record.lastPunchIn) {
      record.workedMs += now.getTime() - record.lastPunchIn.getTime();
      record.lastPunchOut = now;
      record.lastPunchIn = undefined;
    }
  }
  await record.save();
  if (action === "out" && triggerDailyStatusEmail) {
    const punchOutEmployeeId = req.employee?.id ? String(req.employee.id) : null;
    if (!punchOutEmployeeId) {
      console.warn(
        "daily-status dispatch (punch-out) skipped: missing employee id"
      );
      return res.json({ attendance: record });
    }
    setImmediate(() => {
      runDailyStatusEmailJob({
        employeeIds: [punchOutEmployeeId],
        strictEmployeeFilter: true,
        source: "punchout",
      }).catch((err) =>
        console.warn(
          "daily-status dispatch (punch-out) failed",
          err?.message || err
        )
      );
    });
  }
  res.json({ attendance: record });
});

router.get("/today", auth, async (req, res) => {
  const today = startOfDay(new Date());
  const record = await Attendance.findOne({
    employee: req.employee.id,
    date: today,
  });
  res.json({ attendance: record });
});

// Daily status email notifications are disabled.
router.post(
  "/daily-status/send",
  auth,
  requirePrimary(["ADMIN", "SUPERADMIN"]),
  async (_req, res) =>
    res.status(403).json({ error: "Daily status notifications are disabled" })
);

router.get("/history/:employeeId?", auth, async (req, res) => {
  const targetId = req.params.employeeId || req.employee.id;
  const isSelf = String(targetId) === String(req.employee.id);
  const canViewOthers =
    ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole) ||
    (req.employee.subRoles || []).some((r) => ["hr", "manager"].includes(r));
  if (!isSelf && !canViewOthers)
    return res.status(403).json({ error: "Forbidden" });
  const records = await Attendance.find({ employee: targetId }).sort({
    date: -1,
  });
  res.json({ attendance: records });
});

// Monthly work report for an employee
router.get("/report/:employeeId?", auth, async (req, res) => {
  const targetId = req.params.employeeId || req.employee.id;
  const isSelf = String(targetId) === String(req.employee.id);
  const canViewOthers =
    ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole) ||
    (req.employee.subRoles || []).some((r) => ["hr", "manager"].includes(r));
  if (!isSelf && !canViewOthers)
    return res.status(403).json({ error: "Forbidden" });

  const scopeAll = String(req.query.scope || "").toLowerCase() === "all";
  const now = new Date();
  let start;
  let end;
  if (scopeAll) {
    start = startOfDay(new Date(0));
    end = startOfDay(now);
    end.setDate(end.getDate() + 1);
  } else {
    const { month } = req.query;
    if (month) {
      start = startOfDay(new Date(month + "-01"));
    } else {
      start = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
    }
    end = new Date(start);
    end.setMonth(end.getMonth() + 1);
  }

  const workedDays = await Attendance.countDocuments({
    employee: targetId,
    date: { $gte: start, $lt: end },
  });

  const emp = await Employee.findById(targetId).select(
    "company name joiningDate attendanceStartDate"
  );
  try { emp?.decryptFieldsSync?.(); } catch (_) {}
  const employmentStart =
    emp?.joiningDate ? startOfDay(emp.joiningDate) : null;
  const attendanceStart = getAttendanceStartDate(emp);
  const autoStart = attendanceStart || employmentStart;
  if (autoStart) {
    await cleanupAutoPenaltiesBeforeStart(targetId, autoStart);
  }
  const company = emp
    ? await Company.findById(emp.company).select("bankHolidays workHours leavePolicy")
    : null;

  // Company-wide day overrides for this month
  const companyOverrides = emp
    ? await CompanyDayOverride.find({
        company: emp.company,
        date: { $gte: start, $lt: end },
        isDeleted: { $ne: true },
        isActive: { $ne: false },
      })
        .select("date type")
        .lean()
    : [];
  const companyOvByKey = new Map(
    companyOverrides.map((o) => [dateKeyLocal(o.date), o])
  );

  const summary = await buildMonthlyLeaveSummary({
    employeeId: targetId,
    start,
    end,
    company,
    companyOverridesByKey: companyOvByKey,
    now: new Date(),
    employmentStart,
    attendanceStart,
  });

  res.json({
    report: {
      workedDays,
      leaveDays: summary.leaveDays,
      leaveDates: summary.leaveDates,
      halfDayLeaves: summary.halfDayLeaves,
      bankHolidays: summary.bankHolidays,
      bankHolidayDetails: summary.bankHolidayDetails,
      employmentStart: emp?.joiningDate || null,
      attendanceStartDate: attendanceStart || null,
    },
  });
});


// Detailed monthly day-by-day report for a selected employee
// Includes every day of the month with punch in/out, time spent and day type
router.get("/monthly/:employeeId?", auth, async (req, res) => {
  try {
    const targetId = req.params.employeeId || req.employee.id;
    const isSelf = String(targetId) === String(req.employee.id);
    const canViewOthers =
      ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole) ||
      (req.employee.subRoles || []).some((r) => ["hr", "manager"].includes(r));
    if (!isSelf && !canViewOthers)
      return res.status(403).json({ error: "Forbidden" });

    const { month } = req.query; // yyyy-mm
    let start;
    if (month) {
      start = startOfDay(new Date(month + "-01"));
    } else {
      const now = new Date();
      start = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
    }
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);

    // Load company holidays and approved leaves that overlap this month
    const emp = await Employee.findById(targetId).select("company joiningDate");
    try { emp?.decryptFieldsSync?.(); } catch (_) {}
    const company = emp
      ? await Company.findById(emp.company).select("bankHolidays workHours leavePolicy")
      : null;
    const employmentStart = emp?.joiningDate ? startOfDay(emp.joiningDate) : null;

    // Load company-wide day overrides for the selected month
    const compOverrides = emp
      ? await CompanyDayOverride.find({
          company: emp.company,
          date: { $gte: start, $lt: end },
          isDeleted: { $ne: true },
          isActive: { $ne: false },
        })
          .select("date type")
          .lean()
      : [];
    const compOvByKey = new Map(compOverrides.map((o) => [dateKeyLocal(o.date), o]));

    // Load overrides and prepare maps
    const overrides = await AttendanceOverride.find({
      employee: targetId,
      date: { $gte: start, $lt: end },
    })
      .select("date ignoreHoliday ignoreHalfDay ignoreLate")
      .lean();
    const overrideByKey = new Map(
      overrides.map((o) => [dateKeyLocal(o.date), o])
    );

    const bankHolidaySet = new Set(
      (company?.bankHolidays || [])
        .filter((h) => h.date >= start && h.date < end)
        .map((h) => dateKeyLocal(h.date))
        .filter((key) => !(overrideByKey.get(key)?.ignoreHoliday))
    );
    // Apply company-level overrides on holidays
    for (const [key, o] of compOvByKey) {
      if (o.type === 'WORKING') bankHolidaySet.delete(key);
      if (o.type === 'HOLIDAY') bankHolidaySet.add(key);
    }

    const leaves = await Leave.find({
      employee: targetId,
      status: "APPROVED",
      startDate: { $lte: end },
      endDate: { $gte: start },
    }).lean();
    const approvedLeaveSet = new Set();
    for (const l of leaves) {
      let s = startOfDay(l.startDate);
      let e = startOfDay(l.endDate);
      if (employmentStart && e < employmentStart) continue;
      if (employmentStart && s < employmentStart) s = employmentStart;
      if (s < start) s = start;
      if (e > end) e = new Date(end.getTime() - 1);
      for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
        const key = dateKeyLocal(d);
        const dow = d.getDay();
        const isWeekend = dow === 0 || dow === 6;
        if (!bankHolidaySet.has(key) && !isWeekend) approvedLeaveSet.add(key);
      }
    }

    // Pull all attendance records for the month
    const records = await Attendance.find({
      employee: targetId,
      date: { $gte: start, $lt: end },
    }).lean();

    const byKey = new Map();
    for (const r of records) {
      const key = dateKeyLocal(r.date);
      byKey.set(key, r);
    }

    const { fullMs: fullDayMs, halfMs: halfDayMs } = getDayThresholds(
      company?.workHours
    );

    const days = [];
    let totalLeaveUnits = 0;
    const now = new Date();
    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
      const key = dateKeyLocal(d);
      const rec = byKey.get(key);
      const dow = d.getDay();
      const beforeEmployment = employmentStart && startOfDay(d) < employmentStart;
      let isWeekend = dow === 0 || dow === 6;
      const compOv = compOvByKey.get(key);
      if (compOv?.type === 'WORKING') isWeekend = false; // treat as working even if weekend
      // Base flags
      let isHoliday = bankHolidaySet.has(key);
      if (compOv?.type === 'WORKING') isHoliday = false;
      if (compOv?.type === 'HOLIDAY') isHoliday = true;
      const isApprovedLeave = beforeEmployment ? false : approvedLeaveSet.has(key);
      const inFuture = d > new Date();

      let firstPunchIn = rec?.firstPunchIn ? new Date(rec.firstPunchIn) : null;
      let lastPunchOut = rec?.lastPunchOut ? new Date(rec.lastPunchOut) : null;
      let timeSpentMs = 0;
      if (rec) {
        timeSpentMs = rec.workedMs || 0;
        if (rec.lastPunchIn && !rec.lastPunchOut) {
          const recDay = startOfDay(new Date(rec.date));
          if (recDay.getTime() === startOfDay(now).getTime()) {
            timeSpentMs += now.getTime() - new Date(rec.lastPunchIn).getTime();
          }
        }
        if (!timeSpentMs && rec.firstPunchIn && rec.lastPunchOut) {
          timeSpentMs =
            new Date(rec.lastPunchOut).getTime() -
            new Date(rec.firstPunchIn).getTime();
        }
      }

      const meetsFullDay = timeSpentMs >= fullDayMs;
      const meetsHalfDay = !meetsFullDay && timeSpentMs >= halfDayMs;
      const meetsHalfOrBetter = meetsFullDay || timeSpentMs >= halfDayMs;
      let dayType = meetsFullDay ? "FULL_DAY" : "HALF_DAY";

      let status = "";
      if (beforeEmployment) status = "NOT_JOINED";
      else if (inFuture) status = "";
      else if (isWeekend) status = "WEEKEND";
      else if (isHoliday) status = "HOLIDAY";
      else if (rec && timeSpentMs > 0) {
        status = meetsHalfOrBetter ? "WORKED" : "LEAVE";
      }
      else if (isApprovedLeave) status = "LEAVE";
      else if (!rec || timeSpentMs <= 0) status = "LEAVE";
      else status = "WORKED";

      // Leave units: exclude weekends/holidays; count 1 for leave days, 0.5 for half-day work
      let leaveUnit = 0;
      if (!beforeEmployment && !inFuture && !isWeekend && !isHoliday) {
        if (status === "LEAVE") {
          leaveUnit = 1;
        } else if (status === "WORKED") {
          if (meetsFullDay) {
            leaveUnit = 0;
          } else if (meetsHalfDay) {
            leaveUnit = 0.5;
          } else {
            leaveUnit = 1;
          }
        }
      }
      // If company override marks the day as HALF_DAY (and no attendance), count as 0.5 leave
      if (!inFuture && !isWeekend && !isHoliday && compOv?.type === 'HALF_DAY') {
        if ((!rec || timeSpentMs <= 0) && leaveUnit === 0) {
          status = 'LEAVE';
          leaveUnit = 0.5;
        }
      }
      totalLeaveUnits += leaveUnit;

      // Compute late and overtime using company work hours (if configured)
      let lateMinutes = 0;
      let overtimeMinutes = 0;
      const wh = company?.workHours || {};
      if (!inFuture && rec && rec.firstPunchIn && (!isWeekend && !isHoliday)) {
        if (typeof wh.start === 'string' && /^\d{2}:\d{2}$/.test(wh.start)) {
          const [sh, sm] = wh.start.split(":").map((x) => parseInt(x, 10));
          const grace = Number.isFinite(wh.graceMinutes) ? wh.graceMinutes : 0;
          const schedStart = new Date(d);
          schedStart.setHours(sh, sm + (grace || 0), 0, 0);
          const fp = new Date(rec.firstPunchIn);
          const diffMs = fp.getTime() - schedStart.getTime();
          if (diffMs > 0) lateMinutes = Math.floor(diffMs / 60000);
        }
      }
      if (!inFuture && rec && rec.lastPunchOut && (!isWeekend && !isHoliday)) {
        if (typeof wh.end === 'string' && /^\d{2}:\d{2}$/.test(wh.end)) {
          const [eh, em] = wh.end.split(":").map((x) => parseInt(x, 10));
          const schedEnd = new Date(d);
          schedEnd.setHours(eh, em, 0, 0);
          const lp = new Date(rec.lastPunchOut);
          const diffMs = lp.getTime() - schedEnd.getTime();
          if (diffMs > 0) overtimeMinutes = Math.floor(diffMs / 60000);
        }
      }

      // Apply per-day overrides
      const ov = overrideByKey.get(key);
      const ignored = { ignoredLate: false, ignoredHalfDay: false, ignoredHoliday: false };
      if (ov?.ignoreHoliday) {
        // Already removed from bankHolidaySet above, but keep marker
        ignored.ignoredHoliday = true;
        isHoliday = false;
        if (status === "HOLIDAY") status = rec && timeSpentMs > 0 ? "WORKED" : ""; // recompute minimal sensible status
      }
      if (ov?.ignoreHalfDay && status === "WORKED" && dayType === "HALF_DAY") {
        dayType = "FULL_DAY";
        // If we flipped to full day, remove the 0.5 leave unit
        if (!inFuture && !isWeekend) {
          totalLeaveUnits -= leaveUnit;
          leaveUnit = 0;
        }
        ignored.ignoredHalfDay = true;
      }
      if (ov?.ignoreLate && lateMinutes > 0) {
        lateMinutes = 0;
        ignored.ignoredLate = true;
      }

      days.push({
        date: key,
        firstPunchIn: firstPunchIn ? firstPunchIn.toISOString() : null,
        lastPunchOut: lastPunchOut ? lastPunchOut.toISOString() : null,
        firstPunchInLocation: rec?.firstPunchInLocation || null,
        lastPunchInLocation: rec?.lastPunchInLocation || null,
        timeSpentMs,
        dayType,
        status,
        isWeekend,
        isHoliday,
        isApprovedLeave,
        leaveUnit,
        lateMinutes,
        overtimeMinutes,
        ...ignored,
      });
    }

    res.json({
      month: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(
        2,
        "0"
      )}`,
      employeeId: String(targetId),
      totalLeaveDays: totalLeaveUnits,
      days,
    });
  } catch (e) {
    console.error("monthly report error", e);
    res.status(500).json({ error: "Failed to build monthly report" });
  }
});

// Excel export for monthly report
router.get("/monthly/:employeeId/excel", auth, async (req, res) => {
  try {
    const targetId = req.params.employeeId || req.employee.id;
    const isSelf = String(targetId) === String(req.employee.id);
    const canViewOthers =
      ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole) ||
      (req.employee.subRoles || []).some((r) => ["hr", "manager"].includes(r));
    if (!isSelf && !canViewOthers)
      return res.status(403).json({ error: "Forbidden" });

    // Reuse JSON builder via internal fetch to avoid code duplication
    // Build the same data as /monthly
    const { month } = req.query;
    let start;
    if (month) {
      start = startOfDay(new Date(month + "-01"));
    } else {
      const now = new Date();
      start = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
    }
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);

    // Pull company holidays and approved leaves
    const emp = await Employee.findById(targetId).select("company name joiningDate");
    try { emp?.decryptFieldsSync?.(); } catch (_) {}
    const company = emp
      ? await Company.findById(emp.company).select("bankHolidays workHours leavePolicy")
      : null;
    const employmentStart = emp?.joiningDate ? startOfDay(emp.joiningDate) : null;

    // Load company-wide overrides
    const compOverrides = emp
      ? await CompanyDayOverride.find({
          company: emp.company,
          date: { $gte: start, $lt: end },
          isDeleted: { $ne: true },
          isActive: { $ne: false },
        })
          .select("date type")
          .lean()
      : [];
    const compOvByKey = new Map(compOverrides.map((o) => [dateKeyLocal(o.date), o]));

    // Load overrides
    const overrides = await AttendanceOverride.find({
      employee: targetId,
      date: { $gte: start, $lt: end },
    })
      .select("date ignoreHoliday ignoreHalfDay ignoreLate")
      .lean();
    const overrideByKey = new Map(
      overrides.map((o) => [dateKeyLocal(o.date), o])
    );

    const bankHolidaySet = new Set(
      (company?.bankHolidays || [])
        .filter((h) => h.date >= start && h.date < end)
        .map((h) => dateKeyLocal(h.date))
        .filter((key) => !(overrideByKey.get(key)?.ignoreHoliday))
    );
    for (const [key, o] of compOvByKey) {
      if (o.type === 'WORKING') bankHolidaySet.delete(key);
      if (o.type === 'HOLIDAY') bankHolidaySet.add(key);
    }
    const leaves = await Leave.find({
      employee: targetId,
      status: "APPROVED",
      startDate: { $lte: end },
      endDate: { $gte: start },
    }).lean();
    const sandwichPolicy = getSandwichPolicyConfig(company);
    const approvedLeaveSet = new Set();
    const sandwichDaySet = new Set();
    for (const l of leaves) {
      let s = startOfDay(l.startDate);
      let e = startOfDay(l.endDate);
      if (employmentStart && e < employmentStart) continue;
      if (employmentStart && s < employmentStart) s = employmentStart;
      if (s < start) s = start;
      if (e > end) e = new Date(end.getTime() - 1);
      const applySandwich = shouldApplySandwichRange(s, e, sandwichPolicy);
      for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
        const key = dateKeyLocal(d);
        const compOv = compOvByKey.get(key);
        let isWeekend = d.getDay() === 0 || d.getDay() === 6;
        if (compOv?.type === 'WORKING' || compOv?.type === 'HALF_DAY')
          isWeekend = false;
        let isHoliday = bankHolidaySet.has(key);
        if (compOv?.type === 'WORKING') isHoliday = false;
        if (compOv?.type === 'HOLIDAY') isHoliday = true;

        if (!isWeekend && !isHoliday) {
          approvedLeaveSet.add(key);
        } else if (applySandwich && (isWeekend || isHoliday)) {
          sandwichDaySet.add(key);
          approvedLeaveSet.add(key);
        }
      }
    }

    const records = await Attendance.find({
      employee: targetId,
      date: { $gte: start, $lt: end },
    }).lean();
    const byKey = new Map();
    for (const r of records) {
      const key = dateKeyLocal(r.date);
      byKey.set(key, r);
    }

    const { fullMs: fullDayMs, halfMs: halfDayMs } = getDayThresholds(
      company?.workHours
    );

    const rows = [];
    let totalLeaveUnits = 0;
    const now = new Date();
    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
      const key = dateKeyLocal(d);
      const rec = byKey.get(key);
      const dow = d.getDay();
      const beforeEmployment = employmentStart && startOfDay(d) < employmentStart;
      let isWeekend = dow === 0 || dow === 6;
      const compOv = compOvByKey.get(key);
      if (compOv?.type === 'WORKING') isWeekend = false;
      let isHoliday = bankHolidaySet.has(key);
      if (compOv?.type === 'WORKING') isHoliday = false;
      if (compOv?.type === 'HOLIDAY') isHoliday = true;
      const isSandwichDay = sandwichDaySet.has(key);
      if (isSandwichDay) {
        isWeekend = false;
        isHoliday = false;
      }
      const isApprovedLeave = beforeEmployment ? false : approvedLeaveSet.has(key);

      let timeSpentMs = 0;
      if (rec) {
        timeSpentMs = rec.workedMs || 0;
        if (rec.lastPunchIn && !rec.lastPunchOut) {
          const recDay = startOfDay(new Date(rec.date));
          if (recDay.getTime() === startOfDay(now).getTime()) {
            timeSpentMs += now.getTime() - new Date(rec.lastPunchIn).getTime();
          }
        }
        if (!timeSpentMs && rec.firstPunchIn && rec.lastPunchOut) {
          timeSpentMs =
            new Date(rec.lastPunchOut).getTime() -
            new Date(rec.firstPunchIn).getTime();
        }
      }
      const meetsFullDay = timeSpentMs >= fullDayMs;
      const meetsHalfDay = !meetsFullDay && timeSpentMs >= halfDayMs;
      const meetsHalfOrBetter = meetsFullDay || timeSpentMs >= halfDayMs;
      let dayType = meetsFullDay ? "FULL_DAY" : "HALF_DAY";
      const inFuture = d > new Date();
      let status = "";
      if (beforeEmployment) status = "NOT_JOINED";
      else if (inFuture) status = "";
      else if (isWeekend) status = "WEEKEND";
      else if (isHoliday) status = "HOLIDAY";
      // Consider actual worked time first; approved leave should not override presence of work
      else if (rec && timeSpentMs > 0) {
        status = meetsHalfOrBetter ? "WORKED" : "LEAVE";
      }
      else if (isApprovedLeave) status = "LEAVE";
      else if (!rec || timeSpentMs <= 0) status = "LEAVE";
      else status = "WORKED";

      let leaveUnit = 0;
      if (!beforeEmployment && !inFuture && !isWeekend && !isHoliday) {
        if (status === "LEAVE") {
          leaveUnit = 1;
        } else if (status === "WORKED") {
          if (meetsFullDay) {
            leaveUnit = 0;
          } else if (meetsHalfDay) {
            leaveUnit = 0.5;
          } else {
            leaveUnit = 1;
          }
        }
      }
      if (!inFuture && !isWeekend && !isHoliday && compOv?.type === 'HALF_DAY') {
        if ((!rec || timeSpentMs <= 0) && leaveUnit === 0) {
          status = 'LEAVE';
          leaveUnit = 0.5;
        }
      }
      totalLeaveUnits += leaveUnit;

      // Compute late and overtime using company work hours (if configured)
      let lateMinutes = 0;
      let overtimeMinutes = 0;
      const wh = company?.workHours || {};
      if (!inFuture && rec && rec.firstPunchIn && (!isWeekend && !isHoliday)) {
        if (typeof wh.start === 'string' && /^\d{2}:\d{2}$/.test(wh.start)) {
          const [sh, sm] = wh.start.split(":").map((x) => parseInt(x, 10));
          const grace = Number.isFinite(wh.graceMinutes) ? wh.graceMinutes : 0;
          const schedStart = new Date(d);
          schedStart.setHours(sh, sm + (grace || 0), 0, 0);
          const fp = new Date(rec.firstPunchIn);
          const diffMs = fp.getTime() - schedStart.getTime();
          if (diffMs > 0) lateMinutes = Math.floor(diffMs / 60000);
        }
      }
      if (!inFuture && rec && rec.lastPunchOut && (!isWeekend && !isHoliday)) {
        if (typeof wh.end === 'string' && /^\d{2}:\d{2}$/.test(wh.end)) {
          const [eh, em] = wh.end.split(":").map((x) => parseInt(x, 10));
          const schedEnd = new Date(d);
          schedEnd.setHours(eh, em, 0, 0);
          const lp = new Date(rec.lastPunchOut);
          const diffMs = lp.getTime() - schedEnd.getTime();
          if (diffMs > 0) overtimeMinutes = Math.floor(diffMs / 60000);
        }
      }

      // Apply overrides
      const ov = overrideByKey.get(key);
      if (ov?.ignoreHoliday) {
        isHoliday = false;
        if (status === "HOLIDAY") status = rec && timeSpentMs > 0 ? "WORKED" : "";
      }
      if (ov?.ignoreHalfDay && status === "WORKED" && dayType === "HALF_DAY") {
        dayType = "FULL_DAY";
        if (!inFuture && !isWeekend) {
          totalLeaveUnits -= leaveUnit;
          leaveUnit = 0;
        }
      }
      if (ov?.ignoreLate && lateMinutes > 0) {
        lateMinutes = 0;
      }

      rows.push({
        Date: key,
        "Punch In": rec?.firstPunchIn ? new Date(rec.firstPunchIn) : null,
        "Punch Out": rec?.lastPunchOut ? new Date(rec.lastPunchOut) : null,
        "Punch Location":
          rec?.lastPunchInLocation ||
          rec?.firstPunchInLocation ||
          "",
        "Time Spent (hrs)": Math.round((timeSpentMs / 3600000) * 100) / 100,
        Status:
          status === "WORKED"
            ? dayType === "FULL_DAY"
              ? "Full Day"
              : "Half Day"
            : status,
        "Leave Unit": leaveUnit,
        "Late (mins)": lateMinutes,
        "Overtime (mins)": overtimeMinutes,
      });
    }

    // Build Excel workbook
    const Excel = require("exceljs");
    const wb = new Excel.Workbook();
    const ws = wb.addWorksheet("Monthly Report");

    ws.columns = [
      { header: "Date", key: "Date", width: 12 },
      { header: "Punch In", key: "Punch In", width: 18 },
      { header: "Punch Out", key: "Punch Out", width: 18 },
      { header: "Punch Location", key: "Punch Location", width: 24 },
      { header: "Time Spent (hrs)", key: "Time Spent (hrs)", width: 18 },
      { header: "Status", key: "Status", width: 16 },
      { header: "Leave Unit", key: "Leave Unit", width: 12 },
      { header: "Late (mins)", key: "Late (mins)", width: 12 },
      { header: "Overtime (mins)", key: "Overtime (mins)", width: 14 },
    ];

    // Add metadata header
    ws.addRow([`Employee: ${emp?.name || targetId}`]);
    const ym = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(
      2,
      "0"
    )}`;
    ws.addRow([`Month: ${ym}`]);
    ws.addRow([`Total Leave Days: ${totalLeaveUnits}`]);
    ws.addRow([]);

    // Table header row
    ws.addRow(ws.columns.map((c) => c.header));
    ws.getRow(ws.rowCount).font = { bold: true };
    const tableHeaderRow = ws.rowCount; // remember header row index for formatting

    // Data rows
    ws.addRows(
      rows.map((r) => ({
        ...r,
        "Punch In": r["Punch In"] ? new Date(r["Punch In"]) : null,
        "Punch Out": r["Punch Out"] ? new Date(r["Punch Out"]) : null,
      }))
    );

    // Format date/time columns for data rows (after header)
    const firstDataRow = ws.rowCount - rows.length + 1; // header row index + 1
    const dateCol = 1,
      inCol = 2,
      outCol = 3;
    for (let i = firstDataRow; i <= ws.rowCount; i++) {
      const r = ws.getRow(i);
      const dCell = r.getCell(dateCol);
      const inCell = r.getCell(inCol);
      const outCell = r.getCell(outCol);
      dCell.numFmt = "@";
      if (inCell.value) inCell.numFmt = "h:mm AM/PM";
      if (outCell.value) outCell.numFmt = "h:mm AM/PM";
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=attendance-${(emp?.name || "employee").replace(
        /\s+/g,
        "_"
      )}-${ym}.xlsx`
    );
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error("monthly excel error", e);
    res.status(500).json({ error: "Failed to export excel" });
  }
});

router.get("/company/today", auth, async (req, res) => {
  const allowed =
    ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole) ||
    (req.employee.subRoles || []).some((r) => ["hr", "manager"].includes(r));
  if (!allowed) return res.status(403).json({ error: "Forbidden" });
  const today = startOfDay(new Date());
  // Include all company users (admins/managers/hr) in the headcount so admin punch-ins are visible
  const employees = await Employee.find({
    company: req.employee.company,
  }).select("_id name");
  const records = await Attendance.find({
    employee: { $in: employees.map((u) => u._id) },
    date: today,
  });

  const attendance = employees.map((u) => {
    const record = records.find(
      (r) => r.employee.toString() === u._id.toString()
    );
    return {
      employee: { id: u._id, name: u.name },
      firstPunchIn: record?.firstPunchIn,
      lastPunchOut: record?.lastPunchOut,
      firstPunchInLocation: record?.firstPunchInLocation,
      lastPunchInLocation: record?.lastPunchInLocation,
    };
  });

  res.json({ attendance });
});

function canViewCompanyPresence(req) {
  const isAdmin =
    req.employee?.primaryRole === "ADMIN" ||
    req.employee?.primaryRole === "SUPERADMIN";
  const subOk = (req.employee?.subRoles || []).some((r) =>
    ["hr", "manager"].includes(r)
  );
  const hasPresencePermission =
    !!req.employee?.permissions?.presence?.read ||
    !!req.employee?.permissions?.presence?.write;
  return isAdmin || subOk || hasPresencePermission;
}

router.get("/company/presence", auth, async (req, res) => {
  if (!canViewCompanyPresence(req))
    return res.status(403).json({ error: "Forbidden" });

  const today = startOfDay(new Date());
  const tomorrow = startOfDay(new Date());
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const dayAfterTomorrow = startOfDay(new Date(tomorrow));
  dayAfterTomorrow.setUTCDate(dayAfterTomorrow.getUTCDate() + 1);

  const employees = await Employee.find({
    company: req.employee.company,
    isDeleted: { $ne: true },
  })
    .select("_id name isActive")
    .lean();
  const ids = employees.map((e) => e._id);

  const [records, todayLeaves, tomorrowLeaves, futureLeaves] = await Promise.all([
    Attendance.find({
      employee: { $in: ids },
      date: today,
    }).select(
      "employee firstPunchIn lastPunchOut firstPunchInLocation lastPunchInLocation"
    ),
    Leave.find({
      company: req.employee.company,
      isDeleted: { $ne: true },
      isActive: { $ne: false },
      status: { $in: ["APPROVED", "PENDING"] },
      startDate: { $lte: today },
      endDate: { $gte: today },
    }).select("employee status startDate endDate reason type"),
    Leave.find({
      company: req.employee.company,
      isDeleted: { $ne: true },
      isActive: { $ne: false },
      status: { $in: ["APPROVED", "PENDING"] },
      startDate: { $lt: dayAfterTomorrow },
      endDate: { $gte: tomorrow },
    }).select("employee status startDate endDate reason type"),
    Leave.find({
      company: req.employee.company,
      isDeleted: { $ne: true },
      isActive: { $ne: false },
      status: { $in: ["APPROVED", "PENDING"] },
      startDate: { $gte: tomorrow }, // from tomorrow onward
    }).select("employee status startDate reason type"),
  ]);

  const leaveTodayStatusMap = new Map();
  const leaveTodayReasonMap = new Map();
  for (const l of todayLeaves) {
    leaveTodayStatusMap.set(String(l.employee), l.status || "PENDING");
    leaveTodayReasonMap.set(String(l.employee), {
      reason: l.reason || null,
      type: l.type || null,
    });
  }
  const leaveTomorrowMap = new Map();
  const leaveTomorrowReasonMap = new Map();
  for (const l of tomorrowLeaves) {
    const startKey = startOfDay(l.startDate).getTime();
    if (startKey === tomorrow.getTime()) {
      leaveTomorrowMap.set(String(l.employee), l.status || "PENDING");
      leaveTomorrowReasonMap.set(String(l.employee), {
        reason: l.reason || null,
        type: l.type || null,
      });
    }
  }

  // Nearest upcoming leave after today (in days)
  const futureLeaveMap = new Map();
  for (const l of futureLeaves) {
    const startKey = startOfDay(l.startDate).getTime();
    const daysAway = Math.ceil((startKey - today.getTime()) / 86400000);
    if (daysAway <= 0) continue;
    const key = String(l.employee);
    const current = futureLeaveMap.get(key);
    if (!current || daysAway < current.daysAway) {
      futureLeaveMap.set(key, { daysAway, status: l.status || "PENDING" });
    }
  }

  const rows = employees.map((emp) => {
    const rec = records.find(
      (r) => String(r.employee) === String(emp._id)
    );
    const id = String(emp._id);
    const future = futureLeaveMap.get(id);
    const todayLeave = leaveTodayReasonMap.get(id) || null;
    const tomorrowLeave = leaveTomorrowReasonMap.get(id) || null;
    return {
      employee: { id, name: emp.name },
      firstPunchIn: rec?.firstPunchIn,
      lastPunchOut: rec?.lastPunchOut,
      firstPunchInLocation: rec?.firstPunchInLocation,
      lastPunchInLocation: rec?.lastPunchInLocation,
      onLeaveToday: leaveTodayStatusMap.has(id),
      leaveTodayStatus: leaveTodayStatusMap.get(id) || null,
      leaveTodayReason: todayLeave?.reason || null,
      leaveTodayType: todayLeave?.type || null,
      startingLeaveTomorrow: leaveTomorrowMap.has(id),
      leaveTomorrowStatus: leaveTomorrowMap.get(id) || null,
      leaveTomorrowReason: tomorrowLeave?.reason || null,
      leaveTomorrowType: tomorrowLeave?.type || null,
      nextLeaveInDays: future?.daysAway || null,
      nextLeaveStatus: future?.status || null,
      nextLeaveReason: futureLeaveMap.has(id)
        ? futureLeaves.find(
            (f) =>
              String(f.employee) === id &&
              Math.ceil((startOfDay(f.startDate).getTime() - today.getTime()) / 86400000) ===
                future?.daysAway,
          )?.reason || null
        : null,
      nextLeaveType: futureLeaveMap.has(id)
        ? futureLeaves.find(
            (f) =>
              String(f.employee) === id &&
              Math.ceil((startOfDay(f.startDate).getTime() - today.getTime()) / 86400000) ===
                future?.daysAway,
          )?.type || null
        : null,
      isActive: emp.isActive !== false,
    };
  });

  res.json({
    today: today.toISOString(),
    tomorrow: tomorrow.toISOString(),
    rows,
  });
});

router.get("/company/history", auth, async (req, res) => {
  const allowed =
    ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole) ||
    (req.employee.subRoles || []).some((r) => ["hr", "manager"].includes(r));
  if (!allowed) return res.status(403).json({ error: "Forbidden" });
  const scopeAll = String(req.query.scope || "").toLowerCase() === "all";
  const now = new Date();
  let start;
  let end;
  if (scopeAll) {
    start = startOfDay(new Date(0));
    end = startOfDay(now);
    end.setDate(end.getDate() + 1);
  } else {
    const { month } = req.query;
    if (month) {
      start = startOfDay(new Date(month + "-01"));
    } else {
      start = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
    }
    end = new Date(start);
    end.setMonth(end.getMonth() + 1);
  }

  const employees = await Employee.find({
    company: req.employee.company,
    primaryRole: "EMPLOYEE",
  }).select("_id name");
  const records = await Attendance.find({
    employee: { $in: employees.map((u) => u._id) },
    date: { $gte: start, $lt: end },
  });

  const attendance = records.map((r) => {
    const emp = employees.find(
      (u) => u._id.toString() === r.employee.toString()
    );
    return {
      employee: { id: emp?._id, name: emp?.name },
      date: r.date,
      firstPunchIn: r.firstPunchIn,
      lastPunchOut: r.lastPunchOut,
      workedMs: r.workedMs,
      firstPunchInLocation: r.firstPunchInLocation,
      lastPunchInLocation: r.lastPunchInLocation,
    };
  });

  res.json({ attendance });
});

router.get("/company/report", auth, async (req, res) => {
  const allowed =
    ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole) ||
    (req.employee.subRoles || []).some((r) => ["hr", "manager"].includes(r));
  if (!allowed) return res.status(403).json({ error: "Forbidden" });

  const scopeAll = String(req.query.scope || "").toLowerCase() === "all";
  const { month } = req.query;
  const now = new Date();

  const employees = await Employee.find({
    company: req.employee.company,
    primaryRole: "EMPLOYEE",
  }).select("_id name joiningDate attendanceStartDate");
  let start;
  let end;

  if (scopeAll) {
    let earliest = null;
    for (const emp of employees) {
      const candidate = emp.joiningDate && startOfDay(emp.joiningDate);
      if (!candidate) continue;
      if (!earliest || candidate < earliest) {
        earliest = candidate;
      }
    }
    start =
      earliest ||
      startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
    end = startOfDay(now);
    end.setDate(end.getDate() + 1);
  } else {
    if (month) {
      start = startOfDay(new Date(month + "-01"));
    } else {
      start = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
    }
    end = new Date(start);
    end.setMonth(end.getMonth() + 1);
  }

  const counts = await Attendance.aggregate([
    {
      $match: {
        employee: { $in: employees.map((u) => u._id) },
        date: { $gte: start, $lt: end },
      },
    },
    { $group: { _id: "$employee", workedDays: { $sum: 1 } } },
  ]);
  const countMap = new Map(counts.map((c) => [String(c._id), c.workedDays]));

  const company = await Company.findById(req.employee.company).select(
    "bankHolidays workHours leavePolicy"
  );

  const companyOverrides = await CompanyDayOverride.find({
    company: req.employee.company,
    date: { $gte: start, $lt: end },
    isDeleted: { $ne: true },
    isActive: { $ne: false },
  })
    .select("date type")
    .lean();
  const companyOvByKey = new Map(
    companyOverrides.map((o) => [dateKeyLocal(o.date), o])
  );

  const report = [];
  for (const emp of employees) {
    const employmentStart = emp.joiningDate || null;
    const attendanceStart = getAttendanceStartDate(emp);
    const summary = await buildMonthlyLeaveSummary({
      employeeId: emp._id,
      start,
      end,
      company,
      companyOverridesByKey: companyOvByKey,
      now,
      employmentStart,
      attendanceStart,
    });

    report.push({
      employee: { id: emp._id, name: emp.name },
      workedDays: countMap.get(String(emp._id)) || 0,
      leaveDays: summary.leaveDays,
      halfDayLeaves: summary.halfDayLeaves,
    });
  }

  res.json({ report });
});

router.post("/resolve/leave", auth, async (req, res) => {
  try {
    const { date, endDate, type, reason, employeeId } = req.body || {};
    if (!date) return res.status(400).json({ error: "Missing start date" });

    const targetId = employeeId || req.employee.id;
    const isSelf = String(targetId) === String(req.employee.id);
    const canManageOthers =
      isAdminUser(req.employee) ||
      (req.employee.subRoles || []).some((r) => ["hr", "manager"].includes(r));
    if (!isSelf && !canManageOthers)
      return res.status(403).json({ error: "Forbidden" });

    const start = startOfDay(new Date(date));
    if (isNaN(start.getTime()))
      return res.status(400).json({ error: "Invalid start date" });

    let end = endDate ? startOfDay(new Date(endDate)) : start;
    if (isNaN(end.getTime()))
      return res.status(400).json({ error: "Invalid end date" });
    if (!(end >= start))
      return res
        .status(400)
        .json({ error: "End date must be on or after start date" });

    const employee = await Employee.findById(targetId).select("company");
    if (!employee) return res.status(404).json({ error: "Employee not found" });

    const overlap = await Leave.findOne({
      employee: targetId,
      status: { $in: ["PENDING", "APPROVED"] },
      startDate: { $lte: end },
      endDate: { $gte: start },
    });
    if (overlap)
      return res
        .status(400)
        .json({ error: "Leave already exists overlapping the selected dates" });

    const leave = await Leave.create({
      employee: targetId,
      company: employee.company,
      approver: req.employee.id,
      type: type || "PAID",
      startDate: start,
      endDate: end,
      reason: typeof reason === "string" ? reason : undefined,
      status: "APPROVED",
    });
    res.json({ leave });
  } catch (e) {
    console.error("resolve-leave error", e);
    res.status(500).json({ error: "Failed to apply leave" });
  }
});

// List days in a month where an employee punched in but did not punch out
// GET /attendance/missing-out/:employeeId?  (self or hr/manager/admin)
// Optional query: ?month=yyyy-mm (defaults to current month)
router.get("/missing-out/:employeeId?", auth, async (req, res) => {
  try {
    const targetId = req.params.employeeId || req.employee.id;
    const isSelf = String(targetId) === String(req.employee.id);
    const canViewOthers =
      ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole) ||
      (req.employee.subRoles || []).some((r) => ["hr", "manager"].includes(r));
    if (!isSelf && !canViewOthers)
      return res.status(403).json({ error: "Forbidden" });

    const { month, scope } = req.query; // scope=all to fetch from employment start
    let start;
    let end;
    let employeeDoc = null;

    if (scope === "all") {
      employeeDoc = await Employee.findById(targetId)
        .select("company joiningDate attendanceStartDate")
        .lean();
      const employmentStartRaw = employeeDoc?.joiningDate;
      const employmentStart = employmentStartRaw
        ? startOfDay(employmentStartRaw)
        : startOfDay(new Date());
      const attendanceStart = getAttendanceStartDate(employeeDoc);
      start = attendanceStart || employmentStart;
      end = startOfDay(new Date());
    } else if (month) {
      start = startOfDay(new Date(month + "-01"));
      end = new Date(start);
      end.setMonth(end.getMonth() + 1);
    } else {
      const now = new Date();
      start = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
      end = new Date(start);
      end.setMonth(end.getMonth() + 1);
    }

    const issues = await collectAttendanceIssues({
      employeeId: targetId,
      start,
      endExclusive: end,
      employeeDoc,
    });
    const monthKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`;
    res.json({
      employeeId: String(targetId),
      month: monthKey,
      days: issues.map((i) => i.date),
      issues,
    });
  } catch (e) {
    console.error("missing-out error", e);
    res.status(500).json({ error: "Failed to list missing punch-outs" });
  }
});

// Manually set punch-out time for a specific day (self or admin/hr/manager)
// Body: { date: 'yyyy-mm-dd', time: 'HH:mm' }
router.post("/punchout-at/:employeeId?", auth, async (req, res) => {
  try {
    const targetId = req.params.employeeId || req.employee.id;
    const isSelf = String(targetId) === String(req.employee.id);
    const canEditOthers =
      ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole) ||
      (req.employee.subRoles || []).some((r) => ["hr", "manager"].includes(r));
    if (!isSelf && !canEditOthers)
      return res.status(403).json({ error: "Forbidden" });

    const { date, time } = req.body || {};
    if (!date || !time) return res.status(400).json({ error: "Missing date or time" });

    const day = startOfDay(new Date(date));
    if (isNaN(day.getTime())) return res.status(400).json({ error: "Invalid date" });

    // Compose punch-out timestamp in server-local time on that day
    let out;
    try {
      out = buildUtcDateFromLocal(date, time, extractTimezoneOptions(req.body));
    } catch (parseErr) {
      return res.status(400).json({ error: parseErr?.message || "Invalid time" });
    }

    const nextDay = new Date(day);
    nextDay.setDate(nextDay.getDate() + 1);
    if (!(out >= day && out < nextDay))
      return res.status(400).json({ error: "Time not within selected day" });

    const record = await Attendance.findOne({ employee: targetId, date: day });
    if (!record) return res.status(404).json({ error: "Attendance record not found" });

    const isAuto = !!record.autoPunchOut;
    if (record.lastPunchOut && !isAuto)
      return res.status(400).json({ error: "Already punched out for this day" });

    // Determine the start of the open interval to close. Prefer stored auto punch start,
    // otherwise use the latest punch-in; fall back to the first punch-in if needed.
    const openStart = record.autoPunchLastIn || record.lastPunchIn || record.firstPunchIn;
    if (!openStart)
      return res.status(400).json({ error: "No punch-in found for this day" });

    const lastIn = new Date(openStart);
    if (!(out > lastIn))
      return res
        .status(400)
        .json({ error: "Punch-out must be after last punch-in" });

    let baseWorked = record.workedMs || 0;
    if (isAuto) {
      const priorOut = record.autoPunchOutAt || record.lastPunchOut;
      if (priorOut && priorOut > lastIn) {
        const prevInterval = priorOut.getTime() - lastIn.getTime();
        baseWorked = Math.max(0, baseWorked - prevInterval);
      }
    }

    record.workedMs = baseWorked + (out.getTime() - lastIn.getTime());
    record.lastPunchOut = out;
    record.lastPunchIn = undefined;

    if (isAuto) {
      record.autoPunchOut = false;
      record.autoPunchResolvedAt = new Date();
      record.autoPunchOutAt = out;
      record.autoPunchLastIn = undefined;
    }

    await record.save();

    res.json({ attendance: record });
  } catch (e) {
    console.error("punchout-at error", e);
    res.status(500).json({ error: "Failed to set punch-out time" });
  }
});

// Notify admins that someone needs help editing/adding attendance
router.post("/manual-request", auth, async (req, res) => {
  try {
    const { date, message, employeeId, type, punchIn, punchOut } =
      req.body || {};
    if (!date)
      return res.status(400).json({ error: "Missing date" });

    const normalizedType = typeof type === "string" ? type.trim().toUpperCase() : "";
    const requestType = normalizedType === "ADD" ? "ADD" : "EDIT";

    const targetId = employeeId || req.employee.id;
    const isSelf = String(targetId) === String(req.employee.id);
    const canViewOthers =
      ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole) ||
      (req.employee.subRoles || []).some((r) =>
        ["hr", "manager"].includes(r)
      );
    if (!isSelf && !canViewOthers)
      return res.status(403).json({ error: "Forbidden" });

    const [requester, targetEmployee] = await Promise.all([
      Employee.findById(req.employee.id).select(
        "name email employeeId company primaryRole"
      ),
      Employee.findById(targetId).select(
        "name email employeeId company"
      ),
    ]);

    if (!requester)
      return res.status(404).json({ error: "Requester not found" });
    if (!targetEmployee)
      return res.status(404).json({ error: "Employee not found" });

    if (
      targetEmployee.company &&
      requester.company &&
      String(targetEmployee.company) !== String(requester.company) &&
      !isAdminUser(req.employee)
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const companyId =
      targetEmployee.company ||
      requester.company ||
      req.employee.company;
    if (!companyId)
      return res
        .status(400)
        .json({ error: "Employee is not linked to a company" });

    const tzOptions = extractTimezoneOptions(req.body);
    const validated = validatePunchWindowInput(
      date,
      punchIn,
      punchOut,
      tzOptions
    );
    const day = validated.day;

    const company = await Company.findById(companyId).populate(
      "admin",
      "name email"
    );

    const recipients = new Set();
    if (company?.admin?.email) recipients.add(company.admin.email);

    const admins = await Employee.find({
      company: companyId,
      primaryRole: { $in: ["ADMIN", "SUPERADMIN"] },
    }).select("email");
    for (const admin of admins) {
      if (admin?.email) recipients.add(admin.email);
    }

    const dateStr = dateKeyLocal(day);
    const cleanMessage =
      typeof message === "string" ? message.trim() : "";
    const hasMessage = cleanMessage.length > 0;
    const requestLabel =
      requestType === "ADD" ? "Add missing punches" : "Update punches";

    const payload = {
      company: companyId,
      employee: targetId,
      requestedBy: req.employee.id,
      date: day,
      type: requestType,
      status: "PENDING",
      punchIn: validated.punchIn,
      punchOut: validated.punchOut,
      message: cleanMessage,
      adminMessage: "",
      resolvedAt: null,
      resolvedBy: null,
      timezoneOffsetMinutes:
        validated.timezoneOptions.timezoneOffsetMinutes,
    };

    const existing = await AttendanceRequest.findOne({
      employee: targetId,
      company: companyId,
      date: day,
      status: "PENDING",
    });
    const requestDoc = existing
      ? await AttendanceRequest.findByIdAndUpdate(
          existing._id,
          payload,
          { new: true }
        )
      : await AttendanceRequest.create(payload);

    const formattedMessage = hasMessage
      ? escapeHtml(cleanMessage).replace(/\n/g, "<br/>")
      : null;
    const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;line-height:1.5;">
        <h2 style="margin:0 0 12px;">Attendance Change Request</h2>
        <p><strong>Requester:</strong> ${escapeHtml(
          requester.name || ""
        )} &lt;${escapeHtml(requester.email || "")}&gt;</p>
        <p><strong>For Employee:</strong> ${escapeHtml(
          targetEmployee.name || ""
        )}${
      targetEmployee.employeeId
        ? ` (#${escapeHtml(targetEmployee.employeeId)})`
        : ""
    }</p>
        <p><strong>Date:</strong> ${dateStr}</p>
        <p><strong>Action:</strong> ${requestLabel}</p>
        <p><strong>Requested punch window:</strong> ${validated.punchIn} → ${validated.punchOut}</p>
        ${
          hasMessage
            ? `<p><strong>Message:</strong><br/>${formattedMessage}</p>`
            : `<p>No additional message was provided.</p>`
        }
        <p style="margin-top:16px;color:#666;font-size:12px;">Generated automatically by HRMS.</p>
      </div>`;

    const textLines = [
      `${requester.name} requested ${requestLabel.toLowerCase()} for ${targetEmployee.name} on ${dateStr}.`,
      `Requested punches: ${validated.punchIn} to ${validated.punchOut}`,
    ];
    if (hasMessage) {
      textLines.push(`Message: ${cleanMessage}`);
    }

    let emailSent = false;
    if (await isEmailEnabled(companyId)) {
      if (recipients.size) {
        await sendMail({
          companyId,
          to: Array.from(recipients),
          subject: `Attendance change request — ${targetEmployee.name} (${dateStr})`,
          text: textLines.join("\n\n"),
          html,
        });
        emailSent = true;
      }
    }

    res.json({
      message: emailSent ? "Admin notified" : "Request recorded",
      request: requestDoc,
      emailSent,
    });
  } catch (e) {
    const status = e?.statusCode || 500;
    if (status >= 500) console.error("manual-request error", e);
    res
      .status(status)
      .json({ error: e?.message || "Failed to notify admin" });
  }
});

// Admin/HR/Manager: List manual punch update requests
router.get("/manual-requests", auth, async (req, res) => {
  try {
    if (!canViewManualRequests(req.employee))
      return res.status(403).json({ error: "Forbidden" });

    const { status, type } = req.query || {};
    const normalizedStatus =
      typeof status === "string" ? status.trim().toUpperCase() : "PENDING";
    const normalizedType =
      typeof type === "string" ? type.trim().toUpperCase() : "";

    const query = {};
    if (req.employee.company) query.company = req.employee.company;
    else if (!isAdminUser(req.employee))
      return res.status(400).json({ error: "Company not set for employee" });

    const allowedStatuses = ["PENDING", "APPROVED", "REJECTED"];
    if (normalizedStatus && normalizedStatus !== "ALL") {
      if (allowedStatuses.includes(normalizedStatus))
        query.status = normalizedStatus;
    }

    if (normalizedType && normalizedType !== "ALL") {
      if (["ADD", "EDIT"].includes(normalizedType)) {
        query.type = normalizedType;
      }
    }

    const requests = await AttendanceRequest.find(query)
      .sort({ createdAt: -1 })
      .populate("employee", "name employeeId")
      .populate("requestedBy", "name employeeId");

    res.json({ requests });
  } catch (e) {
    console.error("manual-requests list error", e);
    res
      .status(500)
      .json({ error: "Failed to load attendance change requests" });
  }
});

// Admin/Superadmin: Approve a manual punch update request (applies punches)
router.post("/manual-requests/:id/approve", auth, async (req, res) => {
  try {
    if (!isAdminUser(req.employee))
      return res.status(403).json({ error: "Forbidden" });

    const reqId = req.params.id;
    if (!reqId) return res.status(400).json({ error: "Missing request id" });

    const requestDoc = await AttendanceRequest.findById(reqId);
    if (!requestDoc)
      return res.status(404).json({ error: "Request not found" });
    if (requestDoc.status !== "PENDING")
      return res.status(400).json({ error: "Request is already resolved" });

    if (
      req.employee.company &&
      requestDoc.company &&
      String(requestDoc.company) !== String(req.employee.company) &&
      req.employee.primaryRole !== "SUPERADMIN"
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const timezoneOptions = {
      timezoneOffsetMinutes:
        requestDoc.timezoneOffsetMinutes ??
        extractTimezoneOptions(req.body).timezoneOffsetMinutes,
    };

    const attendance = await applyManualAttendanceWindow({
      employeeId: requestDoc.employee,
      date: requestDoc.date,
      punchIn: requestDoc.punchIn,
      punchOut: requestDoc.punchOut,
      timezoneOptions,
      resolvedBy: req.employee.id,
    });

    requestDoc.status = "APPROVED";
    requestDoc.resolvedBy = req.employee.id;
    requestDoc.resolvedAt = new Date();
    requestDoc.adminMessage =
      typeof req.body?.adminMessage === "string"
        ? req.body.adminMessage.trim()
        : "";

    await requestDoc.save();

    res.json({ request: requestDoc, attendance });
  } catch (e) {
    const status = e?.statusCode || 500;
    if (status >= 500) console.error("manual-request approve error", e);
    res
      .status(status)
      .json({ error: e?.message || "Failed to approve request" });
  }
});

// Admin/Superadmin: Reject a manual punch update request
router.post("/manual-requests/:id/reject", auth, async (req, res) => {
  try {
    if (!isAdminUser(req.employee))
      return res.status(403).json({ error: "Forbidden" });

    const reqId = req.params.id;
    if (!reqId) return res.status(400).json({ error: "Missing request id" });

    const requestDoc = await AttendanceRequest.findById(reqId);
    if (!requestDoc)
      return res.status(404).json({ error: "Request not found" });
    if (requestDoc.status !== "PENDING")
      return res.status(400).json({ error: "Request is already resolved" });

    if (
      req.employee.company &&
      requestDoc.company &&
      String(requestDoc.company) !== String(req.employee.company) &&
      req.employee.primaryRole !== "SUPERADMIN"
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }

    requestDoc.status = "REJECTED";
    requestDoc.resolvedBy = req.employee.id;
    requestDoc.resolvedAt = new Date();
    requestDoc.adminMessage =
      typeof req.body?.adminMessage === "string"
        ? req.body.adminMessage.trim()
        : "";

    await requestDoc.save();

    res.json({ request: requestDoc });
  } catch (e) {
    const status = e?.statusCode || 500;
    if (status >= 500) console.error("manual-request reject error", e);
    res
      .status(status)
      .json({ error: e?.message || "Failed to reject request" });
  }
});

// Admin/Superadmin: Manually adjust punch-in/punch-out window for a day
// Body: { date: 'yyyy-mm-dd', firstIn: 'HH:mm', lastOut: 'HH:mm', timezoneOffsetMinutes?: number }
router.post("/manual/:employeeId", auth, async (req, res) => {
  try {
    const canEdit = isAdminUser(req.employee);
    if (!canEdit) return res.status(403).json({ error: "Forbidden" });

    const targetId = req.params.employeeId;
    if (!targetId) return res.status(400).json({ error: "Missing employeeId" });

    const { date, firstIn, lastOut } = req.body || {};
    if (!date) return res.status(400).json({ error: "Missing date" });
    if (!firstIn || !lastOut)
      return res
        .status(400)
        .json({ error: "Both punch-in and punch-out times are required" });

    const day = startOfDay(new Date(date));
    if (Number.isNaN(day.getTime()))
      return res.status(400).json({ error: "Invalid date" });

    let record = await Attendance.findOne({ employee: targetId, date: day });

    const tzOptions = extractTimezoneOptions(req.body);
    let punchIn;
    let punchOut;
    try {
      punchIn = buildUtcDateFromLocal(date, firstIn, tzOptions);
    } catch (err) {
      return res
        .status(400)
        .json({ error: err?.message || "Invalid punch-in time" });
    }
    try {
      punchOut = buildUtcDateFromLocal(date, lastOut, tzOptions);
    } catch (err) {
      return res
        .status(400)
        .json({ error: err?.message || "Invalid punch-out time" });
    }

    const nextDay = new Date(day);
    nextDay.setDate(nextDay.getDate() + 1);
    if (!(punchIn >= day && punchIn < nextDay))
      return res
        .status(400)
        .json({ error: "Punch-in must fall within the selected day" });
    if (!(punchOut >= day && punchOut < nextDay))
      return res
        .status(400)
        .json({ error: "Punch-out must fall within the selected day" });

    if (!(punchOut > punchIn))
      return res
        .status(400)
        .json({ error: "Punch-out must be after punch-in" });

    const MAX_SPAN_MS = 16 * 60 * 60 * 1000;
    const windowMs = Math.min(
      MAX_SPAN_MS,
      Math.max(0, punchOut.getTime() - punchIn.getTime())
    );

    if (!record) {
      record = await Attendance.create({
        employee: targetId,
        date: day,
        firstPunchIn: punchIn,
        lastPunchIn: undefined,
        lastPunchOut: punchOut,
        workedMs: windowMs,
      });
      await resolveAutoLeavePenaltyForDay(targetId, day, req.employee.id);
      return res.json({ attendance: record });
    }

    record.firstPunchIn = punchIn;
    record.lastPunchOut = punchOut;
    record.lastPunchIn = undefined;
    record.workedMs = windowMs;

    if (record.autoPunchOut) {
      record.autoPunchOut = false;
      record.autoPunchResolvedAt = new Date();
      record.autoPunchOutAt = punchOut;
      record.autoPunchLastIn = undefined;
    }

    if (record.manualFillRequest) {
      record.manualFillRequest.status = "COMPLETED";
      record.manualFillRequest.resolvedAt = new Date();
      record.manualFillRequest.resolvedBy = req.employee.id;
    }

    await record.save();
    await resolveAutoLeavePenaltyForDay(targetId, day, req.employee.id);

    res.json({ attendance: record });
  } catch (e) {
    console.error("manual attendance update error", e);
    res.status(500).json({ error: "Failed to update attendance window" });
  }
});

// Admin/HR/Manager: Trigger auto-punchout job immediately (for testing or recovery)
router.post("/admin/auto-punchout/run", auth, async (req, res) => {
  try {
    const canRun =
      ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole) ||
      (req.employee.subRoles || []).some((r) => ["hr", "manager"].includes(r));
    if (!canRun) return res.status(403).json({ error: "Forbidden" });

    const result = await runAutoPunchOut();
    res.json({ ok: true, result });
  } catch (e) {
    console.error("auto-punchout run error", e);
    res.status(500).json({ error: "Failed to run auto-punchout" });
  }
});

// Admin/HR: Resolve an auto-applied leave for missing attendance (e.g., punch-in existed)
router.post("/admin/auto-leave/resolve", auth, async (req, res) => {
  try {
    const canManage =
      ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole) ||
      (req.employee.subRoles || []).includes("hr");
    if (!canManage) return res.status(403).json({ error: "Forbidden" });

    const { employeeId, date } = req.body || {};
    if (!employeeId || !date)
      return res.status(400).json({ error: "employeeId and date are required" });

    const day = startOfDay(date);
    if (Number.isNaN(day.getTime()))
      return res.status(400).json({ error: "Invalid date" });

    await resolveAutoLeavePenaltyForDay(employeeId, day, req.employee.id);
    res.json({ ok: true });
  } catch (e) {
    console.error("resolve auto leave error", e);
    res.status(500).json({ error: "Failed to resolve auto-applied leave" });
  }
});

// Admin/HR: Resolve all auto-applied leaves for a specific date across the company
router.post("/admin/auto-leave/bulk-resolve", auth, async (req, res) => {
  try {
    const canManage =
      ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole) ||
      (req.employee.subRoles || []).includes("hr");
    if (!canManage) return res.status(403).json({ error: "Forbidden" });

    const { date } = req.body || {};
    if (!date) return res.status(400).json({ error: "date is required" });
    const day = startOfDay(new Date(date));
    if (Number.isNaN(day.getTime()))
      return res.status(400).json({ error: "Invalid date" });

    const companyId = req.employee.company;
    if (!companyId)
      return res
        .status(400)
        .json({ error: "Company not found for the admin account" });

    const nextDay = new Date(day);
    nextDay.setDate(nextDay.getDate() + 1);

    const penalties = await AttendancePenalty.find({
      company: companyId,
      date: { $gte: day, $lt: nextDay },
      resolvedAt: null,
    })
      .select("employee date")
      .lean();

    let resolved = 0;
    let failed = 0;
    for (const p of penalties) {
      try {
        await resolveAutoLeavePenaltyForDay(
          p.employee,
          p.date ? startOfDay(p.date) : day,
          req.employee.id
        );
        resolved += 1;
      } catch (err) {
        failed += 1;
        console.error(
          "[auto-leave bulk resolve] failed",
          p?.employee,
          err?.message || err
        );
      }
    }

    const leavesRes = await Leave.deleteMany({
      company: companyId,
      startDate: { $gte: day, $lt: nextDay },
      endDate: { $gte: day, $lt: nextDay },
      isAuto: true,
    });

    res.json({
      message: "Auto-applied leaves resolved for the selected date",
      ok: true,
      date: day.toISOString().slice(0, 10),
      penaltiesFound: penalties.length,
      resolved,
      failed,
      autoLeavesDeleted: leavesRes?.deletedCount || 0,
    });
  } catch (e) {
    console.error("bulk resolve auto leave error", e);
    res.status(500).json({ error: "Failed to resolve auto-applied leaves" });
  }
});

// Admin/HR/Manager: Upsert per-day overrides (ignore half-day/late/holiday)
// Body: { date: 'yyyy-mm-dd', ignoreHalfDay?: boolean, ignoreLate?: boolean, ignoreHoliday?: boolean, reason?: string }
router.post("/overrides/:employeeId", auth, async (req, res) => {
  try {
    const canEdit =
      ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole) ||
      (req.employee.subRoles || []).some((r) => ["hr", "manager"].includes(r));
    if (!canEdit) return res.status(403).json({ error: "Forbidden" });

    const targetId = req.params.employeeId;
    const { date, ignoreHalfDay, ignoreLate, ignoreHoliday, reason } = req.body || {};
    if (!targetId) return res.status(400).json({ error: "Missing employeeId" });
    if (!date) return res.status(400).json({ error: "Missing date" });
    const day = startOfDay(new Date(date));
    if (isNaN(day.getTime())) return res.status(400).json({ error: "Invalid date" });

    const update = { updatedBy: req.employee.id };
    if (typeof ignoreHalfDay === 'boolean') update.ignoreHalfDay = !!ignoreHalfDay;
    if (typeof ignoreLate === 'boolean') update.ignoreLate = !!ignoreLate;
    if (typeof ignoreHoliday === 'boolean') update.ignoreHoliday = !!ignoreHoliday;
    if (typeof reason === 'string') update.reason = reason;

    const override = await AttendanceOverride.findOneAndUpdate(
      { employee: targetId, date: day },
      { $setOnInsert: { employee: targetId, date: day }, $set: update },
      { upsert: true, new: true }
    );
    res.json({ override });
  } catch (e) {
    console.error("override upsert error", e);
    res.status(500).json({ error: "Failed to save override" });
  }
});

router.collectAttendanceIssues = collectAttendanceIssues;

module.exports = router;
