import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { Th, Td, SkeletonRows, PaginationFooter } from "../../components/utils/Table";
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
  isDeleted?: boolean;
  isActive?: boolean;
};

export default function EmployeeArchive() {
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
      const res = await api.get("/companies/employees", {
        params: { includeDeleted: "true", includeInactive: "true" },
      });
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

  function resolveStatus(u: CompanyEmployee) {
    if (u.isDeleted) return { label: "Disabled", tone: "bg-error/10 text-error" };
    if (u.isActive === false) return { label: "Inactive", tone: "bg-warning/10 text-warning" };
    return { label: "Active", tone: "bg-success/10 text-success" };
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
          <h2 className="text-3xl font-bold">Employee Archive</h2>
          <p className="text-sm text-muted-foreground">
            Includes disabled or inactive employees for historical reference.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, email, role, status…"
            className="h-10 w-72 rounded-md border border-border bg-surface px-3 outline-none focus:ring-2 focus:ring-primary"
          />
          <Link
            to="/admin/employees"
            className="h-10 rounded-md border border-border px-4 text-sm font-medium"
          >
            Back to active list
          </Link>
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
              : `Showing ${start}-${end} of ${total} employees (all statuses)`}
          </div>
          <div className="flex items-center gap-2">
            <select
              className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
              value={limit}
              onChange={(e) => setLimit(parseInt(e.target.value, 10) || 20)}
            >
              {[10, 20, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n} / page
                </option>
              ))}
            </select>
          </div>
        </div>

        <table className="min-w-full divide-y divide-border/70">
          <thead className="bg-bg">
            <tr>
              <Th>Employee ID</Th>
              <Th sortable onSort={() => toggleSort("name")} dir={sortKey === "name" ? sortDir : null}>
                Name
              </Th>
              <Th sortable onSort={() => toggleSort("email")} dir={sortKey === "email" ? sortDir : null}>
                Email
              </Th>
              <Th sortable onSort={() => toggleSort("role")} dir={sortKey === "role" ? sortDir : null}>
                Role
              </Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {loading ? (
              <SkeletonRows rows={5} cols={5} />
            ) : pageRows.length === 0 ? (
              <tr>
                <Td colSpan={5} className="text-center text-sm text-muted-foreground py-4">
                  No employees found.
                </Td>
              </tr>
            ) : (
              pageRows.map((u) => {
                const role = resolveRole(u);
                const status = resolveStatus(u);
                return (
                  <tr key={u.id} className="hover:bg-bg/60">
                    <Td className="text-sm text-muted-foreground">
                      {u.employeeId || "—"}
                    </Td>
                    <Td className="whitespace-nowrap">
                      <Link
                        to={`/admin/employees/${u.id}`}
                        className="text-primary underline"
                      >
                        {u.name}
                      </Link>
                    </Td>
                    <Td>{u.email}</Td>
                    <Td>
                      <RoleBadge role={role.slug} label={role.label} />
                    </Td>
                    <Td>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-1 text-xs ${status.tone}`}
                      >
                        {status.label}
                      </span>
                    </Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

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
