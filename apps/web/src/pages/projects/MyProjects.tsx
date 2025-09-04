import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { Link } from 'react-router-dom';

type Project = {
  _id: string;
  title: string;
  description?: string;
  techStack?: string[];
  teamLead: string;
  members: string[];
  estimatedTimeMinutes?: number;
  createdAt?: string;
};

type EmployeeLite = { id: string; name: string; email: string };

export default function MyProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [projRes, empRes] = await Promise.all([
        api.get('/projects'),
        api.get('/companies/employees'),
      ]);
      setProjects(projRes.data.projects || []);
      setEmployees(empRes.data.employees || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const empMap = useMemo(() => new Map(employees.map((e) => [e.id, e.name])), [employees]);

  function minutesToHours(min: number) {
    return Math.round((min / 60) * 10) / 10;
  }

  function fmtDate(s?: string) {
    if (!s) return '-';
    const d = new Date(s);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Projects</h2>

      <div className="grid gap-3">
        {projects.map((p) => (
          <div key={p._id} className="border border-border bg-surface rounded-md p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold">{p.title}</div>
                {p.description && <div className="text-sm text-muted mt-1">{p.description}</div>}
                {!!(p.techStack?.length) && (
                  <div className="mt-2 text-xs text-muted">Tech: {p.techStack?.join(', ')}</div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
                  <span className="text-muted">Start: {fmtDate(p.createdAt)}</span>
                  <span className="text-muted">Est: {minutesToHours(p.estimatedTimeMinutes || 0)} h</span>
                  <span className="text-muted">Lead: {empMap.get(String(p.teamLead)) || '—'}</span>
                  <span className="text-muted">Members: {p.members?.length || 0}</span>
                </div>
              </div>
              <Link
                to={`/app/projects/${p._id}`}
                className="h-9 px-3 rounded-md border border-border hover:bg-bg inline-flex items-center"
              >
                Open
              </Link>
            </div>
          </div>
        ))}
        {projects.length === 0 && !loading && (
          <div className="text-sm text-muted">No projects found.</div>
        )}
      </div>
    </div>
  );
}
