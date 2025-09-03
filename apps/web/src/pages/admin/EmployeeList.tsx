import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";

type CompanyEmployee = {
  id: string;
  name: string;
  email: string;
  subRoles: string[];
};

export default function EmployeeList() {
  const [employees, setEmployees] = useState<CompanyEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [sortKey, setSortKey] = useState<'name'|'email'|'role'>('name');
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('asc');

  async function load() {
    try {
      setLoading(true);
      const res = await api.get("/companies/employees");
      setEmployees(res.data.employees || []);
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to load employees");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return employees;
    return employees.filter(
      (e) =>
        e.name.toLowerCase().includes(term) ||
        e.email.toLowerCase().includes(term) ||
        e.subRoles.join(",").toLowerCase().includes(term)
    );
  }, [q, employees]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a,b) => {
      switch (sortKey) {
        case 'email':
          return dir * a.email.localeCompare(b.email);
        case 'role':
          return dir * (a.subRoles?.[0] || '').localeCompare(b.subRoles?.[0] || '');
        case 'name':
        default:
          return dir * a.name.localeCompare(b.name);
      }
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const total = sorted.length;
  const pages = Math.max(1, Math.ceil(total / Math.max(1, limit)));
  const start = total === 0 ? 0 : (page - 1) * limit + 1;
  const end = Math.min(total, page * limit);
  const pageRows = useMemo(() => sorted.slice((page-1)*limit, (page-1)*limit + limit), [sorted, page, limit]);

  function toggleSort(k: typeof sortKey) {
    if (sortKey === k) setSortDir(d => d==='asc'?'desc':'asc'); else { setSortKey(k); setSortDir('asc'); }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-3xl font-bold">Employees</h2>
          <p className="text-sm text-muted">
            All company employees with roles.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, email, role…"
            className="h-10 w-72 rounded-md border border-border bg-surface px-3 outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            onClick={load}
            className="h-10 rounded-md bg-primary px-4 text-white"
          >
            Refresh
          </button>
        </div>
      </div>

      {err && (
        <div className="rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
          {err}
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface shadow-sm overflow-hidden">
        <div className="border-b border-border px-4 py-3 flex items-center justify-between">
          <div className="text-sm text-muted">
            {loading ? 'Loading…' : `Showing ${start}-${end} of ${total} employees`}
          </div>
          <div className="flex items-center gap-2">
            <select
              className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
              value={limit}
              onChange={(e)=>{ setPage(1); setLimit(parseInt(e.target.value,10)); }}
            >
              {[10,20,50,100].map(n=> <option key={n} value={n}>{n} / page</option>)}
            </select>
          </div>
        </div>

        {/* Table (desktop) */}
        <div className="hidden md:block">
          <table className="w-full text-sm">
            <thead className="bg-bg">
              <tr className="text-left">
                <SortableTh label="Name" dir={sortKey==='name'?sortDir:null} onClick={()=>toggleSort('name')} />
                <SortableTh label="Email" dir={sortKey==='email'?sortDir:null} onClick={()=>toggleSort('email')} />
                <SortableTh label="Role" dir={sortKey==='role'?sortDir:null} onClick={()=>toggleSort('role')} />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={6} cols={3} />
              ) : pageRows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-muted">
                    No employees found.
                  </td>
                </tr>
              ) : (
                pageRows.map((u) => (
                  <tr key={u.id} className="border-t border-border/70">
                    <Td>
                      <Link
                        to={`/admin/employees/${u.id}`}
                        className="text-primary underline"
                      >
                        {u.name}
                      </Link>
                    </Td>
                    <Td>
                      <span className="truncate inline-block max-w-[28rem] align-middle">
                        {u.email}
                      </span>
                    </Td>
                    <Td>
                      <RoleBadge role={u.subRoles?.[0]} />
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Cards (mobile) */}
        <div className="md:hidden divide-y divide-border">
          {loading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-md border border-border p-3 animate-pulse space-y-2"
                >
                  <div className="h-4 w-40 bg-bg rounded" />
                  <div className="h-3 w-56 bg-bg rounded" />
                  <div className="h-6 w-24 bg-bg rounded" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-muted">
              No employees found.
            </div>
          ) : (
            filtered.map((u) => (
              <div key={u.id} className="p-4">
                <div className="font-medium">
                  <Link
                    to={`/admin/employees/${u.id}`}
                    className="text-primary underline"
                  >
                    {u.name}
                  </Link>
                </div>
                <div className="text-sm text-muted">{u.email}</div>
                <div className="mt-2">
                  <RoleBadge role={u.subRoles?.[0]} />
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <div className="flex items-center gap-2 justify-end">
        <button className="h-9 px-3 rounded-md bg-surface border border-border text-sm disabled:opacity-50" onClick={()=>setPage(1)} disabled={page===1}>First</button>
        <button className="h-9 px-3 rounded-md bg-surface border border-border text-sm disabled:opacity-50" onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}>Prev</button>
        <div className="text-sm text-muted">Page {page} of {pages}</div>
        <button className="h-9 px-3 rounded-md bg-surface border border-border text-sm disabled:opacity-50" onClick={()=>setPage(p=>Math.min(pages,p+1))} disabled={page>=pages}>Next</button>
        <button className="h-9 px-3 rounded-md bg-surface border border-border text-sm disabled:opacity-50" onClick={()=>setPage(pages)} disabled={page>=pages}>Last</button>
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted">
      {children}
    </th>
  );
}

function SortableTh({ label, dir, onClick }: { label: string; dir: 'asc'|'desc'|null; onClick: ()=>void }) {
  return (
    <th onClick={onClick} className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted cursor-pointer hover:text-text select-none">
      <span className="inline-flex items-center gap-1">
        {label}
        <span className="text-[10px]">{dir==='asc'?'▲':dir==='desc'?'▼':'↕'}</span>
      </span>
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-3 align-middle">{children}</td>;
}

function RoleBadge({ role }: { role?: string }) {
  const label = (role || "employee").toLowerCase();
  const tone =
    label === "manager"
      ? "bg-secondary/10 text-secondary"
      : label === "hr"
      ? "bg-accent/10 text-accent"
      : "bg-primary/10 text-primary";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}
    >
      {label.charAt(0).toUpperCase() + label.slice(1)}
    </span>
  );
}

function SkeletonRows({ rows, cols }: { rows: number; cols: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-t border-border/70">
          {Array.from({ length: cols }).map((__, c) => (
            <td key={c} className="px-4 py-3">
              <div className="h-4 w-40 bg-bg rounded animate-pulse" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
