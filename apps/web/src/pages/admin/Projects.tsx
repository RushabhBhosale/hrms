import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { getEmployee } from '../../lib/auth';
import { Link, useNavigate } from 'react-router-dom';

type EmployeeLite = { id: string; name: string; email: string; subRoles: string[] };
type Project = {
  _id: string;
  title: string;
  description?: string;
  techStack?: string[];
  teamLead: string;
  members: string[];
};

export default function ProjectsAdmin() {
  const nav = useNavigate();
  const u = getEmployee();
  const [loading, setLoading] = useState(false);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tech, setTech] = useState('');
  const [teamLead, setTeamLead] = useState('');
  const [members, setMembers] = useState<string[]>([]);

  const teamLeadOptions = useMemo(() => {
    // prefer HR or manager as team lead
    const priority = employees.filter((e) => e.subRoles?.some((r) => r === 'hr' || r === 'manager'));
    const others = employees.filter((e) => !e.subRoles?.some((r) => r === 'hr' || r === 'manager'));
    return [...priority, ...others];
  }, [employees]);

  async function load() {
    setLoading(true);
    try {
      const [emps, projs] = await Promise.all([
        api.get('/companies/employees'),
        api.get('/projects'),
      ]);
      setEmployees(emps.data.employees || []);
      setProjects(projs.data.projects || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    if (!title || !teamLead) return;
    setLoading(true);
    try {
      const techStack = tech
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      await api.post('/projects', { title, description, techStack, teamLead, members });
      setTitle('');
      setDescription('');
      setTech('');
      setTeamLead('');
      setMembers([]);
      await load();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Projects</h2>
      </div>

      {/* Create form */}
      <form onSubmit={createProject} className="space-y-4 bg-surface border border-border rounded-md p-4">
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm mb-1">Title</label>
            <input
              className="w-full h-10 rounded border border-border bg-bg px-3"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Project title"
              required
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Tech Stack</label>
            <input
              className="w-full h-10 rounded border border-border bg-bg px-3"
              value={tech}
              onChange={(e) => setTech(e.target.value)}
              placeholder="e.g. React, Node, MongoDB"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm mb-1">Description</label>
            <textarea
              className="w-full rounded border border-border bg-bg px-3 py-2 min-h-20"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm mb-1">Team Lead</label>
            <select
              className="w-full h-10 rounded border border-border bg-bg px-3"
              value={teamLead}
              onChange={(e) => setTeamLead(e.target.value)}
              required
            >
              <option value="">Select team lead</option>
              {teamLeadOptions.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.subRoles?.[0] || 'employee'})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm mb-1">Members</label>
            <div className="grid grid-cols-2 gap-2 max-h-40 overflow-auto border border-border rounded p-2 bg-bg">
              {employees.map((e) => (
                <label key={e.id} className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={members.includes(e.id)}
                    onChange={(ev) =>
                      setMembers((prev) =>
                        ev.target.checked ? [...prev, e.id] : prev.filter((id) => id !== e.id)
                      )
                    }
                  />
                  <span>
                    {e.name} <span className="text-muted">({e.subRoles?.[0] || 'employee'})</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            className="inline-flex items-center justify-center h-10 px-4 rounded-md bg-primary text-white disabled:opacity-50"
            disabled={loading}
          >
            {loading ? 'Creating…' : 'Create Project'}
          </button>
        </div>
      </form>

      {/* List */}
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
              </div>
              <div className="flex items-center gap-2">
                <Link
                  to={`/admin/projects/${p._id}`}
                  className="h-9 px-3 rounded-md border border-border hover:bg-bg inline-flex items-center"
                >
                  Open
                </Link>
              </div>
            </div>
          </div>
        ))}
        {projects.length === 0 && (
          <div className="text-sm text-muted">No projects yet.</div>
        )}
      </div>
    </div>
  );
}

