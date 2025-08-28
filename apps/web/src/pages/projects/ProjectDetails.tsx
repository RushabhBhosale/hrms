import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { getEmployee } from '../../lib/auth';

type EmployeeLite = { id: string; name: string; email: string; subRoles: string[] };
type Project = {
  _id: string;
  title: string;
  description?: string;
  techStack?: string[];
  teamLead: string;
  members: string[];
};

type Task = {
  _id: string;
  title: string;
  description?: string;
  assignedTo: string;
  createdBy: string;
  status: 'PENDING' | 'INPROGRESS' | 'DONE';
  comments?: { author: string; text: string; createdAt: string }[];
  timeSpentMinutes?: number;
};

export default function ProjectDetails() {
  const { id } = useParams();
  const me = getEmployee();
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [loading, setLoading] = useState(false);

  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [assignee, setAssignee] = useState('');

  const [commentText, setCommentText] = useState<Record<string, string>>({});
  const [timeEntry, setTimeEntry] = useState<Record<string, { minutes: string; note: string }>>({});

  const memberIds = useMemo(() => {
    if (!project) return [] as string[];
    return [project.teamLead, ...(project.members || [])].map(String);
  }, [project]);

  const members = useMemo(
    () => employees.filter((e) => memberIds.includes(e.id)),
    [employees, memberIds]
  );

  const canCreateTask = useMemo(() => {
    if (!project || !me) return false;
    const isAdmin = me.primaryRole === 'ADMIN' || me.primaryRole === 'SUPERADMIN';
    const isMember = memberIds.includes(me.id);
    return isAdmin || isMember;
  }, [project, me, memberIds]);

  const canCollaborate = canCreateTask; // same rule for comments/time

  async function loadAll() {
    if (!id) return;
    setLoading(true);
    try {
      const [proj, tlist] = await Promise.all([
        api.get(`/projects/${id}`),
        api.get(`/projects/${id}/tasks`),
      ]);
      setProject(proj.data.project);
      setTasks(tlist.data.tasks || []);
      // Try to load full employees list (admin/hr/manager). Fallback to project members only.
      try {
        const emps = await api.get('/companies/employees');
        setEmployees(emps.data.employees || []);
      } catch (e) {
        const mem = await api.get(`/projects/${id}/members`);
        setEmployees(mem.data.members || []);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, [id]);

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !newTitle || !assignee) return;
    setLoading(true);
    try {
      await api.post(`/projects/${id}/tasks`, {
        title: newTitle,
        description: newDesc,
        assignedTo: assignee,
      });
      setNewTitle('');
      setNewDesc('');
      setAssignee('');
      const tlist = await api.get(`/projects/${id}/tasks`);
      setTasks(tlist.data.tasks || []);
    } finally {
      setLoading(false);
    }
  }

  async function addComment(taskId: string) {
    const text = (commentText[taskId] || '').trim();
    if (!text) return;
    await api.post(`/projects/${id}/tasks/${taskId}/comments`, { text });
    setCommentText((s) => ({ ...s, [taskId]: '' }));
    const tlist = await api.get(`/projects/${id}/tasks`);
    setTasks(tlist.data.tasks || []);
  }

  async function addTime(taskId: string) {
    const entry = timeEntry[taskId];
    const minutes = parseInt(entry?.minutes || '0', 10);
    if (!minutes || minutes <= 0) return;
    await api.post(`/projects/${id}/tasks/${taskId}/time`, {
      minutes,
      note: entry?.note || '',
    });
    setTimeEntry((s) => ({ ...s, [taskId]: { minutes: '', note: '' } }));
    const tlist = await api.get(`/projects/${id}/tasks`);
    setTasks(tlist.data.tasks || []);
  }

  async function updateStatus(taskId: string, status: Task['status']) {
    await api.put(`/projects/${id}/tasks/${taskId}`, { status });
    const tlist = await api.get(`/projects/${id}/tasks`);
    setTasks(tlist.data.tasks || []);
  }

  return (
    <div className="space-y-8">
      {project && (
        <div className="bg-surface border border-border rounded-md p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xl font-semibold">{project.title}</div>
              {project.description && (
                <div className="text-sm text-muted mt-1">{project.description}</div>
              )}
              {!!(project.techStack?.length) && (
                <div className="mt-2 text-xs text-muted">Tech: {project.techStack?.join(', ')}</div>
              )}
            </div>
            <Link to=".." relative="path" className="text-sm underline text-accent">
              Back
            </Link>
          </div>
          <div className="mt-3 text-sm">
            <div className="font-medium">Team</div>
            <div className="mt-2 grid sm:grid-cols-2 md:grid-cols-3 gap-2">
              {members.map((m) => (
                <div key={m.id} className="px-3 py-1 rounded border border-border bg-bg">
                  <div className="text-sm">{m.name}</div>
                  <div className="text-xs text-muted">{m.subRoles?.[0] || 'member'}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Create Task */}
      {canCreateTask && (
        <form onSubmit={addTask} className="space-y-3 bg-surface border border-border rounded-md p-4">
          <div className="font-medium">Add Task</div>
          <div className="grid md:grid-cols-2 gap-3">
            <input
              className="h-10 rounded border border-border bg-bg px-3"
              placeholder="Task title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              required
            />
            <select
              className="h-10 rounded border border-border bg-bg px-3"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              required
            >
              <option value="">Assign to...</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <div className="md:col-span-2">
              <textarea
                className="w-full rounded border border-border bg-bg px-3 py-2 min-h-20"
                placeholder="Description (optional)"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
              />
            </div>
          </div>
          <div>
            <button className="h-10 px-4 rounded-md bg-primary text-white disabled:opacity-50" disabled={loading}>
              {loading ? 'Adding…' : 'Add Task'}
            </button>
          </div>
        </form>
      )}

      {/* Tasks list */}
      <div className="space-y-3">
        {tasks.map((t) => (
          <div key={t._id} className="border border-border bg-surface rounded-md p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold">{t.title}</div>
                {t.description && <div className="text-sm text-muted mt-1">{t.description}</div>}
                <div className="mt-2 text-xs text-muted">Time spent: {Math.round(((t.timeSpentMinutes||0)/60)*100)/100} h</div>
              </div>
              <div className="flex items-center gap-2">
                {(() => {
                  const isLeadOrAdmin = me && (me.primaryRole === 'ADMIN' || me.primaryRole === 'SUPERADMIN' || (project && project.teamLead === me.id));
                  const isAssignee = me && String(t.assignedTo) === String(me.id);
                  const canChange = !!(isLeadOrAdmin || isAssignee);
                  return (
                    <select
                      className="h-9 rounded border border-border bg-bg px-2 text-sm disabled:opacity-50"
                      value={t.status}
                      onChange={(e) => updateStatus(t._id, e.target.value as Task['status'])}
                      disabled={!canChange}
                    >
                      <option value="PENDING">Pending</option>
                      <option value="INPROGRESS">In Progress</option>
                      <option value="DONE">Done</option>
                    </select>
                  );
                })()}
              </div>
            </div>

            {/* Add time */}
            <div className="mt-3 grid sm:grid-cols-[140px_1fr_100px] gap-2 items-center">
              <input
                className="h-9 rounded border border-border bg-bg px-3 text-sm"
                type="number"
                min={1}
                placeholder="Minutes"
                value={timeEntry[t._id]?.minutes || ''}
                onChange={(e) =>
                  setTimeEntry((s) => ({ ...s, [t._id]: { minutes: e.target.value, note: s[t._id]?.note || '' } }))
                }
              />
              <input
                className="h-9 rounded border border-border bg-bg px-3 text-sm"
                placeholder="Note (optional)"
                value={timeEntry[t._id]?.note || ''}
                onChange={(e) =>
                  setTimeEntry((s) => ({ ...s, [t._id]: { minutes: s[t._id]?.minutes || '', note: e.target.value } }))
                }
              />
              <button
                onClick={() => addTime(t._id)}
                className="h-9 rounded-md border border-border px-3 text-sm hover:bg-bg disabled:opacity-50"
                disabled={!canCollaborate}
              >
                Add Time
              </button>
            </div>

            {/* Comments */}
            <div className="mt-4">
              <div className="text-sm font-medium">Comments</div>
              <div className="mt-2 space-y-2">
                {(t.comments || []).map((c, idx) => (
                  <div key={idx} className="text-sm border border-border rounded px-3 py-2 bg-bg">
                    <div>{c.text}</div>
                    <div className="text-xs text-muted mt-1">{new Date(c.createdAt).toLocaleString()}</div>
                  </div>
                ))}
                <div className="flex gap-2">
                  <input
                    className="flex-1 h-9 rounded border border-border bg-bg px-3 text-sm"
                    placeholder="Add a comment"
                    value={commentText[t._id] || ''}
                    onChange={(e) => setCommentText((s) => ({ ...s, [t._id]: e.target.value }))}
                  />
                  <button
                    onClick={() => addComment(t._id)}
                    className="h-9 rounded-md border border-border px-3 text-sm hover:bg-bg disabled:opacity-50"
                    disabled={!canCollaborate}
                  >
                    Comment
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
        {tasks.length === 0 && <div className="text-sm text-muted">No tasks yet.</div>}
      </div>
    </div>
  );
}
