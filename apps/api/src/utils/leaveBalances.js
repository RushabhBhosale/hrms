const Company = require('../models/Company');

async function syncLeaveBalances(employee) {
  if (!employee) return;
  const balances = employee.leaveBalances || {};
  const isZero = ['casual', 'paid', 'sick', 'unpaid'].every(
    (k) => !balances[k] || balances[k] === 0
  );
  if (!isZero) return;
  const company = await Company.findById(employee.company).select('leavePolicy');
  const policy = company?.leavePolicy || {};
  employee.leaveBalances = {
    casual: policy.casual || 0,
    paid: policy.paid || 0,
    unpaid: balances.unpaid || 0,
    sick: policy.sick || 0,
  };
  await employee.save();
}

module.exports = { syncLeaveBalances };
