import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import {
  Th,
  Td,
  SkeletonRows,
  PaginationFooter,
} from "../../components/utils/Table";
import { RoleBadge } from "../../components/utils/RoleBadge";
import type { PrimaryRole } from "../../lib/auth";
import type { RoleDefinition } from "../../types/roles";

type CompanyEmployee = {
  id: string;
  name: string;
  email: string;
  employeeId?: string;
  subRoles: string[];
  primaryRole: PrimaryRole;
  employmentStatus?: "PERMANENT" | "PROBATION";
};

export default function EmployeeList() {
  const navigate = useNavigate();
  const [employees, setEmployees] = useState<CompanyEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [sortKey, setSortKey] = useState<"name" | "email" | "role">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [roleLabels, setRoleLabels] = useState<Record<string, string>>({});

  async function load() {
    try {
      setLoading(true);
      const res = await api.get("/companies/employees");

      const employees = res.data.employees?.filter(
        (emp: any) =>
          emp.primaryRole !== "ADMIN" && !emp.isDeleted && emp.isActive !== false,
      );
      setEmployees(employees || []);
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to load employees");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/companies/roles");
        const defs: RoleDefinition[] = res.data.roles || [];
        const map: Record<string, string> = {};
        defs.forEach((def) => {
          map[def.name] = def.label;
        });
        setRoleLabels(map);
      } catch {}
    })();
  }, []);

  function resolveRole(u: CompanyEmployee) {
    const slugRaw =
      u.subRoles?.[0] ||
      (u.primaryRole === "ADMIN"
        ? "admin"
        : u.primaryRole === "SUPERADMIN"
          ? "superadmin"
          : "employee");
    const slug = slugRaw.toLowerCase();
    const label = roleLabels[slug] || prettifyRole(slug);
    return { slug, label };
  }

  function prettifyRole(value: string) {
    if (!value) return "Employee";
    return (
      value
        .replace(/[-_]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : ""))
        .join(" ") || "Employee"
    );
  }

  function resolveEmploymentStatus(u: CompanyEmployee) {
    const status = u.employmentStatus || "PROBATION";
    const label =
      status === "PERMANENT"
        ? "Permanent"
        : status === "PROBATION"
          ? "Probation"
          : prettifyRole(String(status).toLowerCase());
    const tone =
      status === "PERMANENT"
        ? "bg-success/10 text-success"
        : "bg-warning/10 text-warning";
    return { status, label, tone };
  }

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return employees;
    return employees.filter(
      (e) =>
        e.name.toLowerCase().includes(term) ||
        e.email.toLowerCase().includes(term) ||
        (e.employeeId || "").toLowerCase().includes(term) ||
        e.subRoles.join(",").toLowerCase().includes(term) ||
        resolveRole(e).label.toLowerCase().includes(term) ||
        (e.employmentStatus || "PROBATION").toLowerCase().includes(term),
    );
  }, [q, employees]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      switch (sortKey) {
        case "email":
          return dir * a.email.localeCompare(b.email);
        case "role":
          return dir * resolveRole(a).label.localeCompare(resolveRole(b).label);
        case "name":
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
  const pageRows = useMemo(
    () => sorted.slice((page - 1) * limit, (page - 1) * limit + limit),
    [sorted, page, limit],
  );

  function toggleSort(k: typeof sortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-3xl font-bold">Employees</h2>
          <p className="text-sm text-muted-foreground">
            All company employees with roles.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, email, role, status…"
            className="h-10 w-72 rounded-md border border-border bg-surface px-3 outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            onClick={() => navigate("/admin/employees/add")}
            className="h-10 rounded-md bg-primary px-4 text-white"
          >
            Add
          </button>
        </div>
      </div>

      {err && (
        <div className="rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
          {err}
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface shadow-sm overflow-auto">
        <div className="border-b border-border px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            {loading
              ? "Loading…"
              : `Showing ${start}-${end} of ${total} employees`}
          </div>
          <div className="flex items-center gap-2">
            <select
              className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
              value={limit}
              onChange={(e) => {
                setPage(1);
                setLimit(parseInt(e.target.value, 10));
              }}
            >
              {[10, 20, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n} / page
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Table (desktop) */}
        <div className="hidden md:block overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg">
              <tr className="text-left">
                <Th>Employee ID</Th>
                <Th
                  className="whitespace-nowrap"
                  sortable
                  onSort={() => toggleSort("name")}
                  dir={sortKey === "name" ? sortDir : null}
                >
                  Name
                </Th>
                <Th
                  className="w-[40%]"
                  sortable
                  onSort={() => toggleSort("email")}
                  dir={sortKey === "email" ? sortDir : null}
                >
                  Email
                </Th>
                <Th
                  sortable
                  onSort={() => toggleSort("role")}
                  dir={sortKey === "role" ? sortDir : null}
                >
                  Role
                </Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={6} cols={5} />
              ) : pageRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-6 text-center text-muted-foreground"
                  >
                    No employees found.
                  </td>
                </tr>
              ) : (
                pageRows.map((u) => (
                  <tr key={u.id} className="border-t border-border/70">
                    <Td className="whitespace-nowrap">{u.employeeId || "—"}</Td>
                    <Td className="whitespace-nowrap">
                      <Link
                        to={`/admin/employees/${u.id}`}
                        className="text-primary underline"
                      >
                        {u.name}
                      </Link>
                    </Td>
                    <Td>
                      <span className="truncate inline-block align-middle">
                        {u.email}
                      </span>
                    </Td>
                    <Td>
                      {(() => {
                        const info = resolveRole(u);
                        return (
                          <RoleBadge role={info.slug} label={info.label} />
                        );
                      })()}
                    </Td>
                    <Td className="whitespace-nowrap">
                      {(() => {
                        const info = resolveEmploymentStatus(u);
                        return (
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${info.tone}`}
                          >
                            {info.label}
                          </span>
                        );
                      })()}
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
            <div className="px-4 py-6 text-center text-muted-foreground">
              No employees found.
            </div>
          ) : (
            filtered.map((u) => (
              <div key={u.id} className="p-4">
                <div className="text-xs text-muted-foreground">
                  ID: {u.employeeId || "—"}
                </div>
                <div className="font-medium">
                  <Link
                    to={`/admin/employees/${u.id}`}
                    className="text-primary underline"
                  >
                    {u.name}
                  </Link>
                </div>
                <div className="text-sm text-muted-foreground">{u.email}</div>
                <div className="mt-2">
                  {(() => {
                    const info = resolveRole(u);
                    return <RoleBadge role={info.slug} label={info.label} />;
                  })()}
                </div>
                <div className="mt-3">
                  {(() => {
                    const info = resolveEmploymentStatus(u);
                    return (
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${info.tone}`}
                      >
                        {info.label}
                      </span>
                    );
                  })()}
                </div>
              </div>
            ))
          )}
        </div>
        <div className="border-t border-border px-4 py-3">
          <PaginationFooter
            page={page}
            pages={pages}
            onFirst={() => setPage(1)}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => Math.min(pages, p + 1))}
            onLast={() => setPage(pages)}
            disabled={loading}
          />
        </div>
      </section>
    </div>
  );
}
