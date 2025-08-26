import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../lib/api";

type Employee = {
  id: string;
  name: string;
  email: string;
  documents: string[];
};

export default function EmployeeDetails() {
  const { id } = useParams();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const res = await api.get(`/documents/${id}`);
        setEmployee(res.data.employee);
      } catch (e: any) {
        setErr(e?.response?.data?.error || "Failed to load employee");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  const base = import.meta.env.VITE_API_URL || "http://localhost:4000";

  if (loading) return <div>Loading…</div>;
  if (err) return <div className="text-error">{err}</div>;
  if (!employee) return <div>Not found</div>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-3xl font-bold">{employee.name}</h2>
        <p className="text-sm text-muted">{employee.email}</p>
      </div>
      <section>
        <h3 className="font-semibold mb-2">Documents</h3>
        {employee.documents?.length === 0 ? (
          <div className="text-sm text-muted">No documents uploaded.</div>
        ) : (
          <ul className="list-disc pl-6 space-y-1">
            {employee.documents.map((d) => (
              <li key={d}>
                <a
                  href={`${base}/uploads/${d}`}
                  target="_blank"
                  className="text-primary underline"
                >
                  {d}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

