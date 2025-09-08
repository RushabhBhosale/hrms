const router = require('express').Router();
const bcrypt = require('bcryptjs');
const Employee = require('../models/Employee');
const Company = require('../models/Company');
const Attendance = require('../models/Attendance');
const Project = require('../models/Project');
const Task = require('../models/Task');
const Leave = require('../models/Leave');
const Announcement = require('../models/Announcement');
const { isValidEmail, isValidPassword } = require('../utils/validate');

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function minutesBetween(a, b) {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
}

function addMonths(d, n) {
  const x = new Date(d);
  const m = x.getMonth();
  x.setMonth(m + n);
  return x;
}

router.post('/superadmin', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !isValidEmail(email) || !isValidPassword(password)) {
    return res.status(400).json({ error: 'Invalid name, email, or password' });
  }
  const exists = await Employee.findOne({ email });
  if (exists) return res.json({ ok: true });
  const passwordHash = await bcrypt.hash(password, 10);
  await Employee.create({ name, email, passwordHash, primaryRole: 'SUPERADMIN', subRoles: [] });
  res.json({ ok: true });
});

module.exports = router;

// Seed a full dummy company with data for testing
// POST /seed/dummy?key=YOUR_SEED_KEY (optional guard)
// Body options:
// { reset: boolean } -> if true, will delete previously seeded company and its related docs
router.post('/dummy', async (req, res) => {
  try {
    const guardKey = process.env.SEED_KEY;
    if (guardKey) {
      if (req.query.key !== guardKey) {
        return res.status(403).json({ error: 'Forbidden (invalid seed key)' });
      }
    }

    const reset = !!req.body?.reset;
    const companyName = 'Acme Corporation';

    // If reset requested, remove previously seeded data for the company (scoped deletions)
    if (reset) {
      const existing = await Company.findOne({ name: companyName }).lean();
      if (existing?._id) {
        const cid = existing._id;
        const existingEmployees = await Employee.find({ company: cid })
          .select('_id')
          .lean();
        const empIds = existingEmployees.map((e) => e._id);
        const existingProjects = await Project.find({ company: cid })
          .select('_id')
          .lean();
        const projIds = existingProjects.map((p) => p._id);
        await Promise.all([
          Attendance.deleteMany({ employee: { $in: empIds } }),
          Task.deleteMany({ project: { $in: projIds } }),
          Project.deleteMany({ company: cid }),
          Leave.deleteMany({ company: cid }),
          Announcement.deleteMany({ company: cid }),
          Employee.deleteMany({ company: cid }),
        ]);
        await Company.deleteOne({ _id: cid });
      }
    }

    let company = await Company.findOne({ name: companyName });
    if (company) {
      // If already exists, short-circuit and return a summary of seeded users
      const people = await Employee.find({ company: company._id })
        .select('name email primaryRole subRoles')
        .lean();
      return res.json({
        ok: true,
        message: 'Company already seeded',
        company: { id: company._id, name: company.name },
        users: people,
      });
    }

    // Parse scale options
    const months = Math.max(1, parseInt(req.query.months || req.body?.months || 1, 10) || 1);
    const projectsTarget = Math.max(2, parseInt(req.query.projects || req.body?.projects || (months >= 3 ? 12 : 2), 10) || (months >= 3 ? 12 : 2));
    const tasksPerProject = Math.max(1, parseInt(req.query.tasksPerProject || req.body?.tasksPerProject || (months >= 3 ? 15 : 3), 10) || (months >= 3 ? 15 : 3));

    // Create admin + employees
    const defaultPassword = 'password123';
    const passwordHash = await bcrypt.hash(defaultPassword, 10);

    // Create company first (admin will be linked after creating the admin employee)
    company = await Company.create({
      name: companyName,
      roles: ['hr', 'manager', 'developer', 'designer', 'qa'],
      status: 'approved',
      leavePolicy: {
        totalAnnual: 24,
        ratePerMonth: 2,
        typeCaps: { paid: 12, casual: 8, sick: 4 },
      },
      workHours: { start: '09:30', end: '18:30', graceMinutes: 10 },
      bankHolidays: [
        { date: addDays(startOfDay(new Date()), 10), name: 'Founders Day' },
      ],
    });

    const admin = await Employee.create({
      name: 'Alice Admin',
      email: 'admin@acme.test',
      passwordHash,
      primaryRole: 'ADMIN',
      subRoles: ['hr', 'manager'],
      company: company._id,
      employeeId: 'ACME-ADM-001',
      ctc: 150000,
    });

    // Link admin on company
    company.admin = admin._id;
    await company.save();

    // A few managers and ICs
    const peopleSpec = [
      { name: 'Henry HR', email: 'henry.hr@acme.test', roles: ['hr'], primaryRole: 'EMPLOYEE', id: 'ACME-HR-002', ctc: 70000 },
      { name: 'Mark Manager', email: 'mark.mgr@acme.test', roles: ['manager'], primaryRole: 'EMPLOYEE', id: 'ACME-MGR-003', ctc: 120000 },
      { name: 'Diana Dev', email: 'diana.dev@acme.test', roles: ['developer'], primaryRole: 'EMPLOYEE', id: 'ACME-DEV-004', ctc: 90000 },
      { name: 'Evan Eng', email: 'evan.dev@acme.test', roles: ['developer'], primaryRole: 'EMPLOYEE', id: 'ACME-DEV-005', ctc: 85000 },
      { name: 'Quinn QA', email: 'quinn.qa@acme.test', roles: ['qa'], primaryRole: 'EMPLOYEE', id: 'ACME-QA-006', ctc: 80000 },
      { name: 'Desi Designer', email: 'desi.dsg@acme.test', roles: ['designer'], primaryRole: 'EMPLOYEE', id: 'ACME-DSG-007', ctc: 82000 },
    ];

    const employees = await Promise.all(
      peopleSpec.map((p) =>
        Employee.create({
          name: p.name,
          email: p.email,
          passwordHash,
          primaryRole: p.primaryRole,
          subRoles: p.roles,
          company: company._id,
          reportingPerson: p.roles.includes('developer') ? admin._id : undefined,
          employeeId: p.id,
          ctc: p.ctc,
          totalLeaveAvailable: 24,
          leaveBalances: { paid: 12, casual: 8, sick: 4, unpaid: 0 },
        })
      )
    );

    const allEmployees = [admin, ...employees];

    // Projects
    const teamLead = employees.find((e) => (e.subRoles || []).includes('manager')) || admin;
    const devs = employees.filter((e) => (e.subRoles || []).includes('developer'));
    const qa = employees.find((e) => (e.subRoles || []).includes('qa'));
    const dsg = employees.find((e) => (e.subRoles || []).includes('designer'));

    // Create projects (2 for light, N for extensive)
    function projectTitle(idx) {
      const names = [
        'NextGen HR Portal',
        'Mobile Attendance App',
        'Payroll Engine',
        'Onboarding Wizard',
        'Leave Balancer',
        'Timesheet Reporter',
        'API Gateway',
        'Design System',
        'QA Automation Suite',
        'Performance Dashboard',
        'Notification Service',
        'Document Manager',
        'Recruitment Tracker',
        'Company Wiki',
        'Analytics ETL',
      ];
      return names[idx % names.length] + (idx >= names.length ? ` #${idx + 1}` : '');
    }

    const projects = [];
    for (let i = 0; i < projectsTarget; i++) {
      const lead = i % 3 === 0 ? admin : (teamLead || admin);
      const members = [
        ...devs.map((d) => d._id),
        qa?._id,
        dsg?._id,
      ].filter(Boolean);
      const p = await Project.create({
        title: projectTitle(i),
        description: 'Seeded project for demo/testing',
        techStack: i % 2 === 0 ? ['react', 'node', 'mongodb'] : ['react-native', 'node'],
        teamLead: lead._id,
        members,
        company: company._id,
        estimatedTimeMinutes: 60 * (200 + (i * 20)),
        startTime: addDays(new Date(), -Math.min(30 * months, 90) + (i * 2)),
      });
      projects.push(p);
    }

    // Tasks + time logs
    async function makeTask(project, title, assignee, creator, opts = {}) {
      const task = await Task.create({
        project: project._id,
        title,
        description: opts.description || '',
        assignedTo: assignee._id,
        createdBy: creator._id,
        status: opts.status || 'INPROGRESS',
        priority: opts.priority || 'SECOND',
        estimatedTimeMinutes: opts.estimatedTimeMinutes || 120,
      });
      // Add a couple of day-spread time logs in the last 10 days
      const now = new Date();
      const logDays = [8, 5, 2];
      let total = 0;
      for (const d of logDays) {
        const when = addDays(startOfDay(now), -d);
        const minutes = 60 + Math.floor(Math.random() * 120);
        total += minutes;
        task.timeLogs.push({ minutes, note: 'Work log', addedBy: assignee._id, createdAt: addDays(when, 0) });
      }
      task.timeSpentMinutes = total;
      await task.save();
      return task;
    }

    // Create tasks for each project
    const allTasks = [];
    for (const [pi, project] of projects.entries()) {
      const pool = [admin, teamLead, ...devs.filter(Boolean), qa, dsg].filter(Boolean);
      for (let j = 0; j < tasksPerProject; j++) {
        const assignee = pool[(j + pi) % pool.length] || admin;
        const creator = pool[(j + 1 + pi) % pool.length] || admin;
        const task = await makeTask(project, `Task ${j + 1} for ${project.title}`, assignee, creator, {
          priority: ['URGENT', 'FIRST', 'SECOND', 'LEAST'][j % 4],
          estimatedTimeMinutes: 90 + ((j % 5) * 30),
        });
        // Add extra time logs for extensive mode
        const extraLogs = Math.min(5, 2 + Math.floor(months));
        for (let k = 0; k < extraLogs; k++) {
          const when = addDays(startOfDay(new Date()), -(pi + j + k + 1));
          const minutes = 30 + Math.floor(Math.random() * 90);
          task.timeLogs.push({ minutes, note: 'Additional work log', addedBy: assignee._id, createdAt: when });
          task.timeSpentMinutes += minutes;
        }
        await task.save();
        allTasks.push(task);
      }
    }

    // Attendance for past N complete months (weekdays only)
    // Example for months=3 on Sept 8: generates June 1..Aug 31
    const today = startOfDay(new Date());
    const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const start = new Date(currentMonthStart);
    start.setMonth(start.getMonth() - months);
    const endExclusive = currentMonthStart; // do not include current month days
    const workday = (d) => {
      const day = d.getDay(); // 0 Sun, 6 Sat
      return day !== 0 && day !== 6;
    };
    const attendanceDocs = [];
    for (const emp of allEmployees) {
      for (let cursor = new Date(start); cursor < endExclusive; cursor = addDays(cursor, 1)) {
        const day = startOfDay(cursor);
        if (!workday(day)) continue;
        // Randomly mark some absences (~10%)
        if (Math.random() < 0.1) continue;

        const inH = 9 + Math.floor(Math.random() * 2); // 9 or 10
        const inM = Math.floor(Math.random() * 30); // 0-29
        const outH = 18 + Math.floor(Math.random() * 2); // 18 or 19
        const outM = Math.floor(Math.random() * 30);
        const firstPunchIn = new Date(day);
        firstPunchIn.setHours(inH, inM, 0, 0);
        const lastPunchOut = new Date(day);
        lastPunchOut.setHours(outH, outM, 0, 0);

        attendanceDocs.push({
          employee: emp._id,
          date: day,
          firstPunchIn,
          lastPunchOut,
          lastPunchIn: firstPunchIn,
          workedMs: minutesBetween(firstPunchIn, lastPunchOut) * 60000,
          autoPunchOut: false,
        });
      }
    }
    if (attendanceDocs.length) await Attendance.insertMany(attendanceDocs);

    // Leaves: create a few approved/pending/rejected
    // Leaves: generate a handful per employee over the period
    const leaveTypes = ['PAID', 'CASUAL', 'SICK'];
    for (const emp of allEmployees) {
      const count = 2 + Math.floor(Math.random() * (months + 1));
      for (let i = 0; i < count; i++) {
        const offset = 5 + Math.floor(Math.random() * Math.max(10, months * 30));
        const startAt = addDays(today, -offset);
        const len = 1 + Math.floor(Math.random() * 2);
        const endAt = addDays(startAt, len - 1);
        const type = leaveTypes[(i + emp.name.length) % leaveTypes.length];
        const statuses = ['APPROVED', 'PENDING', 'REJECTED'];
        const status = statuses[(i + emp.email.length) % statuses.length];
        await Leave.create({
          employee: emp._id,
          company: company._id,
          approver: admin._id,
          type,
          startDate: startAt,
          endDate: endAt,
          reason: 'Seeded leave',
          status,
          allocations: {
            paid: type === 'PAID' ? len : 0,
            casual: type === 'CASUAL' ? len : 0,
            sick: type === 'SICK' ? len : 0,
            unpaid: 0,
          },
        });
      }
    }

    // Announcements
    await Announcement.create({
      company: company._id,
      title: 'Welcome to Acme!',
      message: 'This environment is pre-seeded with dummy data for demos.',
      createdBy: admin._id,
      expiresAt: addDays(today, 30),
    });
    await Announcement.create({
      company: company._id,
      title: 'Quarterly Town Hall',
      message: 'Join us this Friday 4pm for roadmap and Q&A.',
      createdBy: admin._id,
      expiresAt: addDays(today, 7),
    });
    if (months >= 3) {
      await Announcement.create({
        company: company._id,
        title: 'New Projects Launched',
        message: 'Multiple new initiatives kicked off for this quarter.',
        createdBy: admin._id,
        expiresAt: addDays(today, 60),
      });
    }

    // Respond with a helpful summary
    res.json({
      ok: true,
      message: 'Dummy company and data seeded',
      company: { id: company._id, name: company.name },
      users: allEmployees.map((u) => ({ name: u.name, email: u.email, primaryRole: u.primaryRole, subRoles: u.subRoles })),
      credentials: { password: defaultPassword },
      projects: projects.map((p) => ({ id: p._id, title: p.title })),
      tasks: allTasks.slice(0, 10).map((t) => t.title),
      notes: 'Login with any seeded email + the password above.'
    });
  } catch (e) {
    console.error('[seed/dummy] failed:', e);
    res.status(500).json({ error: 'Failed to seed dummy data' });
  }
});
