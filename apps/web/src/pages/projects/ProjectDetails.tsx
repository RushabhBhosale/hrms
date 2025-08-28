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
  priority?: 'URGENT' | 'FIRST' | 'SECOND' | 'LEAST';
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
  const [priority, setPriority] = useState<'URGENT' | 'FIRST' | 'SECOND' | 'LEAST'>('SECOND');

  const [commentText, setCommentText] = useState<Record<string, string>>({});
  const [timeEntry, setTimeEntry] = useState<Record<string, { hours: string; note: string }>>({});

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

  const canCollaborate = canCreateTask; // placeholder; will check per-task for assignee only

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
        priority,
      });
      setNewTitle('');
      setNewDesc('');
      setAssignee('');
      setPriority('SECOND');
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
    const hours = parseFloat(entry?.hours || '0');
    if (!hours || hours <= 0) return;
    await api.post(`/projects/${id}/tasks/${taskId}/time`, {
      hours,
      note: entry?.note || '',
    });
    setTimeEntry((s) => ({ ...s, [taskId]: { hours: '', note: '' } }));
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
            <select
              className="h-10 rounded border border-border bg-bg px-3"
              value={priority}
              onChange={(e) => setPriority(e.target.value as any)}
            >
              <option value="URGENT">Urgent</option>
              <option value="FIRST">First Priority</option>
              <option value="SECOND">Second Priority</option>
              <option value="LEAST">Least Priority</option>
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
                {(() => {
                  return (
                    <>
                      <div className="font-semibold flex items-center gap-2">
                        <span>{t.title}</span>
                        {t.priority && (
                          <span className="text-xs px-2 py-0.5 rounded border border-border bg-bg">
                            {t.priority === 'URGENT'
                              ? 'Urgent'
                              : t.priority === 'FIRST'
                              ? 'First Priority'
                              : t.priority === 'SECOND'
                              ? 'Second Priority'
                              : 'Least Priority'}
                          </span>
                        )}
                      </div>
                      {t.description && (
                        <div className="text-sm text-muted mt-1">{t.description}</div>
                      )}
                      <div className="mt-2 text-xs text-muted">Time spent: {Math.round(((t.timeSpentMinutes||0)/60)*100)/100} h</div>
                    </>
                  );
                })()}
              </div>
              <div className="flex items-center gap-2">
                {(() => {
                  const label = t.status === 'PENDING' ? 'Pending' : t.status === 'INPROGRESS' ? 'In Progress' : 'Done';
                  return <span className="text-sm text-muted">Status: {label}</span>;
                })()}
              </div>
            </div>
            {/* Interaction (status/time/comments) intentionally hidden on add-task page to keep it focused */}
          </div>
        ))}
        {tasks.length === 0 && <div className="text-sm text-muted">No tasks yet.</div>}
      </div>
    </div>
  );
}
