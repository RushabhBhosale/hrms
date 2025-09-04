import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { Th, Td } from '../../components/ui/Table';

type Task = {
  _id: string;
  title: string;
  description?: string;
  assignedTo: string;
  status: 'PENDING' | 'INPROGRESS' | 'DONE';
  timeSpentMinutes?: number;
  project: { _id: string; title: string } | string;
  updatedAt?: string;
  priority?: 'URGENT' | 'FIRST' | 'SECOND' | 'LEAST';
  timeLogs?: { minutes: number; note?: string; createdAt: string }[];
};

export default function MyTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Track hours to add to a task (adds a log entry; does not replace total)
  const [timeEntry, setTimeEntry] = useState<Record<string, { hours?: string; minutes?: string }>>({});
  const [statusFilter, setStatusFilter] = useState<'ALL' | Task['status']>('ALL');
  const [projectFilter, setProjectFilter] = useState<'ALL' | string>('ALL');
  const [view, setView] = useState<'CARD' | 'TABLE'>('TABLE');
  const [msg, setMsg] = useState<Record<string, { ok?: string; err?: string }>>({});

  async function load() {
    try {
      setErr(null);
      setLoading(true);
      const res = await api.get('/projects/tasks/assigned');
      setTasks(res.data.tasks || []);
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const projectOptions = useMemo(() => {
    const map = new Map<string, string>();
    tasks.forEach((t) => {
      const p = t.project as any;
      const id = typeof p === 'string' ? p : p?._id;
      const title = typeof p === 'string' ? p : p?.title || 'Untitled';
      if (id) map.set(String(id), title);
    });
    return Array.from(map.entries()).map(([id, title]) => ({ id, title }));
  }, [tasks]);

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      const okStatus = statusFilter === 'ALL' ? true : t.status === statusFilter;
      const pid = typeof t.project === 'string' ? t.project : t.project?._id;
      const okProject = projectFilter === 'ALL' ? true : String(pid) === String(projectFilter);
      return okStatus && okProject;
    });
  }, [tasks, statusFilter, projectFilter]);

  async function updateStatus(t: Task, status: Task['status']) {
    try {
      const projectId = typeof t.project === 'string' ? t.project : t.project._id;
      await api.put(`/projects/${projectId}/tasks/${t._id}`, { status });
      await load();
    } catch (e) {
      // ignore, load will reflect errors if any
    }
  }

  async function saveTime(t: Task) {
    const entry = timeEntry[t._id];
    const hours = parseFloat(entry?.hours || '0');
    const minsOnly = parseInt(entry?.minutes || '0', 10);
    const addMinutes = Math.max(0, Math.round((isNaN(hours) ? 0 : hours) * 60) + (Number.isFinite(minsOnly) ? minsOnly : 0));
    if (!addMinutes || addMinutes <= 0) {
      setMsg((m) => ({ ...m, [t._id]: { err: 'Enter time to add (hours and/or minutes)' } }));
      return;
    }
    const projectId = typeof t.project === 'string' ? t.project : t.project._id;
    try {
      // Add time to this task for today (validated against attendance cap server-side)
      await api.post(`/projects/${projectId}/tasks/${t._id}/time`, { minutes: addMinutes });
      setTimeEntry((s) => ({ ...s, [t._id]: { hours: '', minutes: '' } }));
      setMsg((m) => ({ ...m, [t._id]: { ok: 'Time added' } }));
      await load();
    } catch (e: any) {
      const apiErr = e?.response?.data?.error;
      const txt =
        apiErr ||
        'Failed to add time. Ensure you have remaining time today and are a member of this project.';
      setMsg((m) => ({ ...m, [t._id]: { err: txt } }));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <h2 className="text-xl font-semibold">My Tasks</h2>
        <div className="flex flex-wrap gap-2">
          <select
            className="h-9 rounded border border-border bg-bg px-2 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
          >
            <option value="ALL">All Status</option>
            <option value="PENDING">Pending</option>
            <option value="INPROGRESS">In Progress</option>
            <option value="DONE">Done</option>
          </select>
          <select
            className="h-9 rounded border border-border bg-bg px-2 text-sm"
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value as any)}
          >
            <option value="ALL">All Projects</option>
            {projectOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
          <div className="inline-flex rounded-md border border-border overflow-hidden">
            <button
              className={`h-9 px-3 text-sm ${view === 'CARD' ? 'bg-primary text-white' : 'bg-surface'}`}
              onClick={() => setView('CARD')}
            >
              Cards
            </button>
            <button
              className={`h-9 px-3 text-sm border-l border-border ${view === 'TABLE' ? 'bg-primary text-white' : 'bg-surface'}`}
              onClick={() => setView('TABLE')}
            >
              Table
            </button>
          </div>
        </div>
      </div>

      {err && (
        <div className="rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
          {err}
        </div>
      )}

      {view === 'CARD' ? (
        <div className="space-y-3">
          {loading && <div className="text-sm text-muted">Loading…</div>}
          {!loading && filtered.length === 0 && (
            <div className="text-sm text-muted">No tasks assigned.</div>
          )}
          {filtered.map((t) => (
            <div key={t._id} className="border border-border bg-surface rounded-md p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-muted">
                    {typeof t.project === 'string' ? t.project : t.project?.title}
                  </div>
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
                  <div className="mt-2 text-xs text-muted">
                    Time spent: {Math.round(((t.timeSpentMinutes || 0) / 60) * 100) / 100} h
                  </div>
                </div>
                <select
                  className="h-9 rounded border border-border bg-bg px-2 text-sm"
                  value={t.status}
                  onChange={(e) => updateStatus(t, e.target.value as Task['status'])}
                >
                  <option value="PENDING">Pending</option>
                  <option value="INPROGRESS">In Progress</option>
                  <option value="DONE">Done</option>
                </select>
              </div>

                  <div className="mt-3 grid sm:grid-cols-[160px_120px_120px] gap-2 items-center">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted">Hours</span>
                      <input
                        className="h-9 w-24 rounded border border-border bg-bg px-3 text-sm"
                        type="number"
                        min={0}
                        step={0.25}
                        placeholder="0"
                        value={timeEntry[t._id]?.hours || ''}
                        onChange={(e) => setTimeEntry((s) => ({ ...s, [t._id]: { ...s[t._id], hours: e.target.value } }))}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted">Minutes</span>
                      <input
                        className="h-9 w-24 rounded border border-border bg-bg px-3 text-sm"
                        type="number"
                        min={0}
                        step={5}
                        placeholder="0"
                        value={timeEntry[t._id]?.minutes || ''}
                        onChange={(e) => setTimeEntry((s) => ({ ...s, [t._id]: { ...s[t._id], minutes: e.target.value } }))}
                      />
                    </div>
                    <button
                      onClick={() => saveTime(t)}
                      className="h-9 rounded-md border border-border px-3 text-sm hover:bg-bg disabled:opacity-50"
                      disabled={
                        (!timeEntry[t._id]?.hours && !timeEntry[t._id]?.minutes) ||
                        (parseFloat(timeEntry[t._id]?.hours || '0') <= 0 && parseInt(timeEntry[t._id]?.minutes || '0', 10) <= 0)
                      }
                    >
                      Add Time
                    </button>
                  </div>
              {msg[t._id]?.err && (
                <div className="mt-2 text-xs text-error">{msg[t._id]?.err}</div>
              )}
              {msg[t._id]?.ok && (
                <div className="mt-2 text-xs text-success">{msg[t._id]?.ok}</div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <section className="rounded-lg border border-border bg-surface shadow-sm overflow-hidden">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg">
                <tr className="text-left">
                  <Th>Project</Th>
                  <Th>Title</Th>
                  <Th>Status</Th>
                  <Th>Priority</Th>
                  <Th>Time Spent</Th>
                  <Th>Update</Th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-10 text-center text-muted">
                      Loading…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-10 text-center text-muted">
                      No tasks assigned.
                    </td>
                  </tr>
                ) : (
                  filtered.map((t) => {
                    const projectTitle =
                      typeof t.project === 'string' ? t.project : t.project?.title;
                    const totalHours = Math.round(((t.timeSpentMinutes || 0) / 60) * 100) / 100;
                    return (
                      <tr key={t._id} className="border-t border-border/70 hover:bg-bg/60 transition-colors">
                        <Td className="whitespace-nowrap text-muted">{projectTitle}</Td>
                        <Td>
                          <div className="max-w-[32rem] truncate font-medium" title={t.title}>{t.title}</div>
                        </Td>
                        <Td>
                          <select
                            className="h-8 rounded border border-border bg-bg px-2 text-xs"
                            value={t.status}
                            onChange={(e) => updateStatus(t, e.target.value as Task['status'])}
                          >
                            <option value="PENDING">Pending</option>
                            <option value="INPROGRESS">In Progress</option>
                            <option value="DONE">Done</option>
                          </select>
                        </Td>
                        <Td>
                          {t.priority ? (
                            <span className="text-xs px-2 py-0.5 rounded border border-border bg-bg">
                              {t.priority === 'URGENT'
                                ? 'Urgent'
                                : t.priority === 'FIRST'
                                ? 'First'
                                : t.priority === 'SECOND'
                                ? 'Second'
                                : 'Least'}
                            </span>
                          ) : (
                            <span className="text-xs text-muted">-</span>
                          )}
                        </Td>
                        <Td>{totalHours} h</Td>
                        <Td>
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-muted">H</span>
                              <input
                                className="h-8 w-20 rounded border border-border bg-bg px-2 text-xs"
                                type="number"
                                min={0}
                                step={0.25}
                                placeholder="0"
                                value={timeEntry[t._id]?.hours || ''}
                                onChange={(e) => setTimeEntry((s) => ({ ...s, [t._id]: { ...s[t._id], hours: e.target.value } }))}
                              />
                              <span className="text-[11px] text-muted">M</span>
                              <input
                                className="h-8 w-20 rounded border border-border bg-bg px-2 text-xs"
                                type="number"
                                min={0}
                                step={5}
                                placeholder="0"
                                value={timeEntry[t._id]?.minutes || ''}
                                onChange={(e) => setTimeEntry((s) => ({ ...s, [t._id]: { ...s[t._id], minutes: e.target.value } }))}
                              />
                            </div>
                            <button
                              onClick={() => saveTime(t)}
                              className="h-8 rounded-md border border-border px-2 text-xs hover:bg-bg disabled:opacity-50"
                              disabled={
                                (!timeEntry[t._id]?.hours && !timeEntry[t._id]?.minutes) ||
                                (parseFloat(timeEntry[t._id]?.hours || '0') <= 0 && parseInt(timeEntry[t._id]?.minutes || '0', 10) <= 0)
                              }
                            >
                              Add
                            </button>
                          </div>
                          {msg[t._id]?.err && (
                            <div className="mt-1 text-[11px] text-error">{msg[t._id]?.err}</div>
                          )}
                          {msg[t._id]?.ok && (
                            <div className="mt-1 text-[11px] text-success">{msg[t._id]?.ok}</div>
                          )}
                        </Td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile stacked list */}
          <div className="md:hidden divide-y divide-border">
            {loading ? (
              <div className="px-4 py-10 text-center text-muted">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="px-4 py-10 text-center text-muted">No tasks assigned.</div>
            ) : (
              filtered.map((t) => {
                const projectTitle =
                  typeof t.project === 'string' ? t.project : t.project?.title;
                const totalHours = Math.round(((t.timeSpentMinutes || 0) / 60) * 100) / 100;
                return (
                  <div key={t._id} className="p-4 space-y-2">
                    <div className="text-xs text-muted">{projectTitle}</div>
                    <div className="font-medium">{t.title}</div>
                    <div className="flex items-center gap-2">
                      <select
                        className="h-8 rounded border border-border bg-bg px-2 text-xs"
                        value={t.status}
                        onChange={(e) => updateStatus(t, e.target.value as Task['status'])}
                      >
                        <option value="PENDING">Pending</option>
                        <option value="INPROGRESS">In Progress</option>
                        <option value="DONE">Done</option>
                      </select>
                      <span className="text-xs text-muted">{totalHours} h</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        className="h-8 w-28 rounded border border-border bg-bg px-2 text-xs"
                        type="number"
                        min={0}
                        step={0.1}
                        placeholder="Add hours (today)"
                        value={timeEntry[t._id]?.hours || ''}
                        onChange={(e) => setTimeEntry((s) => ({ ...s, [t._id]: { hours: e.target.value } }))}
                      />
                      <button
                        onClick={() => saveTime(t)}
                        className="h-8 rounded-md border border-border px-2 text-xs hover:bg-bg disabled:opacity-50"
                        disabled={
                          timeEntry[t._id]?.hours === undefined ||
                          timeEntry[t._id]?.hours === '' ||
                          parseFloat(timeEntry[t._id]?.hours || '0') <= 0
                        }
                      >
                        Add
                      </button>
                    </div>
                    {msg[t._id]?.err && (
                      <div className="mt-1 text-[11px] text-error">{msg[t._id]?.err}</div>
                    )}
                    {msg[t._id]?.ok && (
                      <div className="mt-1 text-[11px] text-success">{msg[t._id]?.ok}</div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>
      )}
    </div>
  );
}
