const router = require('express').Router();
const mongoose = require('mongoose');
const { auth } = require('../middleware/auth');
const Invoice = require('../models/Invoice');
const Expense = require('../models/Expense');

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfYear(date) {
  return new Date(date.getFullYear(), 0, 1);
}

router.use(auth);

function canViewFinance(employee) {
  if (!employee) return false;
  const primary = employee.primaryRole;
  if (primary === 'ADMIN' || primary === 'SUPERADMIN') return true;
  return (employee.subRoles || []).includes('hr');
}

router.get('/dashboard', async (req, res) => {
  try {
    if (!canViewFinance(req.employee)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const companyIdStr = String(req.employee.company || '').trim();
    if (!mongoose.Types.ObjectId.isValid(companyIdStr)) {
      return res.status(400).json({ error: 'Invalid company id' });
    }
    const companyId = new mongoose.Types.ObjectId(companyIdStr);
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const monthStart = startOfMonth(now);
    const yearStart = startOfYear(now);
    const lookAhead = endOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30));

    const [invoiceAgg] = await Invoice.aggregate([
      { $match: { company: companyId } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' },
          paidAmount: {
            $sum: {
              $cond: [{ $eq: ['$status', 'paid'] }, '$totalAmount', 0],
            },
          },
          outstandingAmount: {
            $sum: {
              $cond: [
                {
                  $in: [
                    '$status',
                    ['pending', 'sent', 'overdue'],
                  ],
                },
                '$totalAmount',
                0,
              ],
            },
          },
          overdueAmount: {
            $sum: {
              $cond: [{ $eq: ['$status', 'overdue'] }, '$totalAmount', 0],
            },
          },
        },
      },
    ]);

    const upcomingInvoiceSummaryAgg = await Invoice.aggregate([
      {
        $match: {
          company: companyId,
          dueDate: { $gte: todayStart, $lte: lookAhead },
          status: { $in: ['pending', 'sent', 'overdue'] },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$totalAmount' },
          count: { $sum: 1 },
        },
      },
    ]);

    const expenseBaseMatch = { company: companyId };

    const [expenseAgg] = await Expense.aggregate([
      { $match: expenseBaseMatch },
      {
        $group: {
          _id: null,
          totalCount: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          recurringAmount: {
            $sum: {
              $cond: [{ $eq: ['$isRecurring', true] }, '$amount', 0],
            },
          },
          recurringCount: {
            $sum: { $cond: [{ $eq: ['$isRecurring', true] }, 1, 0] },
          },
        },
      },
    ]);

    const [expenseMonthAgg] = await Expense.aggregate([
      {
        $match: {
          ...expenseBaseMatch,
          date: { $gte: monthStart, $lte: todayEnd },
        },
      },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: '$amount' },
        },
      },
    ]);

    const [expenseYearAgg] = await Expense.aggregate([
      {
        $match: {
          ...expenseBaseMatch,
          date: { $gte: yearStart, $lte: todayEnd },
        },
      },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: '$amount' },
        },
      },
    ]);

    const upcomingRecurringRaw = await Expense.find({
      company: companyId,
      isRecurring: true,
      'recurring.nextDueDate': { $gte: todayStart, $lte: lookAhead },
    })
      .sort({ 'recurring.nextDueDate': 1, date: -1 })
      .limit(25)
      .lean();

    const upcomingRecurring = upcomingRecurringRaw.map((e) => ({
      id: String(e._id),
      category: e.categoryName,
      nextDueDate: e.recurring?.nextDueDate || null,
      frequency: e.recurring?.frequency || null,
      amount: e.amount,
      lastPaidOn: e.date,
      status:
        e.recurring?.nextDueDate && e.recurring.nextDueDate <= todayEnd
          ? 'pending'
          : 'paid',
    }));

    const upcomingRecurringSeriesAgg = await Expense.aggregate([
      {
        $match: {
          company: companyId,
          isRecurring: true,
          'recurring.nextDueDate': { $gte: todayStart, $lte: lookAhead },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$recurring.nextDueDate' },
          },
          total: { $sum: '$amount' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const spendBreakdownAgg = await Expense.aggregate([
      { $match: expenseBaseMatch },
      {
        $group: {
          _id: '$isRecurring',
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
    ]);

    const monthsBack = 6;
    const trendStart = new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1), 1);
    const recurringTrendAgg = await Expense.aggregate([
      {
        $match: {
          company: companyId,
          isRecurring: true,
          date: { $gte: trendStart },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: '$date' },
            month: { $month: '$date' },
          },
          total: { $sum: '$amount' },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    const months = [];
    for (let i = 0; i < monthsBack; i += 1) {
      const d = new Date(trendStart.getFullYear(), trendStart.getMonth() + i, 1);
      months.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        total: 0,
      });
    }
    recurringTrendAgg.forEach((row) => {
      const key = `${row._id.year}-${String(row._id.month).padStart(2, '0')}`;
      const target = months.find((m) => m.key === key);
      if (target) target.total = Math.round((row.total || 0) * 100) / 100;
    });

    const spendBreakdown = spendBreakdownAgg.reduce(
      (acc, row) => {
        if (row._id) {
          acc.recurring.amount += row.total || 0;
          acc.recurring.count += row.count || 0;
        } else {
          acc.oneTime.amount += row.total || 0;
          acc.oneTime.count += row.count || 0;
        }
        return acc;
      },
      {
        recurring: { amount: 0, count: 0 },
        oneTime: { amount: 0, count: 0 },
      }
    );

    const invoiceSummary = {
      count: invoiceAgg?.count || 0,
      totalAmount: Math.round((invoiceAgg?.totalAmount || 0) * 100) / 100,
      paidAmount: Math.round((invoiceAgg?.paidAmount || 0) * 100) / 100,
      outstandingAmount:
        Math.round((invoiceAgg?.outstandingAmount || 0) * 100) / 100,
      overdueAmount: Math.round((invoiceAgg?.overdueAmount || 0) * 100) / 100,
      upcomingDueAmount:
        Math.round(((upcomingInvoiceSummaryAgg?.[0]?.total || 0) * 100)) / 100,
      upcomingDueCount: upcomingInvoiceSummaryAgg?.[0]?.count || 0,
    };

    const expenseSummary = {
      totalCount: expenseAgg?.totalCount || 0,
      totalAmount: Math.round((expenseAgg?.totalAmount || 0) * 100) / 100,
      monthToDateAmount:
        Math.round((expenseMonthAgg?.totalAmount || 0) * 100) / 100,
      yearToDateAmount:
        Math.round((expenseYearAgg?.totalAmount || 0) * 100) / 100,
      recurringCount: expenseAgg?.recurringCount || 0,
      recurringAmount:
        Math.round((expenseAgg?.recurringAmount || 0) * 100) / 100,
    };

    res.json({
      invoiceSummary,
      expenseSummary,
      upcomingRecurring,
      upcomingRecurringSeries: upcomingRecurringSeriesAgg.map((row) => ({
        date: row._id,
        total: Math.round((row.total || 0) * 100) / 100,
      })),
      spendBreakdown: {
        recurring: {
          amount: Math.round(spendBreakdown.recurring.amount * 100) / 100,
          count: spendBreakdown.recurring.count,
        },
        oneTime: {
          amount: Math.round(spendBreakdown.oneTime.amount * 100) / 100,
          count: spendBreakdown.oneTime.count,
        },
      },
      recurringTrend: months,
    });
  } catch (err) {
    console.error('finance dashboard err', err);
    res.status(500).json({ error: 'Failed to load finance overview' });
  }
});

module.exports = router;
