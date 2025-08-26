import { useEffect, useState, FormEvent } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../lib/api";

type Employee = {
  id: string;
  name: string;
  email: string;
  documents: string[];
  reportingPerson?: { id: string; name: string } | null;
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
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([]);
  const [reportingPerson, setReportingPerson] = useState("");
  const [uLoading, setULoading] = useState(false);
  const [uErr, setUErr] = useState<string | null>(null);
  const [uOk, setUOk] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const res = await api.get(`/documents/${id}`);
        setEmployee(res.data.employee);
        setReportingPerson(res.data.employee.reportingPerson?.id || "");
      } catch (e: any) {
        setErr(e?.response?.data?.error || "Failed to load employee");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/companies/employees");
        setEmployees(res.data.employees || []);
      } catch {
        // ignore
      }
    })();
  }, []);

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

  async function updateReporting(e: FormEvent) {
    e.preventDefault();
    if (!id) return;
    try {
      setULoading(true);
      setUErr(null);
      setUOk(null);
      await api.put(`/companies/employees/${id}/reporting`, {
        reportingPerson,
      });
      setUOk("Reporting person updated");
    } catch (e: any) {
      setUErr(e?.response?.data?.error || "Failed to update");
    } finally {
      setULoading(false);
    }
  }

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
      <section className="space-y-2">
        <h3 className="font-semibold">Reporting Person</h3>
        {uErr && (
          <div className="text-sm text-error">{uErr}</div>
        )}
        {uOk && (
          <div className="text-sm text-success">{uOk}</div>
        )}
        <form onSubmit={updateReporting} className="flex items-center gap-2">
          <select
            value={reportingPerson}
            onChange={(e) => setReportingPerson(e.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">None</option>
            {employees
              .filter((e) => e.id !== id)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
          </select>
          <button
            type="submit"
            disabled={uLoading}
            className="rounded-md bg-primary px-4 py-2 text-white disabled:opacity-50"
          >
            {uLoading ? "Saving…" : "Save"}
          </button>
        </form>
      </section>
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

