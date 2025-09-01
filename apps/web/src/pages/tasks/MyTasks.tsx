import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';

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
  // Keep notes separate from time: only track hours for time entry
  const [timeEntry, setTimeEntry] = useState<Record<string, { hours: string }>>({});
  const [statusFilter, setStatusFilter] = useState<'ALL' | Task['status']>('ALL');
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

  const filtered = useMemo(() => {
    return tasks.filter((t) => (statusFilter === 'ALL' ? true : t.status === statusFilter));
  }, [tasks, statusFilter]);

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
    if (isNaN(hours) || hours <= 0) {
      setMsg((m) => ({ ...m, [t._id]: { err: 'Enter hours (> 0)' } }));
      return;
    }
    const projectId = typeof t.project === 'string' ? t.project : t.project._id;
    try {
      // Replace total time for this task
      await api.put(`/projects/${projectId}/tasks/${t._id}/time`, { hours });
      setTimeEntry((s) => ({ ...s, [t._id]: { hours: '' } }));
      setMsg((m) => ({ ...m, [t._id]: { ok: 'Time updated' } }));
      await load();
    } catch (e: any) {
      const apiErr = e?.response?.data?.error;
      const txt = apiErr || 'Failed to update time. Are you a member of this project?';
      setMsg((m) => ({ ...m, [t._id]: { err: txt } }));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">My Tasks</h2>
        <select
          className="h-9 rounded border border-border bg-bg px-2 text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
        >
          <option value="ALL">All</option>
          <option value="PENDING">Pending</option>
          <option value="INPROGRESS">In Progress</option>
          <option value="DONE">Done</option>
        </select>
      </div>

      {err && (
        <div className="rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
          {err}
        </div>
      )}

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
                {/* Notes are separated from time; hide time-log notes display */}
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
                onClick={() => saveTime(t)}
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
            {msg[t._id]?.err && (
              <div className="mt-2 text-xs text-error">{msg[t._id]?.err}</div>
            )}
            {msg[t._id]?.ok && (
              <div className="mt-2 text-xs text-success">{msg[t._id]?.ok}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
