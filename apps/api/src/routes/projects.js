const router = require('express').Router();
const { auth } = require('../middleware/auth');
const { requirePrimary } = require('../middleware/roles');
const Project = require('../models/Project');
const Task = require('../models/Task');
const Employee = require('../models/Employee');

function isAdmin(emp) {
  return ['ADMIN', 'SUPERADMIN'].includes(emp.primaryRole);
}

function canViewProject(emp, project) {
  const hr = (emp.subRoles || []).includes('hr');
  const member =
    String(project.teamLead) === String(emp.id) ||
    (project.members || []).map((m) => String(m)).includes(String(emp.id));
  return isAdmin(emp) || hr || member;
}

function isProjectMember(emp, project) {
  return (
    String(project.teamLead) === String(emp.id) ||
    (project.members || []).map((m) => String(m)).includes(String(emp.id))
  );
}

// Create project - admin only
router.post('/', auth, requirePrimary(['ADMIN', 'SUPERADMIN']), async (req, res) => {
  try {
    const { title, description, techStack, teamLead, members } = req.body;
    const project = await Project.create({
      title,
      description,
      techStack,
      teamLead,
      members,
      company: req.employee.company,
    });
    res.json({ project });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// List projects visible to the user
router.get('/', auth, async (req, res) => {
  const isAdminUser = isAdmin(req.employee);
  const isHr = (req.employee.subRoles || []).includes('hr');
  const query = isAdminUser || isHr
    ? { company: req.employee.company }
    : {
        company: req.employee.company,
        $or: [
          { teamLead: req.employee.id },
          { members: req.employee.id },
        ],
      };
  const projects = await Project.find(query).lean();
  res.json({ projects });
});

// Assigned tasks for current user across company projects
// Must be declared before parameterized routes like "/:id"
router.get('/tasks/assigned', auth, async (req, res) => {
  try {
    // Limit to tasks within the same company
    const projects = await Project.find({ company: req.employee.company }).select('_id').lean();
    const projectIds = projects.map((p) => p._id);
    const tasks = await Task.find({
      project: { $in: projectIds },
      assignedTo: req.employee.id,
    })
      .populate('project', 'title')
      .lean();
    res.json({ tasks });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load assigned tasks' });
  }
});

// Get single project
router.get('/:id', auth, async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });
  if (!canViewProject(req.employee, project))
    return res.status(403).json({ error: 'Forbidden' });
  res.json({ project });
});

// List project members with minimal fields
router.get('/:id/members', auth, async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!canViewProject(req.employee, project)) return res.status(403).json({ error: 'Forbidden' });
  const ids = [project.teamLead, ...(project.members || [])];
  const people = await Employee.find({ _id: { $in: ids } })
    .select('name email subRoles')
    .lean();
  const map = new Map(people.map((p) => [String(p._id), p]));
  const ordered = ids
    .map((id) => {
      const p = map.get(String(id));
      if (!p) return null;
      return { id: p._id, name: p.name, email: p.email, subRoles: p.subRoles || [] };
    })
    .filter(Boolean);
  res.json({ members: ordered });
});

// Update project - admin only
router.put('/:id', auth, requirePrimary(['ADMIN', 'SUPERADMIN']), async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const { title, description, techStack, teamLead, members } = req.body;
  if (title !== undefined) project.title = title;
  if (description !== undefined) project.description = description;
  if (techStack !== undefined) project.techStack = techStack;
  if (teamLead !== undefined) project.teamLead = teamLead;
  if (members !== undefined) project.members = members;
  await project.save();
  res.json({ project });
});

// Delete project - admin only
router.delete('/:id', auth, requirePrimary(['ADMIN', 'SUPERADMIN']), async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });
  await Task.deleteMany({ project: project._id });
  await project.deleteOne();
  res.json({ success: true });
});

// Create task within project
router.post('/:id/tasks', auth, async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });
  // Allow any project member or admin to create tasks
  if (!isProjectMember(req.employee, project) && !isAdmin(req.employee))
    return res.status(403).json({ error: 'Forbidden' });
  const { title, description, assignedTo } = req.body;
  const allowed = [String(project.teamLead), ...(project.members || []).map((m) => String(m))];
  if (!allowed.includes(String(assignedTo)))
    return res.status(400).json({ error: 'Assignee not in project' });
  const task = await Task.create({
    project: project._id,
    title,
    description,
    assignedTo,
    createdBy: req.employee.id,
  });
  res.json({ task });
});

// List tasks for a project
router.get('/:id/tasks', auth, async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });
  if (!canViewProject(req.employee, project))
    return res.status(403).json({ error: 'Forbidden' });
  const isHrOrManager = (req.employee.subRoles || []).some((r) => r === 'hr' || r === 'manager');
  const isPrivileged = isAdmin(req.employee) || isHrOrManager;
  const baseQuery = { project: project._id };
  const query = isPrivileged ? baseQuery : { ...baseQuery, assignedTo: req.employee.id };
  const tasks = await Task.find(query).lean();
  res.json({ tasks });
});

// Update a task
router.put('/:id/tasks/:taskId', auth, async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const isLeadOrAdmin = String(project.teamLead) === String(req.employee.id) || isAdmin(req.employee);
  const task = await Task.findOne({ _id: req.params.taskId, project: project._id });
  if (!task) return res.status(404).json({ error: 'Not found' });
  const { title, description, status, assignedTo } = req.body;
  // Status updates: only the assignee may change status
  if (status !== undefined) {
    const isAssignee = String(task.assignedTo) === String(req.employee.id);
    if (!isAssignee) return res.status(403).json({ error: 'Only assignee may update status' });
    task.status = status;
  }

  // Core fields (title/description/assignee): team lead or admin only
  if (title !== undefined || description !== undefined || assignedTo !== undefined) {
    if (!isLeadOrAdmin) return res.status(403).json({ error: 'Forbidden' });
  }
  if (title !== undefined) task.title = title;
  if (description !== undefined) task.description = description;
  if (assignedTo !== undefined) {
    const allowed = [String(project.teamLead), ...(project.members || []).map((m) => String(m))];
    if (!allowed.includes(String(assignedTo)))
      return res.status(400).json({ error: 'Assignee not in project' });
    task.assignedTo = assignedTo;
  }
  await task.save();
  res.json({ task });
});

// Delete a task - team lead or admin
router.delete('/:id/tasks/:taskId', auth, async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (String(project.teamLead) !== String(req.employee.id) && !isAdmin(req.employee))
    return res.status(403).json({ error: 'Forbidden' });
  const task = await Task.findOne({ _id: req.params.taskId, project: project._id });
  if (!task) return res.status(404).json({ error: 'Not found' });
  await task.deleteOne();
  res.json({ success: true });
});

// Add a comment to a task - project member or admin
router.post('/:id/tasks/:taskId/comments', auth, async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!isProjectMember(req.employee, project) && !isAdmin(req.employee))
    return res.status(403).json({ error: 'Forbidden' });
  const task = await Task.findOne({ _id: req.params.taskId, project: project._id });
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const { text } = req.body;
  if (!text || !String(text).trim()) return res.status(400).json({ error: 'Empty comment' });
  task.comments.push({ author: req.employee.id, text });
  await task.save();
  const latest = task.comments[task.comments.length - 1];
  res.json({ comment: latest, taskId: task._id });
});

// List comments on a task - visible to project viewers
router.get('/:id/tasks/:taskId/comments', auth, async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!canViewProject(req.employee, project)) return res.status(403).json({ error: 'Forbidden' });
  const task = await Task.findOne({ _id: req.params.taskId, project: project._id }).lean();
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json({ comments: task.comments || [] });
});

// Add time log to a task - project member or admin
router.post('/:id/tasks/:taskId/time', auth, async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!isProjectMember(req.employee, project) && !isAdmin(req.employee))
    return res.status(403).json({ error: 'Forbidden' });
  const task = await Task.findOne({ _id: req.params.taskId, project: project._id });
  if (!task) return res.status(404).json({ error: 'Task not found' });
  // Accept either hours (preferred) or minutes for backward compatibility
  let minutes = 0;
  if (req.body.hours !== undefined) {
    const h = parseFloat(req.body.hours);
    if (!isFinite(h) || h <= 0) return res.status(400).json({ error: 'Invalid hours' });
    minutes = Math.round(h * 60);
  } else {
    minutes = parseInt(req.body.minutes, 10);
    if (!minutes || minutes <= 0) return res.status(400).json({ error: 'Invalid minutes' });
  }
  const note = req.body.note;
  task.timeLogs.push({ minutes, note, addedBy: req.employee.id });
  task.timeSpentMinutes = (task.timeSpentMinutes || 0) + minutes;
  await task.save();
  res.json({
    timeSpentMinutes: task.timeSpentMinutes,
    latest: task.timeLogs[task.timeLogs.length - 1],
    taskId: task._id,
  });
});

module.exports = router;
