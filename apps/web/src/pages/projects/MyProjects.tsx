import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Link } from 'react-router-dom';

type Project = {
  _id: string;
  title: string;
  description?: string;
  techStack?: string[];
};

export default function MyProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get('/projects');
      setProjects(res.data.projects || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">My Projects</h2>

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

