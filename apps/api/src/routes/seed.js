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

    // If reset requested, remove previously seeded data for the company
    if (reset) {
      const existing = await Company.findOne({ name: companyName }).lean();
      if (existing?._id) {
        const cid = existing._id;
        await Promise.all([
          Employee.deleteMany({ company: cid }),
          Attendance.deleteMany({}),
          Project.deleteMany({ company: cid }),
          Task.deleteMany({}),
          Leave.deleteMany({ company: cid }),
          Announcement.deleteMany({ company: cid }),
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

    const proj1 = await Project.create({
      title: 'NextGen HR Portal',
      description: 'Revamp the HR portal with modern UI and workflows',
      techStack: ['react', 'node', 'mongodb'],
      teamLead: teamLead._id,
      members: [
        ...devs.map((d) => d._id),
        qa?._id,
        dsg?._id,
      ].filter(Boolean),
      company: company._id,
      estimatedTimeMinutes: 60 * 400,
      startTime: addDays(new Date(), -40),
    });

    const proj2 = await Project.create({
      title: 'Mobile Attendance App',
      description: 'Lightweight mobile app for punch-in/out and leave',
      techStack: ['react-native', 'node'],
      teamLead: admin._id,
      members: [teamLead._id, ...devs.map((d) => d._id)].filter(Boolean),
      company: company._id,
      estimatedTimeMinutes: 60 * 250,
      startTime: addDays(new Date(), -25),
    });

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

    const t1 = await makeTask(
      proj1,
      'Build authentication flow',
      devs[0] || admin,
      teamLead,
      { priority: 'URGENT', estimatedTimeMinutes: 240 }
    );
    const t2 = await makeTask(
      proj1,
      'Design dashboard widgets',
      dsg || admin,
      teamLead,
      { priority: 'FIRST', estimatedTimeMinutes: 180 }
    );
    const t3 = await makeTask(
      proj2,
      'Implement offline punch support',
      devs[1] || admin,
      admin,
      { priority: 'SECOND', estimatedTimeMinutes: 300 }
    );

    // Attendance for past 30 days (weekdays only)
    const today = startOfDay(new Date());
    const start = addDays(today, -30);
    const workday = (d) => {
      const day = d.getDay(); // 0 Sun, 6 Sat
      return day !== 0 && day !== 6;
    };
    const attendanceDocs = [];
    for (const emp of allEmployees) {
      for (let i = 0; i < 30; i++) {
        const day = addDays(start, i);
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
    const sampleLeaves = [
      {
        who: devs[0] || admin,
        type: 'PAID',
        start: addDays(today, -12),
        end: addDays(today, -11),
        status: 'APPROVED',
      },
      {
        who: qa || admin,
        type: 'CASUAL',
        start: addDays(today, -6),
        end: addDays(today, -6),
        status: 'PENDING',
      },
      {
        who: dsg || admin,
        type: 'SICK',
        start: addDays(today, -18),
        end: addDays(today, -17),
        status: 'REJECTED',
      },
    ];
    for (const l of sampleLeaves) {
      await Leave.create({
        employee: l.who._id,
        company: company._id,
        approver: admin._id,
        type: l.type,
        startDate: l.start,
        endDate: l.end,
        reason: 'Personal',
        status: l.status,
        allocations: { paid: l.type === 'PAID' ? 1 : 0, casual: l.type === 'CASUAL' ? 1 : 0, sick: l.type === 'SICK' ? 1 : 0, unpaid: 0 },
      });
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

    // Respond with a helpful summary
    res.json({
      ok: true,
      message: 'Dummy company and data seeded',
      company: { id: company._id, name: company.name },
      users: allEmployees.map((u) => ({ name: u.name, email: u.email, primaryRole: u.primaryRole, subRoles: u.subRoles })),
      credentials: { password: defaultPassword },
      projects: [
        { id: proj1._id, title: proj1.title },
        { id: proj2._id, title: proj2.title },
      ],
      tasks: [t1.title, t2.title, t3.title],
      notes: 'Login with any seeded email + the password above.'
    });
  } catch (e) {
    console.error('[seed/dummy] failed:', e);
    res.status(500).json({ error: 'Failed to seed dummy data' });
  }
});
