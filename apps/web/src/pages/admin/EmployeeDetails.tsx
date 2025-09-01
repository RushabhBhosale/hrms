import { useEffect, useState, FormEvent } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";

type Employee = {
  id: string;
  name: string;
  email: string;
  dob?: string;
  documents: string[];
  reportingPerson?: { id: string; name: string } | null;
  subRoles: string[];
  address?: string;
  phone?: string;
  employeeId?: string;
  ctc?: number;
  aadharNumber?: string;
  panNumber?: string;
  bankDetails?: { accountNumber?: string; bankName?: string; ifsc?: string };
};

export default function EmployeeDetails() {
  const { id } = useParams();
  const nav = useNavigate();
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
  const [role, setRole] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [roleLoading, setRoleLoading] = useState(false);
  const [roleErr, setRoleErr] = useState<string | null>(null);
  const [roleOk, setRoleOk] = useState<string | null>(null);

  // Editable fields
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [dobEdit, setDobEdit] = useState("");
  const [ctc, setCtc] = useState<string>("0");
  const [aadhar, setAadhar] = useState("");
  const [pan, setPan] = useState("");
  const [bankAcc, setBankAcc] = useState("");
  const [bankName, setBankName] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const res = await api.get(`/documents/${id}`);
        setEmployee(res.data.employee);
        setReportingPerson(res.data.employee.reportingPerson?.id || "");
        setRole(res.data.employee.subRoles?.[0] || "");
        // Prime edit fields
        setAddress(res.data.employee.address || "");
        setPhone(res.data.employee.phone || "");
        setDobEdit(res.data.employee.dob ? String(res.data.employee.dob).slice(0, 10) : "");
        setCtc(String(res.data.employee.ctc ?? 0));
        setAadhar(res.data.employee.aadharNumber || "");
        setPan(res.data.employee.panNumber || "");
        setBankAcc(res.data.employee.bankDetails?.accountNumber || "");
        setBankName(res.data.employee.bankDetails?.bankName || "");
        setIfsc(res.data.employee.bankDetails?.ifsc || "");
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
      try {
        const r = await api.get("/companies/roles");
        setRoles(r.data.roles || []);
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

  useEffect(() => {
    if (!role && roles.length) setRole(roles[0]);
  }, [roles, role]);

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

  async function updateRole(e: FormEvent) {
    e.preventDefault();
    if (!id) return;
    try {
      setRoleLoading(true);
      setRoleErr(null);
      setRoleOk(null);
      await api.put(`/companies/employees/${id}/role`, { role });
      setRoleOk("Role updated");
      setEmployee((prev) => (prev ? { ...prev, subRoles: [role] } : prev));
    } catch (e: any) {
      setRoleErr(e?.response?.data?.error || "Failed to update role");
    } finally {
      setRoleLoading(false);
    }
  }

  async function saveDetails(e: FormEvent) {
    e.preventDefault();
    if (!id) return;
    try {
      setSaveLoading(true);
      setSaveErr(null);
      setSaveOk(null);
      const payload = {
        address,
        phone,
        dob: dobEdit || undefined,
        ctc: Number(ctc),
        aadharNumber: aadhar,
        panNumber: pan,
        bankDetails: { accountNumber: bankAcc, bankName, ifsc },
      };
      await api.put(`/companies/employees/${id}`, payload);
      setSaveOk("Details updated");
      setEmployee((prev) =>
        prev
          ? {
              ...prev,
              address,
              phone,
              dob: dobEdit || prev.dob,
              ctc: Number(ctc),
              aadharNumber: aadhar,
              panNumber: pan,
              bankDetails: { accountNumber: bankAcc, bankName, ifsc },
            }
          : prev
      );
    } catch (e: any) {
      setSaveErr(e?.response?.data?.error || "Failed to save details");
    } finally {
      setSaveLoading(false);
    }
  }

  async function deleteEmployee() {
    if (!id) return;
    const yes = window.confirm(
      "Delete this employee? This cannot be undone and may be blocked if they have linked data."
    );
    if (!yes) return;
    try {
      await api.delete(`/companies/employees/${id}`);
      nav("/admin/employees");
    } catch (e: any) {
      alert(e?.response?.data?.error || "Failed to delete employee");
    }
  }

  const base = import.meta.env.VITE_API_URL || "http://localhost:4000";

  if (loading) return <div>Loading…</div>;
  if (err) return <div className="text-error">{err}</div>;
  if (!employee) return <div>Not found</div>;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-semibold">{employee.name}</h2>
          <div className="text-sm text-muted">{employee.email}</div>
          {employee.employeeId && (
            <div className="text-xs text-muted mt-1">Employee ID: {employee.employeeId}</div>
          )}
        </div>
        <button
          onClick={deleteEmployee}
          className="h-9 px-3 rounded-md border border-error text-error hover:bg-error/10"
        >
          Delete Employee
        </button>
      </div>

      {/* Details card */}
      <form onSubmit={saveDetails} className="space-y-4 bg-surface border border-border rounded-md p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Personal & Job Details</h3>
          {saveErr && <div className="text-sm text-error">{saveErr}</div>}
          {saveOk && <div className="text-sm text-success">{saveOk}</div>}
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm mb-1">Monthly CTC</label>
            <input
              type="number"
              step="0.01"
              className="w-full h-10 rounded border border-border bg-bg px-3"
              value={ctc}
              onChange={(e) => setCtc(e.target.value)}
              placeholder="0"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Phone</label>
            <input
              className="w-full h-10 rounded border border-border bg-bg px-3"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone number"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Date of Birth</label>
            <input
              type="date"
              className="w-full h-10 rounded border border-border bg-bg px-3"
              value={dobEdit}
              onChange={(e) => setDobEdit(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Address</label>
            <input
              className="w-full h-10 rounded border border-border bg-bg px-3"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Address"
            />
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm mb-1">Aadhar Number</label>
            <input
              className="w-full h-10 rounded border border-border bg-bg px-3"
              value={aadhar}
              onChange={(e) => setAadhar(e.target.value)}
              placeholder="Aadhar"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">PAN Number</label>
            <input
              className="w-full h-10 rounded border border-border bg-bg px-3"
              value={pan}
              onChange={(e) => setPan(e.target.value)}
              placeholder="PAN"
            />
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm mb-1">Bank Account</label>
            <input
              className="w-full h-10 rounded border border-border bg-bg px-3"
              value={bankAcc}
              onChange={(e) => setBankAcc(e.target.value)}
              placeholder="Account number"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Bank Name</label>
            <input
              className="w-full h-10 rounded border border-border bg-bg px-3"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              placeholder="Bank name"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">IFSC</label>
            <input
              className="w-full h-10 rounded border border-border bg-bg px-3"
              value={ifsc}
              onChange={(e) => setIfsc(e.target.value)}
              placeholder="IFSC code"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saveLoading}
            className="inline-flex items-center justify-center h-10 px-4 rounded-md bg-primary text-white disabled:opacity-50"
          >
            {saveLoading ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </form>

      {/* Role card */}
      <section className="space-y-3 bg-surface border border-border rounded-md p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Role</h3>
          {roleErr && <div className="text-sm text-error">{roleErr}</div>}
          {roleOk && <div className="text-sm text-success">{roleOk}</div>}
        </div>
        <form onSubmit={updateRole} className="flex items-center gap-2">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="rounded-md border border-border bg-bg px-3 h-10 outline-none focus:ring-2 focus:ring-primary"
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {r.charAt(0).toUpperCase() + r.slice(1)}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={roleLoading}
            className="rounded-md bg-primary px-4 h-10 text-white disabled:opacity-50"
          >
            {roleLoading ? "Saving…" : "Save"}
          </button>
        </form>
      </section>

      {/* Reporting person card */}
      <section className="space-y-3 bg-surface border border-border rounded-md p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Reporting Person</h3>
          {uErr && <div className="text-sm text-error">{uErr}</div>}
          {uOk && <div className="text-sm text-success">{uOk}</div>}
        </div>
        <form onSubmit={updateReporting} className="flex items-center gap-2">
          <select
            value={reportingPerson}
            onChange={(e) => setReportingPerson(e.target.value)}
            className="rounded-md border border-border bg-bg px-3 h-10 outline-none focus:ring-2 focus:ring-primary"
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
            className="rounded-md bg-primary px-4 h-10 text-white disabled:opacity-50"
          >
            {uLoading ? "Saving…" : "Save"}
          </button>
        </form>
      </section>

      {/* Documents */}
      <section className="bg-surface border border-border rounded-md p-4">
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

      {/* Monthly report */}
      <section className="space-y-3 bg-surface border border-border rounded-md p-4">
        <h3 className="font-semibold">Monthly Report</h3>
        {rErr && <div className="text-sm text-error">{rErr}</div>}
        <div className="flex items-center gap-4">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-md border border-border bg-bg px-3 h-10 outline-none focus:ring-2 focus:ring-primary"
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
