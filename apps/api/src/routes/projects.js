const router = require('express').Router();
const { auth } = require('../middleware/auth');
const { requirePrimary } = require('../middleware/roles');
const Project = require('../models/Project');
const Task = require('../models/Task');

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

// Get single project
router.get('/:id', auth, async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });
  if (!canViewProject(req.employee, project))
    return res.status(403).json({ error: 'Forbidden' });
  res.json({ project });
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
  if (String(project.teamLead) !== String(req.employee.id) && !isAdmin(req.employee))
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
  const tasks = await Task.find({ project: project._id }).lean();
  res.json({ tasks });
});

// Update a task - team lead or admin
router.put('/:id/tasks/:taskId', auth, async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (String(project.teamLead) !== String(req.employee.id) && !isAdmin(req.employee))
    return res.status(403).json({ error: 'Forbidden' });
  const task = await Task.findOne({ _id: req.params.taskId, project: project._id });
  if (!task) return res.status(404).json({ error: 'Not found' });
  const { title, description, status, assignedTo } = req.body;
  if (title !== undefined) task.title = title;
  if (description !== undefined) task.description = description;
  if (status !== undefined) task.status = status;
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

module.exports = router;
