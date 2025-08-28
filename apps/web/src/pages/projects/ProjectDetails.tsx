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
  const [timeEntry, setTimeEntry] = useState<Record<string, { hours: string }>>({});
  const [openCommentsFor, setOpenCommentsFor] = useState<string | null>(null);

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

  async function saveTime(taskId: string) {
    const entry = timeEntry[taskId];
    const hours = parseFloat(entry?.hours || '0');
    if (isNaN(hours) || hours <= 0) return;
    // Replace total time for this task
    await api.put(`/projects/${id}/tasks/${taskId}/time`, { hours });
    setTimeEntry((s) => ({ ...s, [taskId]: { hours: '' } }));
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
        {tasks.map((t) => {
          const assigneeName = employees.find((e) => e.id === String(t.assignedTo))?.name;
          const statusLabel = t.status === 'PENDING' ? 'Pending' : t.status === 'INPROGRESS' ? 'In Progress' : 'Done';
          const totalHours = Math.round(((t.timeSpentMinutes || 0) / 60) * 100) / 100;
          return (
            <div key={t._id} className="border border-border bg-surface rounded-md p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
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
                  <div className="mt-2 text-xs text-muted flex gap-4">
                    <span>Assigned to: {assigneeName || 'Member'}</span>
                    <span>Status: {statusLabel}</span>
                    <span>Time spent: {totalHours} h</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setOpenCommentsFor(t._id)}
                    className="h-9 rounded-md border border-border px-3 text-sm hover:bg-bg"
                  >
                    Comments ({(t.comments || []).length || 0})
                  </button>
                </div>
              </div>

              {/* Manual time entry (add hours) */}
              {canCollaborate && (
                <div className="mt-3 grid sm:grid-cols-[140px_120px] gap-2 items-center">
                  <input
                    className="h-9 rounded border border-border bg-bg px-3 text-sm"
                    type="number"
                    min={0}
                    step={0.1}
                    placeholder="Set hours"
                    value={timeEntry[t._id]?.hours || ''}
                    onChange={(e) => setTimeEntry((s) => ({ ...s, [t._id]: { hours: e.target.value } }))}
                  />
                  <button
                    onClick={() => saveTime(t._id)}
                    className="h-9 rounded-md border border-border px-3 text-sm hover:bg-bg disabled:opacity-50"
                    disabled={
                      timeEntry[t._id]?.hours === undefined ||
                      timeEntry[t._id]?.hours === '' ||
                      parseFloat(timeEntry[t._id]?.hours || '0') <= 0
                    }
                  >
                    Save Time
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {tasks.length === 0 && <div className="text-sm text-muted">No tasks yet.</div>}
      </div>

      {/* Comments modal */}
      {openCommentsFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpenCommentsFor(null)} />
          <div className="relative z-10 w-[min(640px,92vw)] max-h-[80vh] overflow-hidden rounded-md border border-border bg-surface">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="font-semibold text-sm">Comments</div>
              <button
                className="h-8 px-3 rounded-md border border-border text-sm hover:bg-bg"
                onClick={() => setOpenCommentsFor(null)}
              >
                Close
              </button>
            </div>
            {(() => {
              const task = tasks.find((x) => x._id === openCommentsFor);
              if (!task) return null;
              return (
                <div className="p-4">
                  <div className="text-sm font-medium mb-2">{task.title}</div>
                  <div className="max-h-[48vh] overflow-y-auto space-y-2 pr-1">
                    {(task.comments || []).length === 0 && (
                      <div className="text-xs text-muted">No comments yet.</div>
                    )}
                    {(task.comments || []).slice(-100).map((c, idx) => {
                      const isMe = String(me?.id) === String(c.author);
                      const authorName = isMe
                        ? 'You'
                        : employees.find((e) => e.id === String(c.author))?.name || 'Member';
                      return (
                        <div key={idx} className={["flex", isMe ? 'justify-end' : 'justify-start'].join(' ')}>
                          <div
                            className={[
                              'rounded-lg px-3 py-2 max-w-[80%] text-sm',
                              isMe ? 'bg-primary text-white' : 'bg-bg border border-border',
                            ].join(' ')}
                          >
                            <div className="text-[11px] opacity-80 mb-0.5">
                              {authorName} • {new Date((c as any).createdAt).toLocaleString()}
                            </div>
                            <div>{(c as any).text}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      className="flex-1 h-9 rounded border border-border bg-bg px-3 text-sm"
                      placeholder="Write a comment…"
                      value={commentText[task._id] || ''}
                      onChange={(e) => setCommentText((s) => ({ ...s, [task._id]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          addComment(task._id);
                        }
                      }}
                    />
                    <button
                      onClick={() => addComment(task._id)}
                      className="h-9 rounded-md border border-border px-3 text-sm hover:bg-bg"
                      disabled={!commentText[task._id] || !commentText[task._id].trim()}
                    >
                      Send
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
