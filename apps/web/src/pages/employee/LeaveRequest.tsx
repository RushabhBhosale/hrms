import { useEffect, useMemo, useState, FormEvent } from "react";
import { api } from "../../lib/api";

type Leave = {
  _id: string;
  startDate: string;
  endDate: string;
  reason?: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  adminMessage?: string;
};

type FormState = { startDate: string; endDate: string; reason: string };

function daysBetween(a: string, b: string) {
  if (!a || !b) return 0;
  const d1 = new Date(a + "T00:00:00");
  const d2 = new Date(b + "T00:00:00");
  return Math.max(0, Math.round((+d2 - +d1) / 86400000) + 1); // inclusive
}

export default function LeaveRequest() {
  const [form, setForm] = useState<FormState>({
    startDate: "",
    endDate: "",
    reason: "",
  });
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

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

  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const canSubmit = useMemo(() => {
    if (!form.startDate || !form.endDate) return false;
    if (new Date(form.endDate) < new Date(form.startDate)) return false;
    return true;
  }, [form.startDate, form.endDate]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setErr(null);
    setOk(null);
    try {
      setSending(true);
      await api.post("/leaves", form);
      setForm({ startDate: "", endDate: "", reason: "" });
      setOk("Leave request submitted");
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to submit leave");
    } finally {
      setSending(false);
    }
  }

  const days = daysBetween(form.startDate, form.endDate);

  return (
    <div className="space-y-8">
      <header>
        <h2 className="text-3xl font-bold">Request Leave</h2>
        <p className="text-sm text-muted">
          Create a new leave request and track its status.
        </p>
      </header>

      {err && (
        <div className="rounded-md border border-error/20 bg-red-50 px-4 py-2 text-sm text-error">
          {err}
        </div>
      )}
      {ok && (
        <div className="rounded-md border border-success/20 bg-green-50 px-4 py-2 text-sm text-success">
          {ok}
        </div>
      )}

      {/* Form */}
      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-lg font-semibold">New Request</h3>
        </div>
        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Start date</label>
              <input
                type="date"
                min={todayISO}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={form.startDate}
                onChange={(e) =>
                  setForm({ ...form, startDate: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">End date</label>
              <input
                type="date"
                min={form.startDate || todayISO}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Reason</label>
            <textarea
              rows={3}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
              placeholder="Optional note for your manager"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
            />
            <div className="text-xs text-muted">
              {form.startDate && form.endDate && days > 0
                ? `Duration: ${days} day${days > 1 ? "s" : ""}`
                : "Select start and end dates"}
            </div>
          </div>

          <div className="pt-2 flex items-center gap-2">
            <button
              type="submit"
              disabled={!canSubmit || sending}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
            >
              {sending ? "Submitting…" : "Submit"}
            </button>
            <button
              type="button"
              className="rounded-md border border-border px-3 py-2"
              onClick={() =>
                setForm({ startDate: "", endDate: "", reason: "" })
              }
              disabled={sending}
            >
              Reset
            </button>
          </div>

          {!canSubmit && (form.startDate || form.endDate) && (
            <div className="text-xs text-error">
              End date must be the same or after start date.
            </div>
          )}
        </form>
      </section>

      {/* List */}
      <section className="rounded-lg border border-border bg-surface shadow-sm overflow-hidden">
        <div className="border-b border-border px-4 py-3 text-sm text-muted">
          {loading
            ? "Loading…"
            : `${leaves.length} request${leaves.length === 1 ? "" : "s"}`}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block">
          <table className="w-full text-sm">
            <thead className="bg-bg">
              <tr className="text-left">
                <Th>Start</Th>
                <Th>End</Th>
                <Th>Days</Th>
                <Th>Status</Th>
                <Th>Message</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={6} cols={5} />
              ) : leaves.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted">
                    No leave requests yet.
                  </td>
                </tr>
              ) : (
                leaves
                  .slice()
                  .sort(
                    (a, b) => +new Date(b.startDate) - +new Date(a.startDate)
                  )
                  .map((l) => (
                    <tr key={l._id} className="border-t border-border/70">
                      <Td>{new Date(l.startDate).toLocaleDateString()}</Td>
                      <Td>{new Date(l.endDate).toLocaleDateString()}</Td>
                      <Td>{daysBetween(l.startDate, l.endDate)}</Td>
                      <Td>
                        <StatusBadge status={l.status as Leave["status"]} />
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

        {/* Mobile cards */}
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
          ) : leaves.length === 0 ? (
            <div className="px-4 py-6 text-center text-muted">
              No leave requests yet.
            </div>
          ) : (
            leaves
              .slice()
              .sort((a, b) => +new Date(b.startDate) - +new Date(a.startDate))
              .map((l) => (
                <div key={l._id} className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">
                      {new Date(l.startDate).toLocaleDateString()} →{" "}
                      {new Date(l.endDate).toLocaleDateString()}
                    </div>
                    <StatusBadge status={l.status as Leave["status"]} />
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                    <div className="text-muted">Days</div>
                    <div>{daysBetween(l.startDate, l.endDate)}</div>
                    <div className="text-muted">Message</div>
                    <div className="col-span-1">{l.adminMessage || "-"}</div>
                  </div>
                </div>
              ))
          )}
        </div>
      </section>
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
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-3 align-middle">{children}</td>;
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
function StatusBadge({ status }: { status: Leave["status"] }) {
  const map: Record<Leave["status"], string> = {
    PENDING: "bg-accent/10 text-accent",
    APPROVED: "bg-secondary/10 text-secondary",
    REJECTED: "bg-error/10 text-error",
  };
  const label = status.charAt(0) + status.slice(1).toLowerCase();
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${map[status]}`}
    >
      {label}
    </span>
  );
}
