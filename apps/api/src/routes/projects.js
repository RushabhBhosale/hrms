const router = require("express").Router();
const { auth } = require("../middleware/auth");
const { requirePrimary } = require("../middleware/roles");
const Project = require("../models/Project");
const Task = require("../models/Task");
const Employee = require("../models/Employee");
const { sendMail, isEmailEnabled } = require("../utils/mailer");
const Attendance = require("../models/Attendance");
const { parseWithSchema } = require("../utils/zod");
const { projectSchema } = require("../../../libs/schemas/project");

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function isAdmin(emp) {
  return ["ADMIN", "SUPERADMIN"].includes(emp.primaryRole);
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

// Get or create a single personal project for the company (company-wide)
router.get("/personal", auth, async (req, res) => {
  try {
    let project = await Project.findOne({
      company: req.employee.company,
      isPersonal: true,
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
router.post(
  "/",
  auth,
  async (req, res) => {
    try {
      if (!canManageProjects(req.employee))
        return res.status(403).json({ error: "Forbidden" });

      const computeEstimatedMinutes = () => {
        if (req.body.estimatedTimeMinutes !== undefined) {
          const m = parseInt(req.body.estimatedTimeMinutes, 10);
          if (Number.isFinite(m) && m >= 0) return m;
        }
        if (req.body.estimatedHours !== undefined || req.body.estimatedTimeHours !== undefined) {
          const source =
            req.body.estimatedHours !== undefined
              ? req.body.estimatedHours
              : req.body.estimatedTimeHours;
          const hours = parseFloat(String(source));
          if (Number.isFinite(hours) && hours >= 0) return Math.round(hours * 60);
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
          return input
            .map((item) => String(item || "").trim())
            .filter(Boolean);
        }
        if (typeof input === "string") {
          return input
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
        }
        return [];
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

      const validation = parseWithSchema(projectSchema, {
        title:
          typeof req.body?.title === "string" ? req.body.title.trim() : req.body?.title,
        description: req.body?.description,
        techStack: normalizeTechStack(req.body?.techStack),
        teamLead: teamLeadId,
        members: normalizeMembers(req.body?.members),
        company: String(req.employee.company),
        estimatedTimeMinutes: computeEstimatedMinutes(),
        ...(startTime ? { startTime } : {}),
      });

      if (!validation.ok) {
        return res
          .status(400)
          .json({ error: "Invalid project data", details: validation.issues });
      }

      const projectData = validation.data;
      const project = await Project.create(projectData);
      res.json({ project });

      // Fire-and-forget email notification to team lead and members
      (async () => {
        try {
          const companyId = req.employee.company;
          if (!(await isEmailEnabled(companyId))) return;
          const ids = [projectData.teamLead, ...(Array.isArray(projectData.members) ? projectData.members : [])]
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
  }
);

// List projects visible to the user
router.get("/", auth, async (req, res) => {
  const isAdminUser = isAdmin(req.employee);
  const isHr = (req.employee.subRoles || []).includes("hr");
  const query =
    isAdminUser || isHr
      ? { company: req.employee.company }
      : {
          company: req.employee.company,
          $or: [{ teamLead: req.employee.id }, { members: req.employee.id }],
        };
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
router.get("/tasks/assigned", auth, async (req, res) => {
  try {
    // Limit to tasks within the same company
    const projects = await Project.find({ company: req.employee.company })
      .select("_id")
      .lean();
    const projectIds = projects.map((p) => p._id);
    const tasks = await Task.find({
      project: { $in: projectIds },
      assignedTo: req.employee.id,
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
          minutes: l.minutes,
          note: l.note,
          createdAt: l.createdAt,
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

  const match = { project: project._id };

  try {
    const agg = await Task.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          total: { $sum: { $ifNull: ["$timeSpentMinutes", 0] } },
        },
      },
    ]);
    const total = agg?.[0]?.total || 0;
    res.json({ totalTimeSpentMinutes: total });
  } catch (e) {
    res.status(500).json({ error: "Failed to compute time summary" });
  }
});

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
    await project.save();
    res.json({ project });
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
    await Task.deleteMany({ project: project._id });
    await project.deleteOne();
    res.json({ success: true });
  }
);

// Create task within project
router.post("/:id/tasks", auth, async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ error: "Not found" });
  // Allow any project member or admin to create tasks
  if (!isProjectMember(req.employee, project) && !isAdmin(req.employee))
    return res.status(403).json({ error: "Forbidden" });
  const { title, description, assignedTo, priority } = req.body;
  // For personal company-wide project, allow assigning any employee in the same company
  if (!project.isPersonal) {
    const allowed = [
      String(project.teamLead),
      ...(project.members || []).map((m) => String(m)),
    ];
    if (!allowed.includes(String(assignedTo)))
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
    assignedTo,
    createdBy: req.employee.id,
  };
  if (priority) newTask.priority = priority; // enum enforced by schema
  if (estimatedTimeMinutes) newTask.estimatedTimeMinutes = estimatedTimeMinutes;
  const task = await Task.create(newTask);
  res.json({ task });

  // Fire-and-forget email notification to the assignee
  (async () => {
    try {
      const companyId = project.company;
      if (!(await isEmailEnabled(companyId))) return;
      const assignee = await Employee.findById(assignedTo)
        .select("name email")
        .lean();
      if (!assignee?.email) return;
      const sub = `New Task Assigned: ${title}`;
      const safeDesc = description
        ? String(description).replace(/</g, "&lt;")
        : "";
      const html = `
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
      `;
      await sendMail({
        companyId,
        to: assignee.email,
        subject: sub,
        html,
        text: `You have been assigned a new task: ${title} (Project: ${project.title})`,
      });
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
  const isHrOrManager = (req.employee.subRoles || []).some(
    (r) => r === "hr" || r === "manager"
  );
  const isPrivileged = isAdmin(req.employee) || isHrOrManager;
  const baseQuery = { project: project._id };
  const query = isPrivileged
    ? baseQuery
    : { ...baseQuery, assignedTo: req.employee.id };
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

  const sort = { createdAt: -1 };

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

// Update a task
router.put("/:id/tasks/:taskId", auth, async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  const isLeadOrAdmin =
    String(project.teamLead) === String(req.employee.id) ||
    isAdmin(req.employee);
  const task = await Task.findOne({
    _id: req.params.taskId,
    project: project._id,
  });
  if (!task) return res.status(404).json({ error: "Not found" });
  const { title, description, status, assignedTo, priority } = req.body;
  const prevAssignee = String(task.assignedTo);
  // Status updates: only the assignee may change status
  if (status !== undefined) {
    const isAssignee = String(task.assignedTo) === String(req.employee.id);
    if (!isAssignee)
      return res.status(403).json({ error: "Only assignee may update status" });
    task.status = status;
  }

  // Core fields (title/description/assignee): team lead or admin only
  if (
    title !== undefined ||
    description !== undefined ||
    assignedTo !== undefined ||
    priority !== undefined ||
    req.body.estimatedTimeMinutes !== undefined ||
    req.body.estimatedHours !== undefined ||
    req.body.estimatedTimeHours !== undefined
  ) {
    if (!isLeadOrAdmin) return res.status(403).json({ error: "Forbidden" });
  }
  if (title !== undefined) task.title = title;
  if (description !== undefined) task.description = description;
  if (assignedTo !== undefined) {
    const allowed = [
      String(project.teamLead),
      ...(project.members || []).map((m) => String(m)),
    ];
    if (!allowed.includes(String(assignedTo)))
      return res.status(400).json({ error: "Assignee not in project" });
    task.assignedTo = assignedTo;
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
  res.json({ task });

  // If assignee changed, notify the new assignee
  if (assignedTo !== undefined && String(assignedTo) !== prevAssignee) {
    (async () => {
      try {
        const companyId = project.company;
        if (!(await isEmailEnabled(companyId))) return;
        const assignee = await Employee.findById(assignedTo)
          .select("name email")
          .lean();
        if (!assignee?.email) return;
        const sub = `Task Reassigned: ${task.title}`;
        const safeDesc = task.description
          ? String(task.description).replace(/</g, "&lt;")
          : "";
        const html = `
          <div style=\"font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height:1.5;\">
            <h2 style=\"margin:0 0 12px;\">A task has been assigned to you</h2>
            <p><strong>Task:</strong> ${task.title}</p>
            ${
              safeDesc ? `<p><strong>Description:</strong> ${safeDesc}</p>` : ""
            }
            <p><strong>Project:</strong> ${project.title}</p>
            <p><strong>Assigned By:</strong> ${
              req.employee.name || "Project Lead"
            }</p>
            <p style=\"margin-top:16px; color:#666; font-size:12px;\">This is an automated notification from HRMS.</p>
          </div>
        `;
        await sendMail({
          companyId,
          to: assignee.email,
          subject: sub,
          html,
          text: `You have been assigned the task: ${task.title} (Project: ${project.title})`,
        });
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
  if (
    String(project.teamLead) !== String(req.employee.id) &&
    !isAdmin(req.employee)
  )
    return res.status(403).json({ error: "Forbidden" });
  const task = await Task.findOne({
    _id: req.params.taskId,
    project: project._id,
  });
  if (!task) return res.status(404).json({ error: "Not found" });
  await task.deleteOne();
  res.json({ success: true });
});

// Add a comment to a task - project member or admin
router.post("/:id/tasks/:taskId/comments", auth, async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (!isProjectMember(req.employee, project) && !isAdmin(req.employee))
    return res.status(403).json({ error: "Forbidden" });
  const task = await Task.findOne({
    _id: req.params.taskId,
    project: project._id,
  });
  if (!task) return res.status(404).json({ error: "Task not found" });
  const { text } = req.body;
  if (!text || !String(text).trim())
    return res.status(400).json({ error: "Empty comment" });
  task.comments.push({ author: req.employee.id, text });
  await task.save();
  const latest = task.comments[task.comments.length - 1];
  res.json({ comment: latest, taskId: task._id });
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
  if (!isProjectMember(req.employee, project) && !isAdmin(req.employee))
    return res.status(403).json({ error: "Forbidden" });
  const task = await Task.findOne({
    _id: req.params.taskId,
    project: project._id,
  });
  if (!task) return res.status(404).json({ error: "Task not found" });
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
  const note = req.body.note;

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
  res.json({
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
  if (!isProjectMember(req.employee, project) && !isAdmin(req.employee))
    return res.status(403).json({ error: "Forbidden" });
  const task = await Task.findOne({
    _id: req.params.taskId,
    project: project._id,
  });
  if (!task) return res.status(404).json({ error: "Task not found" });

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
  const note = req.body.note;

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
        employee: req.employee.id,
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
      return res
        .status(500)
        .json({ error: "Failed to validate daily time cap" });
    }
  }

  // Push time log with createdAt set to the middle of the target day for clarity
  const createdAt = new Date(start.getTime() + 12 * 60 * 60 * 1000);
  task.timeLogs.push({ minutes, note, addedBy: req.employee.id, createdAt });
  task.timeSpentMinutes = (task.timeSpentMinutes || 0) + minutes;
  await task.save();
  res.json({
    timeSpentMinutes: task.timeSpentMinutes,
    latest: task.timeLogs[task.timeLogs.length - 1],
    taskId: task._id,
  });
});

// Set total time on a task (replace), without altering historical logs
// Allows reducing or increasing the total; members or admins only
router.put("/:id/tasks/:taskId/time", auth, async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (!isProjectMember(req.employee, project) && !isAdmin(req.employee))
    return res.status(403).json({ error: "Forbidden" });
  const task = await Task.findOne({
    _id: req.params.taskId,
    project: project._id,
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

  task.timeSpentMinutes = totalMinutes;
  await task.save();
  res.json({ timeSpentMinutes: task.timeSpentMinutes, taskId: task._id });
});

module.exports = router;
