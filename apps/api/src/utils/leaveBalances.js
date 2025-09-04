const Company = require('../models/Company');

function ym(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function monthsDiff(startYm, endYm) {
  const [sy, sm] = startYm.split('-').map((x) => parseInt(x, 10));
  const [ey, em] = endYm.split('-').map((x) => parseInt(x, 10));
  return (ey - sy) * 12 + (em - sm);
}

// Accrue monthly total leaves for the employee
async function accrueTotalIfNeeded(employee, company, asOfDate = new Date()) {
  if (!employee || !company) return;
  const policy = company.leavePolicy || {};
  const rate = Number(policy.ratePerMonth) || 0;
  const annual = Number(policy.totalAnnual) || 0;
  if (rate <= 0 || annual <= 0) return;

  const asOfYm = ym(asOfDate);
  const lastYm = employee.leaveAccrual?.lastAccruedYearMonth || ym(employee.createdAt || new Date());
  const delta = monthsDiff(lastYm, asOfYm);
  if (delta <= 0) return;

  if (!employee.leaveUsage) employee.leaveUsage = { paid: 0, casual: 0, sick: 0, unpaid: 0 };
  const used = (employee.leaveUsage.paid || 0) + (employee.leaveUsage.casual || 0) + (employee.leaveUsage.sick || 0);
  const current = Number(employee.totalLeaveAvailable) || 0;
  const capLeft = Math.max(0, annual - used - current);
  const add = Math.max(0, Math.min(rate * delta, capLeft));
  employee.totalLeaveAvailable = current + add;
  employee.leaveAccrual = employee.leaveAccrual || {};
  employee.leaveAccrual.lastAccruedYearMonth = asOfYm;
  await employee.save();
}

// Populate legacy employee.leaveBalances for UI using total and type caps
async function syncLeaveBalances(employee) {
  if (!employee) return;
  const company = await Company.findById(employee.company).select('leavePolicy');
  await accrueTotalIfNeeded(employee, company, new Date());
  const policy = company?.leavePolicy || {};
  const caps = policy.typeCaps || {};
  const used = employee.leaveUsage || { paid: 0, casual: 0, sick: 0, unpaid: 0 };
  const totalAvail = Math.max(0, Number(employee.totalLeaveAvailable) || 0);
  // Expose remaining caps per type (not limited by shared total). Clients can combine with totalAvail.
  const paidAvail = Math.max(0, (Number(caps.paid) || 0) - (Number(used.paid) || 0));
  const casualAvail = Math.max(0, (Number(caps.casual) || 0) - (Number(used.casual) || 0));
  const sickAvail = Math.max(0, (Number(caps.sick) || 0) - (Number(used.sick) || 0));
  employee.leaveBalances = {
    paid: paidAvail,
    casual: casualAvail,
    sick: sickAvail,
    unpaid: Number(used.unpaid) || 0,
  };
  await employee.save();
}

module.exports = { syncLeaveBalances, accrueTotalIfNeeded };
