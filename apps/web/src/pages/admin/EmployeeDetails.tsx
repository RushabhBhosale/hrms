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
  const [month, setMonth] = useState(
    new Date().toISOString().slice(0, 7)
  );
  const [report, setReport] = useState<{ workedDays: number; leaveDays: number } | null>(
    null
  );
  const [rLoading, setRLoading] = useState(false);
  const [rErr, setRErr] = useState<string | null>(null);

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

  useEffect(() => {
    async function loadReport() {
      if (!id) return;
      try {
        setRLoading(true);
        const res = await api.get(`/attendance/report/${id}`, {
          params: { month },
        });
        setReport(res.data.report);
      } catch (e: any) {
        setRErr(e?.response?.data?.error || "Failed to load report");
      } finally {
        setRLoading(false);
      }
    }
    loadReport();
  }, [id, month]);

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
      <section className="space-y-4">
        <h3 className="font-semibold">Monthly Report</h3>
        {rErr && (
          <div className="text-sm text-error">{rErr}</div>
        )}
        <div className="flex items-center gap-4">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
          />
          {rLoading && <div className="text-sm text-muted">Loading…</div>}
        </div>
        {report && !rLoading && (
          <div className="text-sm">
            Worked Days: {report.workedDays}, Leave Days: {report.leaveDays}
          </div>
        )}
      </section>
    </div>
  );
}

