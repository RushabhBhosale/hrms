import { FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { CalendarIcon } from "lucide-react";

import { api } from "../../lib/api";
import { getEmployee, setAuth, LeaveBalances } from "../../lib/auth";
import { formatDateDisplay } from "../../lib/utils";
import {
  Th,
  Td,
  SkeletonRows,
  PaginationFooter,
} from "../../components/utils/Table";
import { StatusBadge } from "../../components/utils/StatusBadge";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type LeaveAllocations = {
  paid?: number;
  casual?: number;
  sick?: number;
  unpaid?: number;
};

type Leave = {
  _id: string;
  startDate: string;
  endDate: string;
  type: "CASUAL" | "PAID" | "UNPAID" | "SICK";
  reason?: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  adminMessage?: string;
  allocations?: LeaveAllocations;
  approver?: { _id: string; name: string; email?: string };
};

type FormState = {
  startDate: string;
  endDate: string;
  reason: string;
  type: "CASUAL" | "PAID" | "UNPAID" | "SICK";
  fallbackType?: "PAID" | "SICK" | "UNPAID";
};

type EmployeeLite = { id: string; name: string; email: string };

const ADVANCE_NOTICE_DAYS = 30;

function daysBetween(start?: string, end?: string) {
  if (!start || !end) return 0;

  const d1 = new Date(start);
  const d2 = new Date(end);

  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return 0;

  d1.setUTCHours(0, 0, 0, 0);
  d2.setUTCHours(0, 0, 0, 0);

  return Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

function computedLeaveDays(leave: Leave) {
  const alloc = leave.allocations;
  if (alloc) {
    const total =
      Number(alloc.paid || 0) +
      Number(alloc.casual || 0) +
      Number(alloc.sick || 0) +
      Number(alloc.unpaid || 0);
    if (total > 0) return total;
  }
  return daysBetween(leave.startDate, leave.endDate);
}

function formatType(l: Leave) {
  const parts: string[] = [];
  const fmt = (n?: number) =>
    Number.isFinite(n)
      ? Math.abs((n ?? 0) % 1) < 1e-4
        ? `${Math.round(n!)}`
        : `${Math.round((n || 0) * 100) / 100}`
      : null;
  const add = (label: string, val?: number) => {
    const num = fmt(val);
    if (num && Number(num) > 0) parts.push(`${num} ${label}`);
  };
  add("Paid", l.allocations?.paid);
  add("Casual", l.allocations?.casual);
  add("Sick", l.allocations?.sick);
  add("Unpaid", l.allocations?.unpaid);
  if (parts.length) return parts.join(" + ");
  return l.type;
}

function formatLeaveDays(value: number) {
  const rounded = Math.round(value * 100) / 100;
  if (!Number.isFinite(rounded)) return "0";
  if (Math.abs(rounded % 1) < 1e-4) return String(Math.round(rounded));
  return rounded.toFixed(2);
}

function toISODate(d: Date) {
  return format(d, "yyyy-MM-dd");
}

function fromISODate(s: string) {
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

const isWeekend = (d: Date) => {
  const day = d.getDay();
  return day === 0 || day === 6;
};

export default function LeaveRequest() {
  const [form, setForm] = useState<FormState>({
    startDate: "",
    endDate: "",
    reason: "",
    type: "PAID",
  });

  const [range, setRange] = useState<DateRange | undefined>(() => {
    const from = fromISODate(form.startDate);
    const to = fromISODate(form.endDate);
    if (from && to) return { from, to };
    if (from) return { from, to: from };
    return undefined;
  });
  const [months, setMonths] = useState(1);

  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [balances, setBalances] = useState<LeaveBalances | null>(
    () => getEmployee()?.leaveBalances || null,
  );
  const [totalAvail, setTotalAvail] = useState<number>(
    () => getEmployee()?.totalLeaveAvailable || 0,
  );

  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [notifyIds, setNotifyIds] = useState<string[]>([]);

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | Leave["status"]>(
    "ALL",
  );
  const [typeFilter, setTypeFilter] = useState<"ALL" | Leave["type"]>("ALL");

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [sortKey, setSortKey] = useState<
    "start" | "end" | "days" | "type" | "status"
  >("start");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  async function load() {
    try {
      setLoading(true);
      setErr(null);
      const res = await api.get("/leaves");
      setLeaves(res.data.leaves || []);
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to load leaves");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    async function refreshBalances() {
      try {
        const res = await api.get("/auth/me");
        setBalances(res.data.employee.leaveBalances);
        setTotalAvail(res.data.employee.totalLeaveAvailable || 0);
        const token = localStorage.getItem("token");
        if (token) setAuth(token, res.data.employee);
      } catch (_) {}
    }
    refreshBalances();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/companies/employees");
        const me = getEmployee();
        let list: EmployeeLite[] = (res.data.employees || []).map((e: any) => ({
          id: e.id,
          name: e.name,
          email: e.email,
        }));
        if (me) list = list.filter((e) => e.id !== me.id);
        list.sort((a, b) => a.name.localeCompare(b.name));
        setEmployees(list);
      } catch (_) {}
    })();
  }, []);

  useEffect(() => {
    if (!range?.from) {
      setForm((p) => ({ ...p, startDate: "", endDate: "" }));
      return;
    }
    setForm((p) => ({
      ...p,
      startDate: toISODate(range.from!),
      endDate: toISODate(range.to ?? range.from!),
    }));
  }, [range]);

  useEffect(() => {
    const updateMonths = () =>
      setMonths(
        typeof window !== "undefined" && window.innerWidth < 640 ? 1 : 2,
      );
    updateMonths();
    window.addEventListener("resize", updateMonths);
    return () => window.removeEventListener("resize", updateMonths);
  }, []);

  const canSubmit = useMemo(() => {
    if (!form.startDate || !form.endDate) return false;
    if (new Date(form.endDate) < new Date(form.startDate)) return false;
    return true;
  }, [form.startDate, form.endDate]);

  const leavesFiltered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return leaves.filter(
      (l) =>
        (statusFilter === "ALL" || l.status === statusFilter) &&
        (typeFilter === "ALL" || l.type === typeFilter) &&
        (!term || (l.adminMessage || "").toLowerCase().includes(term)),
    );
  }, [leaves, q, statusFilter, typeFilter]);

  const leavesSorted = useMemo(() => {
    const arr = [...leavesFiltered];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      switch (sortKey) {
        case "end":
          return dir * (+new Date(a.endDate) - +new Date(b.endDate));
        case "days":
          return dir * (computedLeaveDays(a) - computedLeaveDays(b));
        case "type":
          return dir * a.type.localeCompare(b.type);
        case "status":
          return dir * a.status.localeCompare(b.status);
        case "start":
        default:
          return dir * (+new Date(a.startDate) - +new Date(b.startDate));
      }
    });
    return arr;
  }, [leavesFiltered, sortKey, sortDir]);

  const totalFiltered = leavesSorted.length;
  const pages = useMemo(
    () => Math.max(1, Math.ceil(totalFiltered / Math.max(1, limit))),
    [totalFiltered, limit],
  );

  const pageRows = useMemo(
    () => leavesSorted.slice((page - 1) * limit, (page - 1) * limit + limit),
    [leavesSorted, page, limit],
  );

  const days = daysBetween(form.startDate, form.endDate);

  const disabledRanges = useMemo(
    () =>
      leaves
        .filter((l) => l.status !== "REJECTED")
        .map((l) => {
          const from = new Date(l.startDate);
          const to = new Date(l.endDate);
          if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()))
            return null;
          return { from, to };
        })
        .filter(Boolean) as { from: Date; to: Date }[],
    [leaves],
  );

  function handleRangeSelect(next?: DateRange) {
    if (!next) {
      setRange(undefined);
      return;
    }
    if (next.from && isWeekend(next.from)) return;
    if (next.to && isWeekend(next.to)) return;
    setRange(next);
  }

  const advanceNoticeDays = useMemo(() => {
    if (!form.startDate) return null;
    const start = new Date(form.startDate);
    if (Number.isNaN(start.getTime())) return null;
    const today = new Date();
    start.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    return Math.floor(
      (start.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
    );
  }, [form.startDate]);

  const requiresAdvanceNotice = days >= 3;
  const advanceNoticeSatisfied =
    !requiresAdvanceNotice ||
    (advanceNoticeDays !== null && advanceNoticeDays >= ADVANCE_NOTICE_DAYS);
  const advanceNoticeViolation =
    requiresAdvanceNotice && !advanceNoticeSatisfied;

  const selectedAvail = useMemo(() => {
    if (!balances) return 0;
    const capRemain: Record<FormState["type"], number> = {
      CASUAL: balances.casual || 0,
      PAID: balances.paid || 0,
      SICK: balances.sick || 0,
      UNPAID: Number.POSITIVE_INFINITY,
    };
    if (form.type === "UNPAID") return Number.POSITIVE_INFINITY;
    return Math.max(0, Math.min(capRemain[form.type], totalAvail));
  }, [balances, form.type, totalAvail]);

  const needsFallback = useMemo(() => {
    if (form.type === "UNPAID") return false;
    if (days <= 0) return false;
    if (!Number.isFinite(selectedAvail)) return false;
    return selectedAvail < days;
  }, [form.type, days, selectedAvail]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setErr(null);
    setOk(null);

    if (advanceNoticeViolation) {
      const msg = `Leaves of 3 or more days must be applied at least ${ADVANCE_NOTICE_DAYS} days in advance.`;
      toast.error(msg);
      setErr(msg);
      return;
    }

    try {
      setSending(true);
      await api.post("/leaves", { ...form, notify: notifyIds });
      setRange(undefined);
      setForm({ startDate: "", endDate: "", reason: "", type: "CASUAL" });
      setNotifyIds([]);
      setOk("Leave request submitted");
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to submit leave");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <h2 className="text-3xl font-bold">Request Leave</h2>
        <p className="text-sm text-muted-foreground">
          Create a new leave request and track its status.
        </p>
      </header>

      {err && (
        <div className="rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
          {err}
        </div>
      )}
      {ok && (
        <div className="rounded-md border border-success/20 bg-success/10 px-4 py-2 text-sm text-success">
          {ok}
        </div>
      )}

      {balances && (
        <section className="rounded-lg border border-border bg-surface shadow-sm p-5">
          <h3 className="text-lg font-semibold mb-4">Leave Balances</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            {balances.casual !== 0 && <div>Casual: {balances.casual}</div>}
            {balances.paid !== 0 && <div>Paid: {balances.paid}</div>}
            {balances.sick !== 0 && <div>Sick: {balances.sick}</div>}
            {balances.unpaid !== 0 && <div>Unpaid: {balances.unpaid}</div>}

            <div className="col-span-2 text-muted-foreground">
              Total Available leaves this month: {totalAvail}
            </div>
          </div>
        </section>
      )}

      <section className="rounded-lg border border-border bg-surface shadow-sm overflow-hidden">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-lg font-semibold">New Request</h3>
        </div>

        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <label className="text-sm font-medium required-label">Type</label>
              <select
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={form.type}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    type: e.target.value as FormState["type"],
                  }))
                }
              >
                {balances?.casual !== 0 && (
                  <option value="CASUAL">Casual</option>
                )}
                {balances?.paid !== 0 && <option value="PAID">Paid</option>}
                {balances?.sick !== 0 && <option value="SICK">Sick</option>}
                <option value="UNPAID">Unpaid</option>
              </select>
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium required-label">
                Date range
              </label>

              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start gap-1.5 border-border bg-surface px-2 py-1.5 text-xs font-normal"
                  >
                    <CalendarIcon className="h-3.5 w-3.5" />
                    {range?.from ? (
                      range.to ? (
                        <span className="text-[11px]">
                          {format(range.from, "LLL dd, y")} -{" "}
                          {format(range.to, "LLL dd, y")}
                        </span>
                      ) : (
                        <span className="text-[11px]">
                          {format(range.from, "LLL dd, y")}
                        </span>
                      )
                    ) : (
                      <span className="text-[11px] text-muted-foreground">
                        Pick a date range
                      </span>
                    )}
                  </Button>
                </PopoverTrigger>

                <PopoverContent
                  className="w-[min(520px,95vw)] p-2 bg-surface/95 border border-border/70 shadow-md rounded-lg"
                  align="start"
                  sideOffset={8}
                >
                  <Calendar
                    mode="range"
                    numberOfMonths={2}
                    selected={range}
                    onSelect={handleRangeSelect}
                    defaultMonth={range?.from}
                    disabled={disabledRanges}
                    className="p-0 text-xs [&_.rdp-months]:gap-3 [&_.rdp-caption_label]:text-xs [&_.rdp-day_button]:text-[11px]"
                  />
                </PopoverContent>
              </Popover>

              {!form.startDate || !form.endDate ? (
                <div className="text-xs text-muted-foreground">
                  Select a start and end date
                </div>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Reason</label>
            <textarea
              rows={3}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
              placeholder="Optional note for your manager"
              value={form.reason}
              onChange={(e) =>
                setForm((p) => ({ ...p, reason: e.target.value }))
              }
            />
            <div className="text-xs text-muted-foreground">
              {form.startDate && form.endDate && days > 0
                ? `Duration: ${days} day${days > 1 ? "s" : ""}`
                : "Select start and end dates"}
            </div>

            {advanceNoticeViolation && (
              <div className="text-xs text-error">
                Leaves of 3 or more days must be applied at least{" "}
                {ADVANCE_NOTICE_DAYS} days in advance.
              </div>
            )}
          </div>

          {needsFallback && (
            <div className="text-xs text-error">
              You have only {Number.isFinite(selectedAvail) ? selectedAvail : 0}{" "}
              {form.type.toLowerCase()} leave(s). The remaining{" "}
              {Math.max(
                0,
                days - (Number.isFinite(selectedAvail) ? selectedAvail : 0),
              )}{" "}
              day(s) will be marked as Unpaid.
            </div>
          )}

          <div className="pt-2 flex items-center gap-2">
            <Button type="submit" disabled={!canSubmit || sending}>
              {sending ? "Submitting…" : "Submit"}
            </Button>

            <Button
              type="button"
              variant="outline"
              disabled={sending}
              onClick={() => {
                setRange(undefined);
                setForm({
                  startDate: "",
                  endDate: "",
                  reason: "",
                  type: "CASUAL",
                });
                setNotifyIds([]);
              }}
            >
              Reset
            </Button>
          </div>

          {!canSubmit && (form.startDate || form.endDate) && (
            <div className="text-xs text-error">
              End date must be the same or after start date.
            </div>
          )}
        </form>
      </section>

      <section className="rounded-lg border border-border bg-surface shadow-sm overflow-hidden">
        <div className="border-b border-border px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            {loading
              ? "Loading…"
              : `Showing ${
                  totalFiltered === 0 ? 0 : (page - 1) * limit + 1
                }-${Math.min(totalFiltered, page * limit)} of ${totalFiltered} requests`}
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

        <div className="px-4 py-3 flex flex-wrap gap-2">
          <select
            className="h-9 rounded-md border border-border bg-surface px-3"
            value={statusFilter}
            onChange={(e) => {
              setPage(1);
              setStatusFilter(e.target.value as any);
            }}
          >
            <option value="ALL">All Status</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </select>

          <select
            className="h-9 rounded-md border border-border bg-surface px-3"
            value={typeFilter}
            onChange={(e) => {
              setPage(1);
              setTypeFilter(e.target.value as any);
            }}
          >
            <option value="ALL">All Types</option>
            <option value="CASUAL">Casual</option>
            <option value="PAID">Paid</option>
            <option value="UNPAID">Unpaid</option>
            <option value="SICK">Sick</option>
          </select>

          <input
            value={q}
            onChange={(e) => {
              setPage(1);
              setQ(e.target.value);
            }}
            placeholder="Search message…"
            className="h-9 w-64 rounded-md border border-border bg-surface px-3"
          />
        </div>

        <div className="hidden md:block">
          <table className="w-full text-sm">
            <thead className="bg-bg">
              <tr className="text-left">
                <Th
                  sortable
                  onSort={() => {
                    setSortKey("start");
                    setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                  }}
                  dir={sortKey === "start" ? sortDir : null}
                >
                  Start
                </Th>

                <Th
                  sortable
                  onSort={() => {
                    setSortKey("end");
                    setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                  }}
                  dir={sortKey === "end" ? sortDir : null}
                >
                  End
                </Th>

                <Th
                  sortable
                  onSort={() => {
                    setSortKey("days");
                    setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                  }}
                  dir={sortKey === "days" ? sortDir : null}
                >
                  Days
                </Th>

                <Th
                  sortable
                  onSort={() => {
                    setSortKey("type");
                    setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                  }}
                  dir={sortKey === "type" ? sortDir : null}
                >
                  Type
                </Th>

                <Th
                  sortable
                  onSort={() => {
                    setSortKey("status");
                    setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                  }}
                  dir={sortKey === "status" ? sortDir : null}
                >
                  Status
                </Th>

                <Th>Approved By</Th>
                <Th>Message</Th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <SkeletonRows rows={6} cols={7} />
              ) : pageRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-6 text-center text-muted-foreground"
                  >
                    No leave requests yet.
                  </td>
                </tr>
              ) : (
                pageRows.map((l) => (
                  <tr key={l._id} className="border-t border-border/70">
                    <Td>{formatDateDisplay(l.startDate)}</Td>
                    <Td>{formatDateDisplay(l.endDate)}</Td>
                    <Td>{formatLeaveDays(computedLeaveDays(l))}</Td>
                    <Td>{formatType(l)}</Td>
                    <Td>
                      <StatusBadge status={l.status as Leave["status"]} />
                    </Td>
                    <Td>
                      {l.status === "APPROVED"
                        ? l.approver?.name || "—"
                        : "-"}
                    </Td>
                    <Td>
                      <span
                        title={l.adminMessage || ""}
                        className="line-clamp-1 max-w-[28rem] inline-block align-middle"
                      >
                        {l.adminMessage || "-"}
                      </span>
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

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
          ) : pageRows.length === 0 ? (
            <div className="px-4 py-6 text-center text-muted-foreground">
              No leave requests yet.
            </div>
          ) : (
            pageRows.map((l) => (
              <div key={l._id} className="p-4">
                <div className="flex items-center justify-between">
                  <div className="font-medium">
                    {formatDateDisplay(l.startDate)} →{" "}
                    {formatDateDisplay(l.endDate)}
                  </div>
                  <StatusBadge status={l.status as Leave["status"]} />
                </div>

                <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  <div className="text-muted-foreground">Days</div>
                  <div>{formatLeaveDays(computedLeaveDays(l))}</div>

                  <div className="text-muted-foreground">Type</div>
                  <div>{formatType(l)}</div>

                  <div className="text-muted-foreground">Approved By</div>
                  <div>{l.status === "APPROVED" ? l.approver?.name || "—" : "-"}</div>

                  <div className="text-muted-foreground">Message</div>
                  <div className="col-span-1">{l.adminMessage || "-"}</div>
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
