import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { Th, Td } from "../../components/utils/Table";
import { Users } from "lucide-react";

type PresenceRow = {
  employee: { id: string; name: string };
  firstPunchIn?: string;
  lastPunchOut?: string;
  onLeaveToday?: boolean;
  leaveTodayStatus?: "APPROVED" | "PENDING" | string | null;
  startingLeaveTomorrow?: boolean;
  leaveTomorrowStatus?: "APPROVED" | "PENDING" | string | null;
  nextLeaveInDays?: number | null;
  nextLeaveStatus?: "APPROVED" | "PENDING" | string | null;
  isActive?: boolean;
};

type PresenceResponse = {
  today?: string;
  tomorrow?: string;
  rows?: PresenceRow[];
};

function fmtTime(value?: string) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function statusLabel(row: PresenceRow) {
  if (row.firstPunchIn && row.lastPunchOut) return "Punched out";
  if (row.firstPunchIn) return "Punched in";
  return "Not punched in";
}

export default function TeamPresence() {
  const [rows, setRows] = useState<PresenceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  async function load() {
    try {
      setLoading(true);
      setErr(null);
      const res = await api.get<PresenceResponse>(
        "/attendance/company/presence",
      );
      setRows(res.data.rows || []);
      setRefreshedAt(new Date());
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to load presence");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const source = rows
      .slice()
      .sort((a, b) => a.employee.name.localeCompare(b.employee.name));
    if (!q) return source;
    return source.filter((r) => r.employee.name.toLowerCase().includes(q));
  }, [rows, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <Users size={20} />
          <div>
            <h2 className="text-xl font-semibold">Team Presence</h2>
            <p className="text-sm text-muted-foreground">
              Punch-in/out status plus today&apos;s and tomorrow&apos;s leave
              signals.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            type="search"
            placeholder="Search member"
            className="h-9 min-w-[200px] rounded-md border border-border bg-bg px-3 text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {err && (
        <div className="rounded-md border border-error/30 bg-error/10 px-4 py-2 text-sm text-error">
          {err}
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg">
              <tr className="text-left">
                <Th>Member</Th>
                <Th>Punch In</Th>
                <Th>Punch Out</Th>
                <Th>Status</Th>
                <Th>Notes</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-6 py-8 text-center text-muted-foreground"
                  >
                    Loading…
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-6 py-8 text-center text-muted-foreground"
                  >
                    No members found.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => {
                  const status = statusLabel(row);
                  const noteParts: string[] = [];
                  if (row.onLeaveToday) {
                    const st = row.leaveTodayStatus || "PENDING";
                    noteParts.push(
                      st === "APPROVED"
                        ? "On leave today"
                        : "On leave today (pending)",
                    );
                  }
                  if (row.startingLeaveTomorrow) {
                    const st = row.leaveTomorrowStatus || "PENDING";
                    noteParts.push(
                      st === "APPROVED"
                        ? "On leave tomorrow"
                        : "On leave tomorrow (pending)",
                    );
                  }
                  if (
                    row.nextLeaveInDays !== null &&
                    row.nextLeaveInDays !== undefined
                  ) {
                    const days = row.nextLeaveInDays;
                    const statusLabel =
                      row.nextLeaveStatus === "APPROVED"
                        ? "approved"
                        : row.nextLeaveStatus === "PENDING"
                          ? "pending"
                          : "pending";
                    if (days === 1) {
                      noteParts.push(`On leave tomorrow (${statusLabel})`);
                    } else {
                      noteParts.push(
                        `On leave in ${days} days (${statusLabel})`,
                      );
                    }
                  }
                  return (
                    <tr
                      key={row.employee.id}
                      className="border-t border-border/70 hover:bg-bg/60 transition-colors"
                    >
                      <Td className="font-medium">{row.employee.name}</Td>
                      <Td>{fmtTime(row.firstPunchIn)}</Td>
                      <Td>{fmtTime(row.lastPunchOut)}</Td>
                      <Td>
                        <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-xs">
                          {status}
                        </span>
                      </Td>
                      <Td className="text-muted-foreground text-xs">
                        {noteParts.length ? noteParts.join(" · ") : "—"}
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground flex items-center justify-between">
          <div>
            {refreshedAt
              ? `Updated ${refreshedAt.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : "—"}
          </div>
          <div className="hidden sm:block">
            Shows today&apos;s punches, today&apos;s approved leave, and
            tomorrow&apos;s approved/pending leave requests.
          </div>
        </div>
      </section>
    </div>
  );
}
