import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import type { Kra } from "../../types/performance";
import { SkeletonRows } from "../../components/utils/Table";
import { toast } from "react-hot-toast";

function fmtDate(value?: string) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString();
}

type EmployeeGroup = {
  id: string;
  name: string;
  email?: string;
  employeeId?: string;
  kras: Kra[];
};

export default function KRAAll() {
  const [kras, setKras] = useState<Kra[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "CLOSED">(
    "ALL",
  );
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);

  useEffect(() => {
    loadKras();
  }, []);

  async function loadKras() {
    try {
      setLoading(true);
      const res = await api.get("/performance/kras", {
        params: { all: true },
      });
      setKras(res.data?.kras || []);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Failed to load KRAs");
    } finally {
      setLoading(false);
    }
  }

  const groups = useMemo(() => {
    const map = new Map<string, EmployeeGroup>();
    kras.forEach((k) => {
      const empObj = typeof k.employee === "object" ? k.employee : null;
      const empId =
        (empObj as any)?._id ||
        (empObj as any)?.id ||
        (typeof k.employee === "string" ? k.employee : null);
      if (!empId) return;
      if (!map.has(empId)) {
        map.set(empId, {
          id: empId,
          name: (empObj as any)?.name || "Employee",
          email: (empObj as any)?.email,
          employeeId: (empObj as any)?.employeeId,
          kras: [],
        });
      }
      map.get(empId)!.kras.push(k);
    });
    return Array.from(map.values());
  }, [kras]);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups
      .filter((g) => {
        if (statusFilter === "ALL") return true;
        return g.kras.some((k) => k.status === statusFilter);
      })
      .filter((g) => {
        if (!q) return true;
        const target = [g.name || "", g.employeeId || "", g.email || ""]
          .join(" ")
          .toLowerCase();
        return target.includes(q);
      })
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [groups, search, statusFilter]);

  useEffect(() => {
    if (filteredGroups.length === 0) {
      setSelectedEmployee(null);
    } else if (
      selectedEmployee &&
      !filteredGroups.some((g) => g.id === selectedEmployee)
    ) {
      setSelectedEmployee(filteredGroups[0].id);
    } else if (!selectedEmployee && filteredGroups.length) {
      setSelectedEmployee(filteredGroups[0].id);
    }
  }, [filteredGroups, selectedEmployee]);

  const activeGroup = filteredGroups.find((g) => g.id === selectedEmployee);
  const activeKras = useMemo(() => {
    if (!activeGroup) return [];
    return [...activeGroup.kras].sort((a, b) =>
      (b.createdAt || "").localeCompare(a.createdAt || ""),
    );
  }, [activeGroup]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-3xl font-bold">All KRAs</h2>
          <p className="text-sm text-muted-foreground">
            Company-wide view grouped by employee. Click an employee to see all
            their answers.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <input
            className="h-10 rounded-md border border-border bg-surface px-3 text-sm"
            placeholder="Search employee / id / email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="h-10 rounded-md border border-border bg-surface px-3 text-sm"
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as "ALL" | "ACTIVE" | "CLOSED")
            }
          >
            <option value="ALL">All statuses</option>
            <option value="ACTIVE">Open</option>
            <option value="CLOSED">Closed</option>
          </select>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="rounded-lg border border-border bg-surface shadow-sm overflow-hidden">
          <div className="border-b border-border px-4 py-3 text-sm font-semibold">
            Employees ({filteredGroups.length})
          </div>
          {loading ? (
            <SkeletonRows rows={5} cols={1} />
          ) : !filteredGroups.length ? (
            <div className="px-4 py-6 text-sm text-muted-foreground">
              No employees found.
            </div>
          ) : (
            <div className="divide-y divide-border max-h-[70vh] overflow-auto">
              {filteredGroups.map((g) => {
                const openCount = g.kras.filter(
                  (k) => k.status !== "CLOSED",
                ).length;
                const closedCount = g.kras.length - openCount;
                return (
                  <button
                    key={g.id}
                    className={`w-full text-left px-4 py-3 hover:bg-bg transition ${
                      selectedEmployee === g.id ? "bg-bg/70" : ""
                    }`}
                    onClick={() => setSelectedEmployee(g.id)}
                  >
                    <div className="font-semibold">{g.name || "Employee"}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {g.employeeId ? `#${g.employeeId}` : g.email || "—"}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {g.kras.length} KRAs · {openCount} open · {closedCount}{" "}
                      closed
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border bg-surface shadow-sm min-h-[320px]">
          <div className="border-b border-border px-5 py-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">
                {activeGroup?.name || "Select an employee"}
              </div>
              <div className="text-xs text-muted-foreground">
                {activeGroup?.employeeId
                  ? `#${activeGroup.employeeId}`
                  : activeGroup?.email || ""}
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {activeGroup ? `${activeGroup.kras.length} KRAs` : ""}
            </div>
          </div>

          {loading ? (
            <SkeletonRows rows={4} cols={3} />
          ) : !activeGroup ? (
            <div className="px-5 py-6 text-sm text-muted-foreground">
              Pick an employee to view their answers.
            </div>
          ) : !activeKras.length ? (
            <div className="px-5 py-6 text-sm text-muted-foreground">
              No KRAs for this employee.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {activeKras.map((k) => (
                <div key={k._id} className="px-5 py-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs text-muted-foreground">
                        Question
                      </div>
                      <div className="font-semibold">{k.title}</div>
                      {k.description && (
                        <div className="text-sm text-muted-foreground">
                          {k.description}
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <span
                        className={`rounded-full px-2 py-1 text-[11px] ${
                          k.status === "CLOSED"
                            ? "bg-muted/50 text-muted-foreground"
                            : "bg-success/10 text-success"
                        }`}
                      >
                        {k.status || "ACTIVE"}
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3 text-xs">
                    <InfoBlock
                      label="Self"
                      rating={k.selfReview?.rating}
                      note={k.selfReview?.answer || "No answer"}
                    />
                    <InfoBlock
                      label="Manager"
                      rating={k.managerReview?.rating}
                      note={k.managerReview?.comments || "No comments"}
                    />
                    <InfoBlock
                      label="Admin"
                      rating={k.adminReview?.rating}
                      note={k.adminReview?.comments || "No comments"}
                    />
                  </div>

                  <div className="text-[11px] text-muted-foreground">
                    Created: {fmtDate(k.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoBlock({
  label,
  rating,
  note,
}: {
  label: string;
  rating?: number;
  note?: string;
}) {
  return (
    <div className="rounded-md border border-border/70 bg-bg px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{rating ?? "—"}</div>
      <div className="text-[11px] text-muted-foreground whitespace-pre-wrap">
        {note || ""}
      </div>
    </div>
  );
}
