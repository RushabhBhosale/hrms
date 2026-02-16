const router = require("express").Router();
const { auth } = require("../middleware/auth");
const { requirePrimary } = require("../middleware/roles");
const Project = require("../models/Project");
const Task = require("../models/Task");
const Employee = require("../models/Employee");
const Notification = require("../models/Notification");
const { sendMail, isEmailEnabled } = require("../utils/mailer");
const Attendance = require("../models/Attendance");
const Client = require("../models/Client");
const { parseWithSchema } = require("../utils/zod");
const { projectSchema } = require("../../../libs/schemas/project");
const mongoose = require("mongoose");

function sendSuccess(res, message, payload = {}) {
  if (message) res.set("X-Success-Message", message);
  return res.json({ message, ...payload });
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfMonth(d) {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfMonth(d) {
  const x = startOfMonth(d);
  x.setMonth(x.getMonth() + 1);
  return x;
}

function monthRange(month) {
  const now = new Date();
  let start = startOfMonth(now);
  if (typeof month === "string" && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1, 1));
    if (!isNaN(d.getTime())) start = d;
  }
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  return { start, end, monthKey: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}` };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isAdmin(emp) {
  return ["ADMIN", "SUPERADMIN"].includes(emp.primaryRole);
}

function canCreateTasks(emp) {
  if (isAdmin(emp)) return true;
  return !!emp?.permissions?.tasks?.write;
}

function canViewProject(emp, project) {
  const hr = (emp.subRoles || []).includes("hr");
  const member =
    String(project.teamLead) === String(emp.id) ||
    (project.members || []).map((m) => String(m)).includes(String(emp.id));
  // Company-wide personal projects: visible to any employee in the same company
  const personal =
    project.isPersonal && String(project.company) === String(emp.company);
  return isAdmin(emp) || hr || member || personal;
}

function isProjectMember(emp, project) {
  // Company-wide personal projects: treat every employee in the company as a member
  if (project.isPersonal && String(project.company) === String(emp.company)) {
    return true;
  }
  return (
    String(project.teamLead) === String(emp.id) ||
    (project.members || []).map((m) => String(m)).includes(String(emp.id))
  );
}

async function loadParentTask({ projectId, parentTaskId }) {
  if (!parentTaskId) return null;
  if (!mongoose.Types.ObjectId.isValid(parentTaskId)) return null;
  const parent = await Task.findOne({
    _id: parentTaskId,
    project: projectId,
    parentTask: { $in: [null, undefined] }, // only allow one level
    isDeleted: { $ne: true },
    isActive: { $ne: false },
  }).lean();
  return parent || null;
}

async function taskHasChildren(taskId) {
  if (!mongoose.Types.ObjectId.isValid(taskId)) return false;
  const child = await Task.exists({
    parentTask: taskId,
    isDeleted: { $ne: true },
    isActive: { $ne: false },
  });
  return !!child;
}

async function ensureLeafForTimeLogs(task, res) {
  if (!task?._id) return true;
  const hasKids = await taskHasChildren(task._id);
  if (hasKids) {
    res
      .status(400)
      .json({ error: "This task has subtasks. Log time on a subtask instead." });
    return false;
  }
  return true;
}

async function ensureMeetingTask(project, requestedBy) {
  if (!project?._id) return null;
  const assignees = Array.from(
    new Set(
      [project.teamLead, ...(project.members || [])]
        .map((id) => String(id || "").trim())
        .filter(Boolean)
    )
  );
  if (!assignees.length) return null;
  const createdBy = requestedBy || project.teamLead || assignees[0];

  let meetingTask = await Task.findOne({
    project: project._id,
    isMeetingDefault: true,
  });

  if (!meetingTask) {
    meetingTask = await Task.create({
      project: project._id,
      title: "Meetings",
      description: "Default meeting time log task",
      assignedTo: assignees,
      createdBy,
      priority: "SECOND",
      status: "PENDING",
      isMeetingDefault: true,
      isDeleted: false,
      isActive: true,
    });
    return meetingTask;
  }

  const mergedAssignees = Array.from(
    new Set([
      ...(Array.isArray(meetingTask.assignedTo)
        ? meetingTask.assignedTo.map((a) => String(a))
        : []),
      ...assignees,
    ])
  );
  meetingTask.assignedTo = mergedAssignees;
  meetingTask.isDeleted = false;
  meetingTask.isActive = true;
  if (!meetingTask.title) meetingTask.title = "Meetings";
  if (!meetingTask.createdBy) meetingTask.createdBy = createdBy;
  await meetingTask.save();
  return meetingTask;
}

function isProjectLive(project) {
  if (!project) return false;
  if (project.isDeleted === true) return false;
  if (project.isActive === false) return false;
  // Legacy flag kept for backward compatibility
  if (project.active === false) return false;
  return true;
}

async function checkMonthlyCap(project, targetDate, minutesToAdd, opts = {}) {
  const limit = project?.monthlyEstimateMinutes || 0;
  if (!limit || limit <= 0) return { ok: true };
  const start = startOfMonth(targetDate);
  const end = endOfMonth(targetDate);

  const tasks = await Task.find({
    project: project._id,
    timeLogs: { $elemMatch: { createdAt: { $gte: start, $lt: end } } },
  })
    .select("timeLogs")
    .lean();

  const used = tasks.reduce((acc, t) => {
    const mins = (t.timeLogs || [])
      .filter((l) => {
        if (opts.excludeLogId && String(l._id) === String(opts.excludeLogId))
          return false;
        return l.createdAt >= start && l.createdAt < end;
      })
      .reduce((s, l) => s + (l.minutes || 0), 0);
    return acc + mins;
  }, 0);
  const remaining = Math.max(0, limit - used);
  if (minutesToAdd > remaining) {
    return { ok: false, used, remaining, limit };
  }
  return { ok: true, used, remaining, limit };
}

// Get or create a single personal project for the company (company-wide)
router.get("/personal", auth, async (req, res) => {
  try {
    let project = await Project.findOne({
      company: req.employee.company,
      isPersonal: true,
      isDeleted: { $ne: true },
      isActive: { $ne: false },
    });
    if (!project) {
      // Prefer assigning the company-wide personal project to an admin
      let lead = await Employee.findOne({
        company: req.employee.company,
        primaryRole: { $in: ["ADMIN", "SUPERADMIN"] },
      })
        .select("_id")
        .lean();
      const teamLeadId = lead?._id || req.employee.id;
      project = await Project.create({
        title: "Personal Tasks",
        description: "Personal tasks not linked to any project",
        techStack: [],
        teamLead: teamLeadId,
        members: [],
        company: req.employee.company,
        isPersonal: true,
      });
    }
    res.json({ project });
  } catch (e) {
    res.status(500).json({ error: "Failed to load personal project" });
  }
});

function canManageProjects(emp) {
  if (!emp) return false;
  if (isAdmin(emp)) return true;
  return (emp.subRoles || []).includes("hr");
}

// Create project - admin or HR
router.post("/", auth, async (req, res) => {
  try {
    if (!canManageProjects(req.employee))
      return res.status(403).json({ error: "Forbidden" });

    const computeEstimatedMinutes = () => {
      if (req.body.estimatedTimeMinutes !== undefined) {
        const m = parseInt(req.body.estimatedTimeMinutes, 10);
        if (Number.isFinite(m) && m >= 0) return m;
      }
      if (
        req.body.estimatedHours !== undefined ||
        req.body.estimatedTimeHours !== undefined
      ) {
        const source =
          req.body.estimatedHours !== undefined
            ? req.body.estimatedHours
            : req.body.estimatedTimeHours;
        const hours = parseFloat(String(source));
        if (Number.isFinite(hours) && hours >= 0) return Math.round(hours * 60);
      }
      return 0;
    };

    const computeMonthlyEstimateMinutes = () => {
      if (req.body.monthlyEstimateMinutes !== undefined) {
        const m = parseInt(req.body.monthlyEstimateMinutes, 10);
        if (Number.isFinite(m) && m >= 0) return m;
      }
      if (req.body.monthlyEstimateHours !== undefined) {
        const hours = parseFloat(String(req.body.monthlyEstimateHours));
        if (Number.isFinite(hours) && hours >= 0)
          return Math.round(hours * 60);
      }
      return 0;
    };

    const parseStartTime = () => {
      const value = req.body.startTime;
      if (value === undefined || value === null) return undefined;
      const trimmed = String(value).trim();
      if (!trimmed) return undefined;
      const date = new Date(trimmed);
      return Number.isNaN(date.getTime()) ? undefined : date;
    };

    const normalizeMembers = (input) => {
      if (!Array.isArray(input)) return [];
      return input
        .map((member) => {
          if (member && typeof member === "object") {
            if (member._id) return String(member._id);
            return "";
          }
          return String(member ?? "").trim();
        })
        .filter(Boolean);
    };

    const normalizeTechStack = (input) => {
      if (Array.isArray(input)) {
        return input.map((item) => String(item || "").trim()).filter(Boolean);
      }
      if (typeof input === "string") {
        return input
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
      }
      return [];
    };

    const normalizeClient = (input) => {
      if (input === undefined || input === null) return undefined;
      if (typeof input === "object") {
        if (input._id) return String(input._id).trim();
        return undefined;
      }
      const s = String(input).trim();
      return s || undefined;
    };

    const teamLeadId = (() => {
      const raw = req.body?.teamLead;
      if (raw && typeof raw === "object") {
        if (raw._id) return String(raw._id);
        return "";
      }
      if (raw === undefined || raw === null) return "";
      return String(raw).trim();
    })();

    const startTime = parseStartTime();
    const clientId = normalizeClient(req.body?.client);

    const validation = parseWithSchema(projectSchema, {
      title:
        typeof req.body?.title === "string"
          ? req.body.title.trim()
          : req.body?.title,
      description: req.body?.description,
      techStack: normalizeTechStack(req.body?.techStack),
      teamLead: teamLeadId,
      members: normalizeMembers(req.body?.members),
      company: String(req.employee.company),
      client: clientId,
      estimatedTimeMinutes: computeEstimatedMinutes(),
      monthlyEstimateMinutes: computeMonthlyEstimateMinutes(),
      ...(startTime ? { startTime } : {}),
    });

    if (!validation.ok) {
      return res
        .status(400)
        .json({ error: "Invalid project data", details: validation.issues });
    }

    if (clientId) {
      const client = await Client.findOne({
        _id: clientId,
        company: req.employee.company,
        isDeleted: { $ne: true },
      })
        .select("_id")
        .lean();
      if (!client) return res.status(400).json({ error: "Invalid client" });
    }

    const projectData = validation.data;
    const project = await Project.create(projectData);
    await ensureMeetingTask(project, req.employee.id);
    sendSuccess(res, "Project created", { project });

    // Fire-and-forget in-app notification to team lead and members
    (async () => {
      try {
        const ids = [
          projectData.teamLead,
          ...(Array.isArray(projectData.members) ? projectData.members : []),
        ]
          .map((x) => String(x))
          .filter(Boolean);
        const recipients = Array.from(new Set(ids)).filter(
          (id) => id !== String(req.employee.id)
        );
        if (!recipients.length) return;
        await Notification.insertMany(
          recipients.map((employeeId) => ({
            company: project.company,
            employee: employeeId,
            type: "PROJECT_ASSIGNED",
            title: `Assigned to Project: ${projectData.title}`,
            message: `You were added to the project “${projectData.title}”.`,
            link: `/projects/${project._id}`,
            meta: { projectId: String(project._id) },
          }))
        );
      } catch (e) {
        console.warn(
          "[projects] Failed to create project notifications:",
          e?.message || e
        );
      }
    })();

    // Fire-and-forget email notification to team lead and members
    (async () => {
      try {
        const companyId = req.employee.company;
        if (!(await isEmailEnabled(companyId))) return;
        const ids = [
          projectData.teamLead,
          ...(Array.isArray(projectData.members) ? projectData.members : []),
        ]
          .map((x) => String(x))
          .filter((x) => x && x.length >= 12);
        if (!ids.length) return;
        const people = await Employee.find({ _id: { $in: ids } })
          .select("name email")
          .lean();
        const to = Array.from(
          new Set(people.map((p) => p?.email).filter(Boolean))
        );
        if (!to.length) return;
        const sub = `Assigned to Project: ${projectData.title}`;
        const safeDesc = projectData.description
          ? String(projectData.description).replace(/</g, "&lt;")
          : "";
        const html = `
          <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height:1.5;">
            <h2 style="margin:0 0 12px;">You've been added to a project</h2>
            <p><strong>Project:</strong> ${projectData.title}</p>
            ${
              safeDesc ? `<p><strong>Description:</strong> ${safeDesc}</p>` : ""
            }
            <p><strong>Assigned By:</strong> ${
              req.employee.name || "Administrator"
            }</p>
            <p style="margin-top:16px; color:#666; font-size:12px;">This is an automated notification from HRMS.</p>
          </div>
        `;
        await sendMail({
          companyId,
          to,
          subject: sub,
          html,
          text: `You have been added to project: ${projectData.title}`,
          skipInAppNotification: true,
        });
      } catch (e) {
        console.warn(
          "[projects] Failed to send project assignment email:",
          e?.message || e
        );
      }
    })();
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Backfill: create/update default meeting tasks for all active projects in the company
router.post("/seed/meetings", auth, async (req, res) => {
  // Allow admin/superadmin or HR/manager subroles to seed
  const isPrimaryAdmin = ["ADMIN", "SUPERADMIN"].includes(
    req.employee.primaryRole || "",
  );
  const subRoles = req.employee.subRoles || [];
  const isHrOrManager = subRoles.includes("hr") || subRoles.includes("manager");
  if (!(isPrimaryAdmin || isHrOrManager)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    const projects = await Project.find({
      company: req.employee.company,
      isDeleted: { $ne: true },
      isActive: { $ne: false },
    }).select("_id teamLead members isDeleted isActive");
    let createdOrUpdated = 0;
    for (const project of projects) {
      const mt = await ensureMeetingTask(project, req.employee.id);
      if (mt) createdOrUpdated += 1;
    }
    sendSuccess(res, "Meeting tasks synced", {
      projectsProcessed: projects.length,
      meetingTasksEnsured: createdOrUpdated,
    });
  } catch (e) {
    res.status(500).json({ error: "Failed to seed meeting tasks" });
  }
});

// List projects visible to the user
router.get("/", auth, async (req, res) => {
  const isAdminUser = isAdmin(req.employee);
  const isHr = (req.employee.subRoles || []).includes("hr");
  const softFilter = { isDeleted: { $ne: true }, isActive: { $ne: false } };
  // Allow all employees to see active company projects (for reimbursement dropdowns, task selection, etc.)
  const query = { company: req.employee.company, ...softFilter };
  if (req.query.active === "true") {
    // Treat missing active as active=true for backward compatibility
    const clause = { $or: [{ active: true }, { active: { $exists: false } }] };
    if (query.$and) query.$and.push(clause);
    else query.$and = [clause];
  }
  if (req.query.active === "false") query.active = false;
  const projects = await Project.find(query).lean();
  res.json({ projects });
});

// Assigned tasks for current user across company projects
// Must be declared before parameterized routes like "/:id"
router.get("/tasks", auth, async (req, res) => {
  try {
    let companyId = req.employee.company;
    // Admins might not have company set; fall back to the company they administer
    if (
      !companyId &&
      ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole || "")
    ) {
      const company = await require("../models/Company")
        .findOne({ admin: req.employee.id })
        .select("_id")
        .lean();
      if (company) companyId = company._id;
    }
    if (!companyId) return res.json({ tasks: [] });

    const projectId = req.query.projectId ? String(req.query.projectId) : null;
    const employeeId = req.query.employeeId
      ? String(req.query.employeeId)
      : null;
    const statusRaw = req.query.status ? String(req.query.status) : null;
    const searchRaw = req.query.search ? String(req.query.search) : "";

    const isFiniteInt = (v) => Number.isFinite(v) && v > 0;
    const includeChildren =
      String(req.query.includeChildren || "").toLowerCase() === "true";
    const limit =
      req.query.limit !== undefined ? parseInt(req.query.limit, 10) : undefined;
    const page = req.query.page !== undefined ? parseInt(req.query.page, 10) : 1;
    const usePaging = includeChildren ? false : isFiniteInt(limit);

    const normalizedStatus = statusRaw
      ? statusRaw.trim().toUpperCase()
      : null;
    const includeLogs =
      String(req.query.includeLogs || "").toLowerCase() === "true";
    if (
      normalizedStatus &&
      !["PENDING", "INPROGRESS", "DONE"].includes(normalizedStatus)
    ) {
      return res.status(400).json({ error: "Invalid status" });
    }

    // Ensure projectId belongs to the same company (prevents cross-company leakage)
    let allowedProjectIds = null;
    let leadProjectIds = [];
    if (projectId) {
      const p = await Project.findOne({
        _id: projectId,
        company: companyId,
        isDeleted: { $ne: true },
        isActive: { $ne: false },
      })
        .select("_id teamLead")
        .lean();
      if (!p) return res.status(404).json({ error: "Project not found" });
      allowedProjectIds = [p._id];
      if (String(p.teamLead) === String(req.employee.id))
        leadProjectIds = [p._id];
    } else {
      const projs = await Project.find({
        company: companyId,
        isDeleted: { $ne: true },
        isActive: { $ne: false },
      })
        .select("_id teamLead")
        .lean();
      allowedProjectIds = projs.map((p) => p._id);
      leadProjectIds = projs
        .filter((p) => String(p.teamLead) === String(req.employee.id))
        .map((p) => p._id);
    }

    const baseQuery = {
      project: { $in: allowedProjectIds },
      isDeleted: { $ne: true },
      isActive: { $ne: false },
    };
    const isHr = (req.employee.subRoles || []).includes("hr");
    const isAdminUser = isAdmin(req.employee);
    let query = baseQuery;
    if (!(isAdminUser || isHr)) {
      // Team leads see all tasks in their projects; others see only tasks assigned to them
      const ors = [];
      if (leadProjectIds.length) ors.push({ project: { $in: leadProjectIds } });
      ors.push({ assignedTo: req.employee.id });
      query = { ...baseQuery, $or: ors };
    }
    if (employeeId && employeeId !== "ALL") {
      query = { ...query, assignedTo: employeeId };
    }
    if (normalizedStatus) {
      query = { ...query, status: normalizedStatus };
    }
    const queryBeforeSearch = { ...query };
    const searchValue = searchRaw.trim();
    if (searchValue) {
      const escaped = escapeRegExp(searchValue);
      const regex = new RegExp(escaped, "i");
      const childSearchOr = [{ title: regex }, { description: regex }];
      const parentIds =
        (await Task.distinct("parentTask", {
          $and: [
            queryBeforeSearch,
            { parentTask: { $ne: null } },
            { $or: childSearchOr },
          ],
        })) || [];
      const clauseOr = [...childSearchOr];
      const filteredParentIds = parentIds.filter(Boolean);
      if (filteredParentIds.length) {
        clauseOr.push({ _id: { $in: filteredParentIds } });
      }
      const clause = { $or: clauseOr };
      const existingAnd = Array.isArray(query.$and) ? [...query.$and] : [];
      query = { ...query, $and: [...existingAnd, clause] };
    }

    const sort = { updatedAt: -1 };
    const populateOpts = [
      { path: "project", select: "title" },
      ...(includeLogs
        ? [{ path: "timeLogs.addedBy", select: "name" }]
        : []),
    ];

    if (usePaging) {
      const lim = Math.max(1, Math.min(200, limit));
      const pg = !Number.isFinite(page) || page < 1 ? 1 : page;
      const total = await Task.countDocuments(query);
      const tasks = await Task.find(query)
        .sort(sort)
        .skip((pg - 1) * lim)
        .limit(lim)
        .select(includeLogs ? undefined : "-timeLogs")
        .populate(populateOpts)
        .lean();
      const normalizedTasks = includeLogs
        ? tasks.map((t) => ({
            ...t,
            timeLogs: (t.timeLogs || [])
              .slice(-5)
              .reverse()
              .map((l) => ({
                _id: l._id,
                minutes: l.minutes,
                note: l.note,
                createdAt: l.createdAt,
                addedBy: l.addedBy?._id || l.addedBy,
                addedByName: l.addedBy?.name,
              })),
          }))
        : tasks;
      const pages = Math.max(1, Math.ceil(total / lim));
      return res.json({
        tasks: normalizedTasks,
        total,
        page: pg,
        pages,
        limit: lim,
      });
    }

    const tasks = await Task.find(query)
      .sort(sort)
      .select(includeLogs ? undefined : "-timeLogs")
      .populate(populateOpts)
      .lean();
    const normalizedTasks = includeLogs
      ? tasks.map((t) => ({
          ...t,
          timeLogs: (t.timeLogs || [])
            .slice(-5)
            .reverse()
            .map((l) => ({
              _id: l._id,
              minutes: l.minutes,
              note: l.note,
              createdAt: l.createdAt,
              addedBy: l.addedBy?._id || l.addedBy,
              addedByName: l.addedBy?.name,
            })),
        }))
      : tasks;
    res.json({
      tasks: normalizedTasks,
      total: tasks.length,
      page: 1,
      pages: 1,
      limit: tasks.length,
    });
  } catch (e) {
    res.status(500).json({ error: "Failed to load tasks" });
  }
});

router.get("/tasks/assigned", auth, async (req, res) => {
  try {
    const targetId = String(req.query.employeeId || req.employee.id);
    const isSelf = targetId === String(req.employee.id);
    const isHr = (req.employee.subRoles || []).includes("hr");
    const isManager = (req.employee.subRoles || []).includes("manager");
    const isAdminUser = isAdmin(req.employee);
    if (!isSelf && !(isAdminUser || isHr || isManager))
      return res.status(403).json({ error: "Forbidden" });

    const targetEmployee = await Employee.findById(targetId)
      .select("company")
      .lean();
    if (!targetEmployee)
      return res.status(404).json({ error: "Employee not found" });
    if (String(targetEmployee.company) !== String(req.employee.company))
      return res.status(403).json({ error: "Forbidden" });

    // Limit to tasks within the same company
    const projects = await Project.find({ company: targetEmployee.company })
      .select("_id")
      .lean();
    const projectIds = projects.map((p) => p._id);
    const tasks = await Task.find({
      project: { $in: projectIds },
      assignedTo: targetId,
    })
      .populate("project", "title")
      .lean();
    res.json({ tasks });
  } catch (e) {
    res.status(500).json({ error: "Failed to load assigned tasks" });
  }
});

// Tasks worked on by an employee for a given day across company projects
// Query params: employeeId (optional, defaults to current user), date (ISO or yyyy-mm-dd, optional defaults to today)
router.get("/tasks/worked", auth, async (req, res) => {
  try {
    const isHr = (req.employee.subRoles || []).includes("hr");
    const isManager = (req.employee.subRoles || []).includes("manager");
    const isAdminUser = isAdmin(req.employee);

    const employeeId = String(req.query.employeeId || req.employee.id);
    // Authorization: allow self, or admin/hr/manager
    const isSelf = String(employeeId) === String(req.employee.id);
    if (!isSelf && !(isAdminUser || isHr || isManager)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Parse date
    let d = req.query.date ? new Date(req.query.date) : new Date();
    if (isNaN(d.getTime()))
      return res.status(400).json({ error: "Invalid date" });
    const start = new Date(d);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    // Limit to tasks within the same company
    const projects = await Project.find({ company: req.employee.company })
      .select("_id title")
      .lean();
    const projectIds = projects.map((p) => p._id);

    // Find tasks that have time logs for the employee within [start, end)
    const rawTasks = await Task.find({
      project: { $in: projectIds },
      timeLogs: {
        $elemMatch: {
          addedBy: employeeId,
          createdAt: { $gte: start, $lt: end },
        },
      },
    })
      .populate("project", "title")
      .select("title status timeLogs project")
      .lean();

    // Reduce logs to the selected day and compute minutes per task
    const tasks = rawTasks.map((t) => {
      const dayLogs = (t.timeLogs || []).filter(
        (l) =>
          String(l.addedBy) === String(employeeId) &&
          l.createdAt >= start &&
          l.createdAt < end
      );
      const minutes = dayLogs.reduce((acc, l) => acc + (l.minutes || 0), 0);
      return {
        _id: t._id,
        title: t.title,
        status: t.status,
        project: t.project
          ? { _id: t.project._id, title: t.project.title }
          : null,
        minutes,
        logs: dayLogs.map((l) => ({
          _id: l._id,
          minutes: l.minutes,
          note: l.note,
          createdAt: l.createdAt,
          addedBy: l.addedBy,
        })),
      };
    });

    res.json({ tasks });
  } catch (e) {
    res.status(500).json({ error: "Failed to load worked tasks" });
  }
});

// Get single project
router.get("/:id", auth, async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ error: "Not found" });
  if (!canViewProject(req.employee, project))
    return res.status(403).json({ error: "Forbidden" });
  res.json({ project });
});

// Total time summary for a project (minutes)
// For privileged users (admin/hr/manager): aggregates across all tasks in the project
// For regular members: aggregates only tasks assigned to the current user
router.get("/:id/time-summary", auth, async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ error: "Not found" });

  const match = {
    project: project._id,
    isDeleted: { $ne: true },
    isActive: { $ne: false },
  };

  try {
    const employeeId = new mongoose.Types.ObjectId(req.employee.id);
    const [totalAgg, selfAgg] = await Promise.all([
      Task.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            total: { $sum: { $ifNull: ["$timeSpentMinutes", 0] } },
          },
        },
      ]),
      Task.aggregate([
        { $match: match },
        { $unwind: "$timeLogs" },
        { $match: { "timeLogs.addedBy": employeeId } },
        {
          $group: {
            _id: null,
            total: { $sum: { $ifNull: ["$timeLogs.minutes", 0] } },
          },
        },
      ]),
    ]);
    const total = totalAgg?.[0]?.total || 0;
    const userTotal = selfAgg?.[0]?.total || 0;
    res.json({
      totalTimeSpentMinutes: total,
      userTimeSpentMinutes: userTotal,
    });
  } catch (e) {
    res.status(500).json({ error: "Failed to compute time summary" });
  }
});

// Admin/HR: Time logs grouped by employee for a month (across company projects)
router.get(
  "/reports/time/by-employee",
  auth,
  requirePrimary(["ADMIN", "SUPERADMIN"]),
  async (req, res) => {
    try {
      const companyId = req.employee.company;
      if (!companyId)
        return res.status(400).json({ error: "Company not found" });
      const { start, end, monthKey } = monthRange(req.query.month);
      const employeeFilter = String(req.query.employees || "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => mongoose.Types.ObjectId.isValid(s))
        .map((s) => new mongoose.Types.ObjectId(s));

      const pipeline = [
        { $match: { isDeleted: { $ne: true }, isActive: { $ne: false } } },
        {
          $lookup: {
            from: "projects",
            localField: "project",
            foreignField: "_id",
            as: "project",
          },
        },
        { $unwind: "$project" },
        { $match: { "project.company": new mongoose.Types.ObjectId(companyId) } },
        { $unwind: "$timeLogs" },
        {
          $match: {
            "timeLogs.createdAt": { $gte: start, $lt: end },
            ...(employeeFilter.length
              ? { "timeLogs.addedBy": { $in: employeeFilter } }
              : {}),
          },
        },
        {
          $group: {
            _id: {
              employee: "$timeLogs.addedBy",
              project: "$project._id",
              projectTitle: "$project.title",
              taskId: "$_id",
              taskTitle: "$title",
            },
            minutes: { $sum: { $ifNull: ["$timeLogs.minutes", 0] } },
          },
        },
        {
          $group: {
            _id: {
              employee: "$_id.employee",
              project: "$_id.project",
              projectTitle: "$_id.projectTitle",
            },
            projectMinutes: { $sum: "$minutes" },
            projects: {
              $push: {
                taskId: "$_id.taskId",
                taskTitle: "$_id.taskTitle",
                minutes: "$minutes",
              },
            },
          },
        },
        {
          $group: {
            _id: "$_id.employee",
            totalMinutes: { $sum: "$projectMinutes" },
            projects: {
              $push: {
                projectId: "$_id.project",
                projectTitle: "$_id.projectTitle",
                minutes: "$projectMinutes",
                tasks: "$projects",
              },
            },
          },
        },
        {
          $lookup: {
            from: "employees",
            localField: "_id",
            foreignField: "_id",
            as: "emp",
          },
        },
        { $unwind: { path: "$emp", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 0,
            employeeId: "$_id",
            name: "$emp.name",
            email: "$emp.email",
            totalMinutes: 1,
            projects: 1,
          },
        },
        { $sort: { name: 1 } },
      ];

      const rows = await Task.aggregate(pipeline);
      res.json({ month: monthKey, rows });
    } catch (e) {
      console.error("time report by employee error", e);
      res.status(500).json({ error: "Failed to load time report" });
    }
  }
);

// Admin/HR: Time logs grouped by project for a month (across company projects)
router.get(
  "/reports/time/by-project",
  auth,
  requirePrimary(["ADMIN", "SUPERADMIN"]),
  async (req, res) => {
    try {
      const companyId = req.employee.company;
      if (!companyId)
        return res.status(400).json({ error: "Company not found" });
      const { start, end, monthKey } = monthRange(req.query.month);
      const employeeFilter = String(req.query.employees || "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => mongoose.Types.ObjectId.isValid(s))
        .map((s) => new mongoose.Types.ObjectId(s));

      const pipeline = [
        { $match: { isDeleted: { $ne: true }, isActive: { $ne: false } } },
        {
          $lookup: {
            from: "projects",
            localField: "project",
            foreignField: "_id",
            as: "project",
          },
        },
        { $unwind: "$project" },
        { $match: { "project.company": new mongoose.Types.ObjectId(companyId) } },
        { $unwind: "$timeLogs" },
        {
          $match: {
            "timeLogs.createdAt": { $gte: start, $lt: end },
            ...(employeeFilter.length
              ? { "timeLogs.addedBy": { $in: employeeFilter } }
              : {}),
          },
        },
        {
          $group: {
            _id: {
              project: "$project._id",
              projectTitle: "$project.title",
              employee: "$timeLogs.addedBy",
              taskId: "$_id",
              taskTitle: "$title",
            },
            minutes: { $sum: { $ifNull: ["$timeLogs.minutes", 0] } },
          },
        },
        {
          $group: {
            _id: { project: "$_id.project", projectTitle: "$_id.projectTitle" },
            contributors: {
              $push: {
                employeeId: "$_id.employee",
                minutes: "$minutes",
                taskId: "$_id.taskId",
                taskTitle: "$_id.taskTitle",
              },
            },
            totalMinutes: { $sum: "$minutes" },
          },
        },
        {
          $lookup: {
            from: "employees",
            localField: "contributors.employeeId",
            foreignField: "_id",
            as: "people",
          },
        },
        { $unwind: "$contributors" },
        {
          $group: {
            _id: {
              project: "$_id.project",
              projectTitle: "$_id.projectTitle",
              employee: "$contributors.employeeId",
            },
            totalMinutes: { $first: "$totalMinutes" },
            people: { $first: "$people" },
            tasks: {
              $push: {
                taskId: "$contributors.taskId",
                taskTitle: "$contributors.taskTitle",
                minutes: "$contributors.minutes",
              },
            },
            contributorMinutes: { $sum: "$contributors.minutes" },
          },
        },
        {
          $group: {
            _id: { project: "$_id.project", projectTitle: "$_id.projectTitle" },
            totalMinutes: { $first: "$totalMinutes" },
            contributors: {
              $push: {
                employeeId: "$_id.employee",
                minutes: "$contributorMinutes",
                tasks: "$tasks",
              },
            },
            people: { $first: "$people" },
          },
        },
        {
          $project: {
            _id: 0,
            projectId: "$_id.project",
            title: "$_id.projectTitle",
            totalMinutes: 1,
            contributors: {
              $map: {
                input: "$contributors",
                as: "c",
                in: {
                  employeeId: "$$c.employeeId",
                  minutes: "$$c.minutes",
                  tasks: "$$c.tasks",
                  name: {
                    $let: {
                      vars: {
                        p: {
                          $first: {
                            $filter: {
                              input: "$people",
                              as: "p",
                              cond: { $eq: ["$$p._id", "$$c.employeeId"] },
                            },
                          },
                        },
                      },
                      in: "$$p.name",
                    },
                  },
                  email: {
                    $let: {
                      vars: {
                        p: {
                          $first: {
                            $filter: {
                              input: "$people",
                              as: "p",
                              cond: { $eq: ["$$p._id", "$$c.employeeId"] },
                            },
                          },
                        },
                      },
                      in: "$$p.email",
                    },
                  },
                },
              },
            },
          },
        },
        { $sort: { title: 1 } },
      ];

      const rows = await Task.aggregate(pipeline);
      res.json({ month: monthKey, rows });
    } catch (e) {
      console.error("time report by project error", e);
      res.status(500).json({ error: "Failed to load time report" });
    }
  }
);

// List project members with minimal fields
router.get("/:id/members", auth, async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (!canViewProject(req.employee, project))
    return res.status(403).json({ error: "Forbidden" });
  const ids = [project.teamLead, ...(project.members || [])];
  const people = await Employee.find({ _id: { $in: ids } })
    .select("name email subRoles")
    .lean();
  const map = new Map(people.map((p) => [String(p._id), p]));
  const ordered = ids
    .map((id) => {
      const p = map.get(String(id));
      if (!p) return null;
      return {
        id: p._id,
        name: p.name,
        email: p.email,
        subRoles: p.subRoles || [],
      };
    })
    .filter(Boolean);
  res.json({ members: ordered });
});

// Update project - admin only
router.put(
  "/:id",
  auth,
  requirePrimary(["ADMIN", "SUPERADMIN"]),
  async (req, res) => {
    const normalizeClient = (input) => {
      if (input === undefined || input === null) return undefined;
      if (typeof input === "object") {
        if (input._id) return String(input._id).trim();
        return undefined;
      }
      const s = String(input).trim();
      return s || undefined;
    };

    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: "Not found" });
    const { title, description, techStack, teamLead, members } = req.body;
    if (title !== undefined) project.title = title;
    if (description !== undefined) project.description = description;
    if (techStack !== undefined) project.techStack = techStack;
    if (teamLead !== undefined) project.teamLead = teamLead;
    if (members !== undefined) project.members = members;
    // Active flag (cannot deactivate personal projects)
	    if (req.body.active !== undefined) {
	      const next = Boolean(req.body.active);
	      if (project.isPersonal && next === false)
	        return res
	          .status(400)
	          .json({ error: "Cannot deactivate personal project" });
	      project.active = next;
	      project.isActive = next;
	    }
    // startTime: optional
    if (req.body.startTime !== undefined) {
      if (
        req.body.startTime === null ||
        String(req.body.startTime).trim() === ""
      ) {
        project.startTime = undefined;
      } else {
        const d = new Date(req.body.startTime);
        if (isNaN(d.getTime()))
          return res.status(400).json({ error: "Invalid startTime" });
        project.startTime = d;
      }
    }
    if (req.body.client !== undefined) {
      const nextClient = normalizeClient(req.body.client);
      if (!nextClient) {
        project.client = undefined;
      } else {
        const client = await Client.findOne({
          _id: nextClient,
          company: project.company,
          isDeleted: { $ne: true },
        })
          .select("_id")
          .lean();
        if (!client) return res.status(400).json({ error: "Invalid client" });
        project.client = nextClient;
      }
    }
    // Estimated time: accept minutes or hours
    if (req.body.estimatedTimeMinutes !== undefined) {
      const m = parseInt(req.body.estimatedTimeMinutes, 10);
      if (!isFinite(m) || m < 0)
        return res.status(400).json({ error: "Invalid estimatedTimeMinutes" });
      project.estimatedTimeMinutes = m;
    } else if (
      req.body.estimatedHours !== undefined ||
      req.body.estimatedTimeHours !== undefined
    ) {
      const h = parseFloat(
        String(req.body.estimatedHours ?? req.body.estimatedTimeHours)
      );
      if (!isFinite(h) || h < 0)
        return res.status(400).json({ error: "Invalid estimated hours" });
      project.estimatedTimeMinutes = Math.round(h * 60);
    }
    if (req.body.monthlyEstimateMinutes !== undefined) {
      const m = parseInt(req.body.monthlyEstimateMinutes, 10);
      if (!isFinite(m) || m < 0)
        return res
          .status(400)
          .json({ error: "Invalid monthlyEstimateMinutes" });
      project.monthlyEstimateMinutes = m;
    } else if (req.body.monthlyEstimateHours !== undefined) {
      const h = parseFloat(String(req.body.monthlyEstimateHours));
      if (!isFinite(h) || h < 0)
        return res.status(400).json({ error: "Invalid monthly estimate hours" });
      project.monthlyEstimateMinutes = Math.round(h * 60);
    }
    await project.save();
    await ensureMeetingTask(project, req.employee.id);
    sendSuccess(res, "Project updated", { project });
  }
);

// Delete project - admin only
router.delete(
  "/:id",
  auth,
  requirePrimary(["ADMIN", "SUPERADMIN"]),
  async (req, res) => {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: "Not found" });
    await Task.updateMany(
      { project: project._id },
      { $set: { isDeleted: true, isActive: false } }
    );
    project.isDeleted = true;
    project.isActive = false;
    project.active = false;
    await project.save();
    sendSuccess(res, "Project deleted", { success: true });
  }
);

// Create task within project
router.post("/:id/tasks", auth, async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ error: "Not found" });
  if (!isProjectLive(project))
    return res.status(400).json({ error: "Project is inactive" });
  if (!canCreateTasks(req.employee))
    return res
      .status(403)
      .json({ error: "Task creation is not allowed for your role" });
  // Allow any project member or admin to create tasks
  if (!isProjectMember(req.employee, project) && !isAdmin(req.employee))
    return res.status(403).json({ error: "Forbidden" });
  const { title, description, priority } = req.body;
  const parentTaskId = String(req.body.parentTask || "").trim();
  let parentTask = null;
  if (parentTaskId) {
    parentTask = await loadParentTask({
      projectId: project._id,
      parentTaskId,
    });
    if (!parentTask)
      return res.status(400).json({ error: "Invalid parent task" });
  }

  const normalizeAssignees = (input) => {
    if (Array.isArray(input)) {
      return Array.from(
        new Set(
          input
            .map((a) => {
              if (a && typeof a === "object") {
                if (a._id) return String(a._id);
                return "";
              }
              return String(a ?? "").trim();
            })
            .filter(Boolean)
        )
      );
    }
    if (input === undefined || input === null) return [];
    return [String(input).trim()].filter(Boolean);
  };

  const assignees = normalizeAssignees(req.body.assignedTo);
  if (!assignees.length)
    return res.status(400).json({ error: "Assignee required" });

  // For personal company-wide project, allow assigning any employee in the same company
  if (!project.isPersonal) {
    const allowed = [
      String(project.teamLead),
      ...(project.members || []).map((m) => String(m)),
    ];
    const invalid = assignees.filter((a) => !allowed.includes(String(a)));
    if (invalid.length)
      return res.status(400).json({ error: "Assignee not in project" });
  }
  // Parse optional estimate: accept minutes or hours
  let estimatedTimeMinutes = 0;
  if (req.body.estimatedTimeMinutes !== undefined) {
    const m = parseInt(req.body.estimatedTimeMinutes, 10);
    if (!isFinite(m) || m < 0)
      return res.status(400).json({ error: "Invalid estimatedTimeMinutes" });
    estimatedTimeMinutes = m;
  } else if (
    req.body.estimatedHours !== undefined ||
    req.body.estimatedTimeHours !== undefined
  ) {
    const h = parseFloat(
      String(req.body.estimatedHours ?? req.body.estimatedTimeHours)
    );
    if (!isFinite(h) || h < 0)
      return res.status(400).json({ error: "Invalid estimated hours" });
    estimatedTimeMinutes = Math.round(h * 60);
  }

  const newTask = {
    project: project._id,
    title,
    description,
    createdBy: req.employee.id,
    assignedTo: assignees,
  };
  if (parentTask) newTask.parentTask = parentTask._id;
  if (priority) newTask.priority = priority; // enum enforced by schema
  if (estimatedTimeMinutes) newTask.estimatedTimeMinutes = estimatedTimeMinutes;

  const task = await Task.create(newTask);
  sendSuccess(res, "Task created", { task });

  // Fire-and-forget in-app notification to all assignees
  (async () => {
    try {
      const recipients = Array.from(new Set(assignees.map(String))).filter(
        (id) => id && id !== String(req.employee.id)
      );
      if (!recipients.length) return;
      await Notification.insertMany(
        recipients.map((employeeId) => ({
          company: project.company,
          employee: employeeId,
          type: "TASK_ASSIGNED",
          title: `New Task Assigned: ${title}`,
          message: `Project: ${project.title}`,
          link: `/projects/${project._id}/tasks?task=${task._id}`,
          meta: { projectId: String(project._id), taskId: String(task._id) },
        }))
      );
    } catch (e) {
      console.warn(
        "[projects] Failed to create task assignment notifications:",
        e?.message || e
      );
    }
  })();

  // Fire-and-forget email notification to all assignees
  (async () => {
    try {
      const companyId = project.company;
      if (!(await isEmailEnabled(companyId))) return;
      const people = await Employee.find({ _id: { $in: assignees } })
        .select("name email")
        .lean();
      const sub = `New Task Assigned: ${title}`;
      const safeDesc = description
        ? String(description).replace(/</g, "&lt;")
        : "";
      const jobs = (people || [])
        .filter((p) => p?.email)
        .map((assignee) =>
          sendMail({
            companyId,
            to: assignee.email,
            subject: sub,
            html: `
              <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height:1.5;">
                <h2 style="margin:0 0 12px;">A new task has been assigned to you</h2>
                <p><strong>Task:</strong> ${title}</p>
                ${safeDesc ? `<p><strong>Description:</strong> ${safeDesc}</p>` : ""}
                <p><strong>Project:</strong> ${project.title}</p>
                <p><strong>Assigned By:</strong> ${
                  req.employee.name || "Project Member"
                }</p>
                <p style="margin-top:16px; color:#666; font-size:12px;">This is an automated notification from HRMS.</p>
              </div>
            `,
            text: `You have been assigned a new task: ${title} (Project: ${project.title})`,
            skipInAppNotification: true,
          })
        );
      await Promise.all(jobs);
    } catch (e) {
      console.warn(
        "[projects] Failed to send task assignment email:",
        e?.message || e
      );
    }
  })();
});

// List tasks for a project
router.get("/:id/tasks", auth, async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ error: "Not found" });
  if (!canViewProject(req.employee, project))
    return res.status(403).json({ error: "Forbidden" });
  const statusRaw = req.query.status ? String(req.query.status).trim().toUpperCase() : null;
  const priorityRaw = req.query.priority ? String(req.query.priority).trim().toUpperCase() : null;
  const assigneeRaw = req.query.assignee ? String(req.query.assignee).trim() : null;
  const search = req.query.q ? String(req.query.q).trim() : "";
  const sortKeyRaw = req.query.sort ? String(req.query.sort).trim().toLowerCase() : "";
  const sortDir = String(req.query.dir || "").toLowerCase() === "asc" ? 1 : -1;
  const escapeRegex = (s = "") => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (statusRaw && !["PENDING", "INPROGRESS", "DONE"].includes(statusRaw))
    return res.status(400).json({ error: "Invalid status" });
  if (priorityRaw && !["URGENT", "FIRST", "SECOND", "LEAST"].includes(priorityRaw))
    return res.status(400).json({ error: "Invalid priority" });
  const baseQuery = {
    project: project._id,
    isDeleted: { $ne: true },
    isActive: { $ne: false },
  };
  const isHr = (req.employee.subRoles || []).includes("hr");
  const isLead = String(project.teamLead) === String(req.employee.id);
  // Admin/HR/Team Lead: see all tasks. Others: only tasks assigned to them.
  let query =
    isAdmin(req.employee) || isHr || isLead
      ? baseQuery
      : { ...baseQuery, assignedTo: req.employee.id };
  if (assigneeRaw && assigneeRaw !== "ALL") {
    query = { ...query, assignedTo: assigneeRaw };
  }
  if (statusRaw) query = { ...query, status: statusRaw };
  if (priorityRaw) query = { ...query, priority: priorityRaw };
  if (search) {
    const regex = new RegExp(escapeRegex(search), "i");
    query = {
      ...query,
      $or: [
        { title: regex },
        { description: regex },
        { status: regex },
        { priority: regex },
      ],
    };
  }
  const sortKeyMap = {
    title: "title",
    assignee: "assignedTo",
    status: "status",
    priority: "priority",
    time: "timeSpentMinutes",
    updated: "updatedAt",
    created: "createdAt",
  };
  const sortField = sortKeyMap[sortKeyRaw] || "createdAt";
  const sort = { [sortField]: sortDir, createdAt: -1 };
  // Optional pagination
  let limit =
    req.query.limit !== undefined ? parseInt(req.query.limit, 10) : undefined;
  let page = req.query.page !== undefined ? parseInt(req.query.page, 10) : 1;
  if (isFinite(limit)) {
    limit = Math.max(1, Math.min(100, limit));
  } else {
    limit = undefined;
  }
  if (!isFinite(page) || page < 1) page = 1;

  if (limit) {
    const total = await Task.countDocuments(query);
    const tasks = await Task.find(query)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();
    const pages = Math.max(1, Math.ceil(total / limit));
    return res.json({ tasks, total, page, pages, limit });
  }
  // No pagination requested; return all (existing behavior)
  const tasks = await Task.find(query).sort(sort).lean();
  res.json({
    tasks,
    total: tasks.length,
    page: 1,
    pages: 1,
    limit: tasks.length,
  });
});

// Fetch single task (with optional logs and children)
router.get("/tasks/:taskId", auth, async (req, res) => {
  let companyId = req.employee.company;
  if (
    !companyId &&
    ["ADMIN", "SUPERADMIN"].includes(req.employee.primaryRole || "")
  ) {
    const company = await require("../models/Company")
      .findOne({ admin: req.employee.id })
      .select("_id")
      .lean();
    if (company) companyId = company._id;
  }
  if (!companyId)
    return res.status(400).json({ error: "Company not set for employee" });

  const includeLogs =
    String(req.query.includeLogs || "").toLowerCase() === "true";
  const includeChildren =
    String(req.query.includeChildren || "").toLowerCase() === "true";

  const task = await Task.findOne({
    _id: req.params.taskId,
    isDeleted: { $ne: true },
    isActive: { $ne: false },
  })
    .populate([{ path: "project", select: "title company teamLead members" }])
    .lean();
  if (!task) return res.status(404).json({ error: "Task not found" });

  // Company guard
  const projCompany =
    typeof task.project === "object" ? task.project?.company : null;
  if (projCompany && String(projCompany) !== String(companyId)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const normalized = { ...task };
  if (!includeLogs) delete normalized.timeLogs;

  if (includeChildren) {
    const children = await Task.find({
      parentTask: task._id,
      isDeleted: { $ne: true },
      isActive: { $ne: false },
    })
      .select(includeLogs ? undefined : "-timeLogs")
      .lean();
    normalized.children = children;
  }

  res.json({ task: normalized });
});

// Update a task
router.put("/:id/tasks/:taskId", auth, async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (!isProjectLive(project))
    return res.status(400).json({ error: "Project is inactive" });
  const isLeadOrAdmin =
    String(project.teamLead) === String(req.employee.id) ||
    isAdmin(req.employee);
  const task = await Task.findOne({
    _id: req.params.taskId,
    project: project._id,
    isDeleted: { $ne: true },
    isActive: { $ne: false },
  });
  if (!task) return res.status(404).json({ error: "Not found" });
  if (task.isMeetingDefault) {
    return res
      .status(400)
      .json({ error: "Default meeting task cannot be edited" });
  }
  const { title, description, status: statusInput, assignedTo, priority } =
    req.body;
  const prevAssignees = (Array.isArray(task.assignedTo)
    ? task.assignedTo
    : [task.assignedTo]
  )
    .filter(Boolean)
    .map(String);
  const isCreator = task.createdBy?.equals(req.employee?.id);
  const isAssignee = prevAssignees.includes(String(req.employee.id));
  const subRoles = req.employee.subRoles || [];
  const isHr = subRoles.includes("hr");
  const isManager = subRoles.includes("manager");

  if (statusInput !== undefined) {
    const normalizedStatus = String(statusInput).trim().toUpperCase();
    const allowedStatuses = ["PENDING", "INPROGRESS", "DONE"];
    if (!allowedStatuses.includes(normalizedStatus)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    const canUpdateStatus =
      isAssignee ||
      isLeadOrAdmin ||
      isCreator ||
      isHr ||
      isManager ||
      isProjectMember(req.employee, project);
    if (!canUpdateStatus) {
      return res
        .status(403)
        .json({ error: "You do not have permission to update status" });
    }
    task.status = normalizedStatus;
  }

  // Core fields (title/description/assignee): team lead or admin only
  if (
    title !== undefined ||
    description !== undefined ||
    assignedTo !== undefined ||
    priority !== undefined ||
    req.body.parentTask !== undefined ||
    req.body.estimatedTimeMinutes !== undefined ||
    req.body.estimatedHours !== undefined ||
    req.body.estimatedTimeHours !== undefined
  ) {
    const canEditCore =
      isLeadOrAdmin ||
      isCreator ||
      isHr ||
      isManager ||
      isProjectMember(req.employee, project);
    if (!canEditCore)
      return res
        .status(403)
        .json({ error: "You do not have permission to edit this task" });
  }
  if (title !== undefined) task.title = title;
  if (description !== undefined) task.description = description;
  if (req.body.parentTask !== undefined) {
    const rawParent = String(req.body.parentTask || "").trim();
    if (rawParent) {
      if (String(task._id) === rawParent)
        return res.status(400).json({ error: "Task cannot be its own parent" });
      const hasChildren = await taskHasChildren(task._id);
      if (hasChildren)
        return res
          .status(400)
          .json({ error: "Tasks with subtasks cannot be converted to subtasks" });
      const parentTask = await loadParentTask({
        projectId: project._id,
        parentTaskId: rawParent,
      });
      if (!parentTask)
        return res.status(400).json({ error: "Invalid parent task" });
      task.parentTask = parentTask._id;
    } else {
      task.parentTask = null;
    }
  }
  if (assignedTo !== undefined) {
    const normalizeAssignees = (input) => {
      if (Array.isArray(input)) {
        return Array.from(
          new Set(
            input
              .map((a) => {
                if (a && typeof a === "object") {
                  if (a._id) return String(a._id);
                  return "";
                }
                return String(a ?? "").trim();
              })
              .filter(Boolean)
          )
        );
      }
      if (input === undefined || input === null) return [];
      return [String(input).trim()].filter(Boolean);
    };
    const normalized = normalizeAssignees(assignedTo);
    // Once assigned, assignees cannot be removed from the task.
    const removed = prevAssignees.filter(
      (a) => !normalized.includes(String(a))
    );
    if (removed.length) {
      return res
        .status(400)
        .json({ error: "Cannot remove existing assignees from this task" });
    }
    const allowed = [
      String(project.teamLead),
      ...(project.members || []).map((m) => String(m)),
      // Allow already-assigned people to remain, even if removed from the project later.
      ...prevAssignees,
    ];
    const invalid = normalized.filter((a) => !allowed.includes(a));
    if (invalid.length)
      return res.status(400).json({ error: "Assignee not in project" });
    if (!normalized.length)
      return res.status(400).json({ error: "Assignee required" });
    task.assignedTo = normalized;
  }
  if (priority !== undefined) task.priority = priority; // enum enforced by schema
  // Estimated time updates
  if (req.body.estimatedTimeMinutes !== undefined) {
    const m = parseInt(req.body.estimatedTimeMinutes, 10);
    if (!isFinite(m) || m < 0)
      return res.status(400).json({ error: "Invalid estimatedTimeMinutes" });
    task.estimatedTimeMinutes = m;
  } else if (
    req.body.estimatedHours !== undefined ||
    req.body.estimatedTimeHours !== undefined
  ) {
    const h = parseFloat(
      String(req.body.estimatedHours ?? req.body.estimatedTimeHours)
    );
    if (!isFinite(h) || h < 0)
      return res.status(400).json({ error: "Invalid estimated hours" });
    task.estimatedTimeMinutes = Math.round(h * 60);
  }
  await task.save();
  sendSuccess(res, "Task updated", { task });

  // If assignees changed, notify newly added assignees
  if (assignedTo !== undefined) {
    (async () => {
      try {
        const companyId = project.company;
        const normalizeAssignees = (input) => {
          if (Array.isArray(input)) {
            return Array.from(
              new Set(
                input
                  .map((a) => {
                    if (a && typeof a === "object") {
                      if (a._id) return String(a._id);
                      return "";
                    }
                    return String(a ?? "").trim();
                  })
                  .filter(Boolean)
              )
            );
          }
          if (input === undefined || input === null) return [];
          return [String(input).trim()].filter(Boolean);
        };
        const nextAssignees = normalizeAssignees(assignedTo);
        const newlyAdded = nextAssignees.filter(
          (a) => !prevAssignees.includes(a)
        );
        if (!newlyAdded.length) return;

        // In-app notification (created regardless of SMTP availability)
        try {
          const recipients = newlyAdded.filter(
            (id) => id && id !== String(req.employee.id)
          );
          if (recipients.length) {
            await Notification.insertMany(
              recipients.map((employeeId) => ({
                company: project.company,
                employee: employeeId,
                type: "TASK_ASSIGNED",
                title: `Task Reassigned: ${task.title}`,
                message: `Project: ${project.title}`,
                link: `/projects/${project._id}/tasks?task=${task._id}`,
                meta: {
                  projectId: String(project._id),
                  taskId: String(task._id),
                },
              }))
            );
          }
        } catch (e) {
          console.warn(
            "[projects] Failed to create reassignment notifications:",
            e?.message || e
          );
        }

        if (!(await isEmailEnabled(companyId))) return;
        const people = await Employee.find({ _id: { $in: newlyAdded } })
          .select("name email")
          .lean();
        const sub = `Task Reassigned: ${task.title}`;
        const safeDesc = task.description
          ? String(task.description).replace(/</g, "&lt;")
          : "";
        const jobs = (people || [])
          .filter((p) => p?.email)
          .map((assignee) =>
            sendMail({
              companyId,
              to: assignee.email,
              subject: sub,
              html: `
                <div style=\"font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height:1.5;\">
                  <h2 style=\"margin:0 0 12px;\">A task has been assigned to you</h2>
                  <p><strong>Task:</strong> ${task.title}</p>
                  ${
                    safeDesc
                      ? `<p><strong>Description:</strong> ${safeDesc}</p>`
                      : ""
                  }
                  <p><strong>Project:</strong> ${project.title}</p>
                  <p><strong>Assigned By:</strong> ${
                    req.employee.name || "Project Lead"
                  }</p>
                  <p style=\"margin-top:16px; color:#666; font-size:12px;\">This is an automated notification from HRMS.</p>
                </div>
              `,
              text: `You have been assigned the task: ${task.title} (Project: ${project.title})`,
              skipInAppNotification: true,
            })
          );
        await Promise.all(jobs);
      } catch (e) {
        console.warn(
          "[projects] Failed to send reassignment email:",
          e?.message || e
        );
      }
    })();
  }
});

// Delete a task - team lead or admin
router.delete("/:id/tasks/:taskId", auth, async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (!isProjectLive(project))
    return res.status(400).json({ error: "Project is inactive" });
  if (
    String(project.teamLead) !== String(req.employee.id) &&
    !isAdmin(req.employee)
  )
    return res.status(403).json({ error: "Forbidden" });
  const task = await Task.findOne({
    _id: req.params.taskId,
    project: project._id,
    isDeleted: { $ne: true },
    isActive: { $ne: false },
  });
  if (!task) return res.status(404).json({ error: "Not found" });
  if (task.isMeetingDefault) {
    return res.status(400).json({ error: "Meeting task cannot be deleted" });
  }
  task.isDeleted = true;
  task.isActive = false;
  await task.save();
  sendSuccess(res, "Task deleted", { success: true });
});

// Add a comment to a task - project member or admin
router.post("/:id/tasks/:taskId/comments", auth, async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (!isProjectLive(project))
    return res.status(400).json({ error: "Project is inactive" });
  if (!isProjectMember(req.employee, project) && !isAdmin(req.employee))
    return res.status(403).json({ error: "Forbidden" });
  const task = await Task.findOne({
    _id: req.params.taskId,
    project: project._id,
    isDeleted: { $ne: true },
    isActive: { $ne: false },
  });
  if (!task) return res.status(404).json({ error: "Task not found" });
  const { text } = req.body;
  if (!text || !String(text).trim())
    return res.status(400).json({ error: "Empty comment" });
  task.comments.push({ author: req.employee.id, text });
  await task.save();
  const latest = task.comments[task.comments.length - 1];
  sendSuccess(res, "Comment added", { comment: latest, taskId: task._id });

  // Fire-and-forget in-app notification to assignees / lead (excluding commenter)
  (async () => {
    try {
      const assigned = (Array.isArray(task.assignedTo)
        ? task.assignedTo
        : [task.assignedTo]
      )
        .filter(Boolean)
        .map(String);
      const recipients = Array.from(
        new Set([
          ...assigned,
          String(task.createdBy || ""),
          String(project.teamLead || ""),
        ].filter(Boolean))
      ).filter((id) => id !== String(req.employee.id));

      if (!recipients.length) return;
      const snippet = String(text).trim().slice(0, 180);
      await Notification.insertMany(
        recipients.map((employeeId) => ({
          company: project.company,
          employee: employeeId,
          type: "TASK_COMMENT",
          title: `New comment: ${task.title}`,
          message: snippet,
          link: `/projects/${project._id}/tasks?comments=${task._id}`,
          meta: {
            projectId: String(project._id),
            taskId: String(task._id),
          },
        }))
      );
    } catch (e) {
      console.warn(
        "[projects] Failed to create comment notifications:",
        e?.message || e
      );
    }
  })();
});

// List comments on a task - visible to project viewers
router.get("/:id/tasks/:taskId/comments", auth, async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (!canViewProject(req.employee, project))
    return res.status(403).json({ error: "Forbidden" });
  const task = await Task.findOne({
    _id: req.params.taskId,
    project: project._id,
  }).lean();
  if (!task) return res.status(404).json({ error: "Task not found" });
  res.json({ comments: task.comments || [] });
});

// Add time log to a task - project member or admin
router.post("/:id/tasks/:taskId/time", auth, async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (!isProjectLive(project))
    return res.status(400).json({ error: "Project is inactive" });
  if (!isProjectMember(req.employee, project) && !isAdmin(req.employee))
    return res.status(403).json({ error: "Forbidden" });
  const task = await Task.findOne({
    _id: req.params.taskId,
    project: project._id,
    isDeleted: { $ne: true },
    isActive: { $ne: false },
  });
  if (!task) return res.status(404).json({ error: "Task not found" });
  const leafOk = await ensureLeafForTimeLogs(task, res);
  if (!leafOk) return;
  // Accept either hours (preferred) or minutes for backward compatibility
  let minutes = 0;
  if (req.body.hours !== undefined) {
    const h = parseFloat(req.body.hours);
    if (!isFinite(h) || h <= 0)
      return res.status(400).json({ error: "Invalid hours" });
    minutes = Math.round(h * 60);
  } else {
    minutes = parseInt(req.body.minutes, 10);
    if (!minutes || minutes <= 0)
      return res.status(400).json({ error: "Invalid minutes" });
  }
  const noteRaw = req.body.note;
  const note =
    typeof noteRaw === "string" ? noteRaw.trim().slice(0, 500) : "";

  // Enforce daily cap: total logged minutes today must not exceed (worked minutes - 60)
  try {
    const now = new Date();
    const start = startOfDay(now);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    // Current effective worked minutes for today
    const attendance = await Attendance.findOne({
      employee: req.employee.id,
      date: start,
    });
    let workedMs = 0;
    if (attendance) {
      workedMs = attendance.workedMs || 0;
      if (attendance.lastPunchIn && !attendance.lastPunchOut) {
        // Add in-progress time
        workedMs += now.getTime() - new Date(attendance.lastPunchIn).getTime();
      }
    }
    const workedMinutes = Math.max(0, Math.floor(workedMs / 60000));
    const maxAllowedToday = Math.max(0, workedMinutes - 60);

    // Sum already-logged minutes today across all company projects by this employee
    const companyProjects = await Project.find({
      company: req.employee.company,
    })
      .select("_id")
      .lean();
    const projectIds = companyProjects.map((p) => p._id);
    const rawTasks = await Task.find({
      project: { $in: projectIds },
      timeLogs: {
        $elemMatch: {
          addedBy: req.employee.id,
          createdAt: { $gte: start, $lt: end },
        },
      },
    })
      .select("timeLogs")
      .lean();
    const alreadyLogged = rawTasks.reduce((acc, t) => {
      const mins = (t.timeLogs || [])
        .filter(
          (l) =>
            String(l.addedBy) === String(req.employee.id) &&
            l.createdAt >= start &&
            l.createdAt < end
        )
        .reduce((s, l) => s + (l.minutes || 0), 0);
      return acc + mins;
    }, 0);

    const remaining = Math.max(0, maxAllowedToday - alreadyLogged);
    if (minutes > remaining) {
      return res.status(400).json({
        error: `Exceeds allowed time for today. Remaining: ${remaining} minutes (worked ${workedMinutes}m minus 60m break).`,
      });
    }
  } catch (e) {
    // If the cap check fails unexpectedly, do not allow bypass silently
    return res.status(500).json({ error: "Failed to validate daily time cap" });
  }

  task.timeLogs.push({ minutes, note, addedBy: req.employee.id });
  task.timeSpentMinutes = (task.timeSpentMinutes || 0) + minutes;
  await task.save();
  sendSuccess(res, "Time log added", {
    timeSpentMinutes: task.timeSpentMinutes,
    latest: task.timeLogs[task.timeLogs.length - 1],
    taskId: task._id,
  });
});

// Add a back-dated time log to a task for a specific calendar date.
// Enforces the daily cap only when the target date is today; skips cap for past days.
// Body: { minutes | hours, date: 'yyyy-mm-dd' or ISO, note? }
router.post("/:id/tasks/:taskId/time-at", auth, async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (!isProjectLive(project))
    return res.status(400).json({ error: "Project is inactive" });
  const isHr = (req.employee.subRoles || []).includes("hr");
  const isManager = (req.employee.subRoles || []).includes("manager");
  const adminOrMember =
    isProjectMember(req.employee, project) ||
    isAdmin(req.employee) ||
    isHr ||
    isManager;
  if (!adminOrMember) return res.status(403).json({ error: "Forbidden" });
  const task = await Task.findOne({
    _id: req.params.taskId,
    project: project._id,
    isDeleted: { $ne: true },
    isActive: { $ne: false },
  });
  if (!task) return res.status(404).json({ error: "Task not found" });
  const leafOk = await ensureLeafForTimeLogs(task, res);
  if (!leafOk) return;

  // Parse minutes/hours
  let minutes = 0;
  if (req.body.hours !== undefined) {
    const h = parseFloat(req.body.hours);
    if (!isFinite(h) || h <= 0)
      return res.status(400).json({ error: "Invalid hours" });
    minutes = Math.round(h * 60);
  } else {
    minutes = parseInt(req.body.minutes, 10);
    if (!minutes || minutes <= 0)
      return res.status(400).json({ error: "Invalid minutes" });
  }
  const noteRaw = req.body.note;
  const note =
    typeof noteRaw === "string" ? noteRaw.trim().slice(0, 500) : "";

  // Determine whose time log to record (self or target employee)
  const targetEmployeeId = String(req.body.forEmployee || req.employee.id);
  const isSelf = targetEmployeeId === String(req.employee.id);
  if (!isSelf) {
    const isAdminUser = isAdmin(req.employee);
    if (!(isAdminUser || isHr || isManager))
      return res.status(403).json({ error: "Forbidden" });
    const targetEmployee = await Employee.findById(targetEmployeeId)
      .select("company")
      .lean();
    if (!targetEmployee)
      return res.status(404).json({ error: "Employee not found" });
    if (String(targetEmployee.company) !== String(req.employee.company))
      return res.status(403).json({ error: "Forbidden" });
  }

  // Parse date
  if (!req.body.date) return res.status(400).json({ error: "Missing date" });
  const d = new Date(req.body.date);
  if (isNaN(d.getTime()))
    return res.status(400).json({ error: "Invalid date" });
  const start = startOfDay(d);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const todayStart = startOfDay(new Date());
  const isToday = start.getTime() === todayStart.getTime();

  // Enforce cap only for today
  if (isToday) {
    try {
      const now = new Date();
      // Current effective worked minutes for today
      const attendance = await Attendance.findOne({
        employee: targetEmployeeId,
        date: start,
      });
      let workedMs = 0;
      if (attendance) {
        workedMs = attendance.workedMs || 0;
        if (attendance.lastPunchIn && !attendance.lastPunchOut) {
          // Add in-progress time
          workedMs +=
            now.getTime() - new Date(attendance.lastPunchIn).getTime();
        }
      }
      const workedMinutes = Math.max(0, Math.floor(workedMs / 60000));
      const maxAllowedToday = Math.max(0, workedMinutes - 60);

      // Sum already-logged minutes today across all company projects by this employee
      const companyProjects = await Project.find({
        company: req.employee.company,
      })
        .select("_id")
        .lean();
      const projectIds = companyProjects.map((p) => p._id);
      const rawTasks = await Task.find({
        project: { $in: projectIds },
        timeLogs: {
          $elemMatch: {
            addedBy: targetEmployeeId,
            createdAt: { $gte: start, $lt: end },
          },
        },
      })
        .select("timeLogs")
        .lean();
      const alreadyLogged = rawTasks.reduce((acc, t) => {
        const mins = (t.timeLogs || [])
          .filter(
            (l) =>
              String(l.addedBy) === String(targetEmployeeId) &&
              l.createdAt >= start &&
              l.createdAt < end
          )
          .reduce((s, l) => s + (l.minutes || 0), 0);
        return acc + mins;
      }, 0);

      const remaining = Math.max(0, maxAllowedToday - alreadyLogged);
      if (minutes > remaining) {
        return res.status(400).json({
          error: `Exceeds allowed time for today. Remaining: ${remaining} minutes (worked ${workedMinutes}m minus 60m break).`,
        });
      }
    } catch (e) {
      return res
        .status(500)
        .json({ error: "Failed to validate daily time cap" });
    }
  }

  // Push time log with createdAt set to the middle of the target day for clarity
  const createdAt = new Date(start.getTime() + 12 * 60 * 60 * 1000);
  task.timeLogs.push({ minutes, note, addedBy: targetEmployeeId, createdAt });
  task.timeSpentMinutes = (task.timeSpentMinutes || 0) + minutes;
  await task.save();
  sendSuccess(res, "Time log added", {
    timeSpentMinutes: task.timeSpentMinutes,
    latest: task.timeLogs[task.timeLogs.length - 1],
    taskId: task._id,
  });
});

router.put("/:id/tasks/:taskId/time-log/:logId", auth, async (req, res) => {
  try {
	    const project = await Project.findById(req.params.id);
	    if (!project) return res.status(404).json({ error: "Project not found" });
	    if (!isProjectLive(project))
	      return res.status(400).json({ error: "Project is inactive" });

	    const task = await Task.findOne({
	      _id: req.params.taskId,
	      project: project._id,
	      isDeleted: { $ne: true },
	      isActive: { $ne: false },
	    });
    if (!task) return res.status(404).json({ error: "Task not found" });

    const log = task.timeLogs.id(req.params.logId);
    if (!log) return res.status(404).json({ error: "Time log not found" });

    const isHr = (req.employee.subRoles || []).includes("hr");
    const isManager = (req.employee.subRoles || []).includes("manager");
    const isAdminUser = isAdmin(req.employee);
    const isMember = isProjectMember(req.employee, project);
    const isOwner = String(log.addedBy) === String(req.employee.id);
    if (!isOwner && !(isAdminUser || isHr || isManager || isMember))
      return res.status(403).json({ error: "Forbidden" });

    const minutes =
      req.body.minutes !== undefined
        ? parseInt(req.body.minutes, 10)
        : log.minutes;
    if (!minutes || !Number.isFinite(minutes) || minutes <= 0)
      return res.status(400).json({ error: "Invalid minutes" });

    let createdAt = log.createdAt ? new Date(log.createdAt) : new Date();
    if (req.body.date) {
      const d = new Date(req.body.date);
      if (isNaN(d.getTime()))
        return res.status(400).json({ error: "Invalid date" });
      createdAt = new Date(d);
      createdAt.setHours(12, 0, 0, 0);
    }

    const targetEmployeeId = String(log.addedBy);
    const todayStart = startOfDay(new Date());
    const newDayStart = startOfDay(createdAt);
    const isToday = newDayStart.getTime() === todayStart.getTime();

    const delta = minutes - (log.minutes || 0);
    if (delta > 0 && isToday && String(req.employee.id) === targetEmployeeId) {
      try {
        const attendance = await Attendance.findOne({
          employee: targetEmployeeId,
          date: todayStart,
        });
        let workedMs = 0;
        if (attendance) {
          workedMs = attendance.workedMs || 0;
          if (attendance.lastPunchIn && !attendance.lastPunchOut) {
            workedMs += Date.now() - new Date(attendance.lastPunchIn).getTime();
          }
        }
        const workedMinutes = Math.max(0, Math.floor(workedMs / 60000));
        const maxAllowedToday = Math.max(0, workedMinutes - 60);

        const companyProjects = await Project.find({
          company: project.company,
        })
          .select("_id")
          .lean();
        const projectIds = companyProjects.map((p) => p._id);
        const rawTasks = await Task.find({
          project: { $in: projectIds },
          timeLogs: {
            $elemMatch: {
              addedBy: targetEmployeeId,
              createdAt: {
                $gte: todayStart,
                $lt: new Date(todayStart.getTime() + 24 * 60 * 60 * 1000),
              },
            },
          },
        })
          .select("timeLogs")
          .lean();
        const alreadyLogged = rawTasks.reduce((acc, t) => {
          const mins = (t.timeLogs || [])
            .filter(
              (l) =>
                String(l.addedBy) === targetEmployeeId &&
                l.createdAt >= todayStart &&
                l.createdAt <
                  new Date(todayStart.getTime() + 24 * 60 * 60 * 1000) &&
                String(l._id) !== String(log._id)
            )
            .reduce((s, l) => s + (l.minutes || 0), 0);
          return acc + mins;
        }, 0);
        if (alreadyLogged + minutes > maxAllowedToday) {
          return res.status(400).json({
            error: `Exceeds allowed time for today. Remaining: ${Math.max(
              0,
              maxAllowedToday - alreadyLogged
            )} minutes.`,
          });
        }
      } catch (capErr) {
        console.warn("[projects] cap check failed", capErr);
      }
    }

    task.timeSpentMinutes =
      (task.timeSpentMinutes || 0) + (minutes - (log.minutes || 0));
    log.minutes = minutes;
    if (typeof req.body.note === "string")
      log.note = req.body.note.trim().slice(0, 500);
    if (req.body.date) log.createdAt = createdAt;
    else if (
      newDayStart.getTime() !==
      startOfDay(log.createdAt || new Date()).getTime()
    )
      log.createdAt = createdAt;

    await task.save();

    sendSuccess(res, "Time log updated", {
      log: {
        id: String(log._id),
        minutes: log.minutes,
        note: log.note,
        createdAt: log.createdAt,
        addedBy: String(log.addedBy),
      },
    });
  } catch (e) {
    console.error("time-log update error", e);
    res.status(500).json({ error: "Failed to update time log" });
  }
});

	router.delete("/:id/tasks/:taskId/time-log/:logId", auth, async (req, res) => {
	  try {
	    const project = await Project.findById(req.params.id);
	    if (!project) return res.status(404).json({ error: "Project not found" });
	    if (!isProjectLive(project))
	      return res.status(400).json({ error: "Project is inactive" });

	    const task = await Task.findOne({
	      _id: req.params.taskId,
	      project: project._id,
	      isDeleted: { $ne: true },
	      isActive: { $ne: false },
	    });
	    if (!task) return res.status(404).json({ error: "Task not found" });

    const log = task.timeLogs.id(req.params.logId);
    if (!log) return res.status(404).json({ error: "Time log not found" });

    const isHr = (req.employee.subRoles || []).includes("hr");
    const isManager = (req.employee.subRoles || []).includes("manager");
    const isAdminUser = isAdmin(req.employee);
    const isMember = isProjectMember(req.employee, project);
    const isOwner = String(log.addedBy) === String(req.employee.id);
    if (!isOwner && !(isAdminUser || isHr || isManager || isMember))
      return res.status(403).json({ error: "Forbidden" });

    task.timeSpentMinutes = Math.max(
      0,
      (task.timeSpentMinutes || 0) - (log.minutes || 0)
    );
    task.timeLogs = (task.timeLogs || []).filter(
      (l) => String(l._id) !== String(log._id)
    );
    task.markModified("timeLogs");
    await task.save();

    sendSuccess(res, "Time log deleted", { ok: true });
  } catch (e) {
    console.error("time-log delete error", e);
    res.status(500).json({ error: "Failed to delete time log" });
  }
});

// Set total time on a task (replace), without altering historical logs
// Allows reducing or increasing the total; members or admins only
router.put("/:id/tasks/:taskId/time", auth, async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (!isProjectLive(project))
    return res.status(400).json({ error: "Project is inactive" });
  if (!isProjectMember(req.employee, project) && !isAdmin(req.employee))
    return res.status(403).json({ error: "Forbidden" });
  const task = await Task.findOne({
    _id: req.params.taskId,
    project: project._id,
    isDeleted: { $ne: true },
    isActive: { $ne: false },
  });
  if (!task) return res.status(404).json({ error: "Task not found" });

  let totalMinutes = 0;
  if (req.body.hours !== undefined) {
    const h = parseFloat(req.body.hours);
    if (!isFinite(h) || h < 0)
      return res.status(400).json({ error: "Invalid hours" });
    totalMinutes = Math.round(h * 60);
  } else if (req.body.minutes !== undefined) {
    const m = parseInt(req.body.minutes, 10);
    if (!isFinite(m) || m < 0)
      return res.status(400).json({ error: "Invalid minutes" });
    totalMinutes = m;
  } else {
    return res.status(400).json({ error: "Provide hours or minutes" });
  }

  const leafOk = await ensureLeafForTimeLogs(task, res);
  if (!leafOk) return;

  task.timeSpentMinutes = totalMinutes;
  await task.save();
  sendSuccess(res, "Time updated", {
    timeSpentMinutes: task.timeSpentMinutes,
    taskId: task._id,
  });
});

module.exports = router;
