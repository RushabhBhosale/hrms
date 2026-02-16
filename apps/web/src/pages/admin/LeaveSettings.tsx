import { useState, useEffect, FormEvent, useMemo } from "react";
import { api } from "../../lib/api";
import { toast } from "react-hot-toast";
import { Field } from "../../components/utils/Field";

type FormState = {
  totalAnnual: string;
  ratePerMonth: string;
  probationRatePerMonth: string;
  capsPaid: string;
  capsCasual: string;
  capsSick: string;
  applicableFrom: string;
  accrualStrategy: "ACCRUAL" | "LUMP_SUM";
  sandwichEnabled: boolean;
  sandwichMinDays: string;
};

type Holiday = {
  _id?: string;
  id?: string;
  date: string;
  name?: string;
};

type DayOverride = {
  date: string; // yyyy-mm-dd
  type: "WORKING" | "HOLIDAY" | "HALF_DAY";
  note?: string;
  id?: string;
};

// Define EmployeeLite type globally or in a shared types file
type EmployeeLite = {
  id: string;
  name: string;
  email: string;
  primaryRole?: string;
  employmentStatus?: "PERMANENT" | "PROBATION";
  probationSince?: string | null;
};

// Props for BackfillLeaves component
interface BackfillLeavesProps {
  bfEmployees: EmployeeLite[];
  bfEmpLoading: boolean;
  allowedTypes: BackfillRow["type"][];
}

export default function LeaveSettings() {
  const [form, setForm] = useState<FormState>({
    totalAnnual: "0",
    ratePerMonth: "0",
    probationRatePerMonth: "0",
    capsPaid: "0",
    capsCasual: "0",
    capsSick: "0",
    applicableFrom: "",
    accrualStrategy: "ACCRUAL",
    sandwichEnabled: false,
    sandwichMinDays: "5",
  });
  const [submitting, setSubmitting] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [holidayYear, setHolidayYear] = useState<string>("");
  const [hForm, setHForm] = useState<Holiday>({ date: "", name: "" });
  const [hSubmitting, setHSubmitting] = useState(false);
  const [hErr, setHErr] = useState<string | null>(null);
  const [editHoliday, setEditHoliday] = useState<{
    id: string;
    date: string;
    name: string;
  } | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [deletingHolidayId, setDeletingHolidayId] = useState<string | null>(
    null,
  );
  const [resetting, setResetting] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  // Company Day Overrides
  const [ovMonth, setOvMonth] = useState<string>(
    new Date().toISOString().slice(0, 7),
  );
  const [overrides, setOverrides] = useState<DayOverride[]>([]);
  const [ovForm, setOvForm] = useState<DayOverride>({
    date: "",
    type: "WORKING",
    note: "",
  });
  const [ovSubmitting, setOvSubmitting] = useState(false);
  const [ovErr, setOvErr] = useState<string | null>(null);
  const [confirmOverrideDelete, setConfirmOverrideDelete] = useState<{
    date: string;
    label: string;
    id?: string;
  } | null>(null);
  const [deletingOverride, setDeletingOverride] = useState<string | null>(null);
  const [cleanupDate, setCleanupDate] = useState<string>("");
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [cleanupMsg, setCleanupMsg] = useState<string | null>(null);
  const [cleanupErr, setCleanupErr] = useState<string | null>(null);

  // Employees for dropdown in backfill rows
  const [bfEmployees, setBfEmployees] = useState<EmployeeLite[]>([]);
  const [bfEmpLoading, setBfEmpLoading] = useState(false);
  const [probationBusy, setProbationBusy] = useState<Record<string, boolean>>(
    {},
  );

  const isAccrualStrategy = form.accrualStrategy === "ACCRUAL";

  const allowedTypes = useMemo<BackfillRow["type"][]>(() => {
    const arr: BackfillRow["type"][] = [];
    if ((parseInt(form.capsPaid, 10) || 0) > 0) arr.push("PAID");
    if ((parseInt(form.capsCasual, 10) || 0) > 0) arr.push("CASUAL");
    if ((parseInt(form.capsSick, 10) || 0) > 0) arr.push("SICK");
    arr.push("UNPAID");
    return arr;
  }, [form.capsPaid, form.capsCasual, form.capsSick]);

  const sortedEmployees = useMemo(
    () =>
      [...bfEmployees].sort((a, b) =>
        a.name.localeCompare(b.name, "en", {
          sensitivity: "base",
        }),
      ),
    [bfEmployees],
  );
  const holidaysByYear = useMemo(() => {
    const byYear = new Map<string, Holiday[]>();
    holidays.forEach((holiday) => {
      const parsed = new Date(holiday.date);
      const year = Number.isNaN(parsed.getTime())
        ? "Unknown"
        : String(parsed.getFullYear());
      const list = byYear.get(year) || [];
      list.push(holiday);
      byYear.set(year, list);
    });
    for (const [year, list] of byYear.entries()) {
      list.sort((a, b) => {
        const aTime = new Date(a.date).getTime();
        const bTime = new Date(b.date).getTime();
        if (Number.isNaN(aTime) && Number.isNaN(bTime)) return 0;
        if (Number.isNaN(aTime)) return 1;
        if (Number.isNaN(bTime)) return -1;
        return aTime - bTime;
      });
      byYear.set(year, list);
    }
    const entries = Array.from(byYear.entries());
    entries.sort((a, b) => {
      if (a[0] === "Unknown") return 1;
      if (b[0] === "Unknown") return -1;
      return Number(b[0]) - Number(a[0]);
    });
    return entries;
  }, [holidays]);

  const activeHolidayYear = useMemo(() => {
    if (holidaysByYear.length === 0) return "";
    const years = holidaysByYear.map(([year]) => year);
    if (holidayYear && years.includes(holidayYear)) return holidayYear;
    return years[0];
  }, [holidaysByYear, holidayYear]);

  useEffect(() => {
    if (holidayYear !== activeHolidayYear) {
      setHolidayYear(activeHolidayYear);
    }
  }, [activeHolidayYear, holidayYear]);

  const holidayList = useMemo(() => {
    if (!activeHolidayYear) return [];
    const entry = holidaysByYear.find(([year]) => year === activeHolidayYear);
    return entry ? entry[1] : [];
  }, [holidaysByYear, activeHolidayYear]);

  const sortedOverrides = useMemo(() => {
    return [...overrides].sort((a, b) => {
      const aTime = new Date(a.date).getTime();
      const bTime = new Date(b.date).getTime();
      if (Number.isNaN(aTime) && Number.isNaN(bTime)) return 0;
      if (Number.isNaN(aTime)) return 1;
      if (Number.isNaN(bTime)) return -1;
      return aTime - bTime;
    });
  }, [overrides]);

  function formatProbationSince(value?: string | null) {
    if (!value) return "—";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "—";
    return parsed.toLocaleDateString();
  }

  function formatOverrideType(type: DayOverride["type"]) {
    switch (type) {
      case "HALF_DAY":
        return "Half Day";
      case "WORKING":
        return "Working Day";
      case "HOLIDAY":
      default:
        return "Holiday";
    }
  }

  function overrideTone(type: DayOverride["type"]) {
    switch (type) {
      case "WORKING":
        return "bg-secondary/10 text-secondary";
      case "HALF_DAY":
        return "bg-primary/10 text-primary";
      case "HOLIDAY":
      default:
        return "bg-accent/10 text-accent";
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/companies/leave-policy");
        const p = res.data.leavePolicy || {};
        setForm({
          totalAnnual: String(p.totalAnnual ?? 0),
          ratePerMonth: String(p.ratePerMonth ?? 0),
          probationRatePerMonth: String(p.probationRatePerMonth ?? 0),
          capsPaid: String(p.typeCaps?.paid ?? 0),
          capsCasual: String(p.typeCaps?.casual ?? 0),
          capsSick: String(p.typeCaps?.sick ?? 0),
          applicableFrom: p.applicableFrom || "",
          accrualStrategy: (p.accrualStrategy || "ACCRUAL") as
            | "ACCRUAL"
            | "LUMP_SUM",
          sandwichEnabled: !!p.sandwich?.enabled,
          sandwichMinDays: String(
            Number.isFinite(p.sandwich?.minDays) ? p.sandwich?.minDays : 5,
          ),
        });
      } catch {
        // ignore
      }
      try {
        const res = await api.get("/companies/bank-holidays");
        setHolidays(res.data.bankHolidays || []);
      } catch {
        // ignore
      }
      try {
        const m = new Date().toISOString().slice(0, 7);
        const res = await api.get("/companies/day-overrides", {
          params: { month: m },
        });
        setOverrides(res.data.overrides || []);
        setOvMonth(m);
      } catch {
        // ignore
      }
      // Load employees list (for backfill dropdown)
      try {
        setBfEmpLoading(true);
        const er = await api.get("/companies/employees");
        setBfEmployees(er.data.employees || []);
      } catch {
        // ignore
      } finally {
        setBfEmpLoading(false);
      }
    })();
  }, []);

  function onChange<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setOk(null);
    setErr(null);
    try {
      setSubmitting(true);
      await api.put("/companies/leave-policy", {
        totalAnnual: parseInt(form.totalAnnual, 10) || 0,
        ratePerMonth: parseFloat(form.ratePerMonth) || 0,
        probationRatePerMonth: parseFloat(form.probationRatePerMonth) || 0,
        accrualStrategy: form.accrualStrategy,
        applicableFrom: form.applicableFrom,
        typeCaps: {
          paid: parseInt(form.capsPaid, 10) || 0,
          casual: parseInt(form.capsCasual, 10) || 0,
          sick: parseInt(form.capsSick, 10) || 0,
        },
        sandwich: {
          enabled: form.sandwichEnabled,
          minDays: parseInt(form.sandwichMinDays, 10) || 0,
        },
      });
      setOk("Leave policy updated");
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to update leave policy");
    } finally {
      setSubmitting(false);
    }
  }

  function onHolidayChange<K extends keyof Holiday>(key: K, value: Holiday[K]) {
    setHForm((prev) => ({ ...prev, [key]: value }));
  }

  async function addHoliday(e: FormEvent) {
    e.preventDefault();
    setHErr(null);
    try {
      setHSubmitting(true);
      const res = await api.post("/companies/bank-holidays", {
        date: hForm.date,
        name: hForm.name,
      });
      setHolidays(res.data.bankHolidays || []);
      setHForm({ date: "", name: "" });
    } catch (e: any) {
      setHErr(e?.response?.data?.error || "Failed to add bank holiday");
    } finally {
      setHSubmitting(false);
    }
  }

  function startEditingHoliday(holiday: Holiday) {
    const holidayId = holiday._id || holiday.id;
    if (!holidayId) {
      toast.error("Unable to edit this holiday");
      return;
    }
    setEditHoliday({
      id: holidayId,
      date: holiday.date
        ? new Date(holiday.date).toISOString().slice(0, 10)
        : "",
      name: holiday.name || "",
    });
    setHErr(null);
  }

  function onEditHolidayChange(key: "date" | "name", value: string) {
    setEditHoliday((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function saveHolidayChanges(e: FormEvent) {
    e.preventDefault();
    if (!editHoliday?.id) return;
    setHErr(null);
    try {
      setEditSubmitting(true);
      const res = await api.put(`/companies/bank-holidays/${editHoliday.id}`, {
        date: editHoliday.date,
        name: editHoliday.name,
      });
      setHolidays(res.data.bankHolidays || []);
      setEditHoliday(null);
    } catch (e: any) {
      setHErr(e?.response?.data?.error || "Failed to update bank holiday");
    } finally {
      setEditSubmitting(false);
    }
  }

  async function deleteHoliday(holidayId: string) {
    if (!holidayId) return;
    if (!window.confirm("Delete this bank holiday?")) return;
    setHErr(null);
    try {
      setDeletingHolidayId(holidayId);
      const res = await api.delete(`/companies/bank-holidays/${holidayId}`);
      setHolidays(res.data.bankHolidays || []);
      if (editHoliday?.id === holidayId) {
        setEditHoliday(null);
      }
    } catch (e: any) {
      setHErr(e?.response?.data?.error || "Failed to delete bank holiday");
    } finally {
      setDeletingHolidayId(null);
    }
  }

  async function loadOverrides(month: string) {
    try {
      const res = await api.get("/companies/day-overrides", {
        params: { month },
      });
      setOverrides(res.data.overrides || []);
    } catch (e) {
      // ignore
    }
  }

  async function deleteOverride(value: string) {
    if (!value) return;
    setOvErr(null);
    try {
      setDeletingOverride(value);
      await api.delete(`/companies/day-overrides/${encodeURIComponent(value)}`);
      await loadOverrides(ovMonth);
    } catch (e) {
      setOvErr(
        (e as any)?.response?.data?.error || "Failed to delete override",
      );
      toast.error("Failed to delete override");
    } finally {
      setDeletingOverride(null);
      setConfirmOverrideDelete(null);
    }
  }

  function onOvChange<K extends keyof DayOverride>(
    key: K,
    value: DayOverride[K],
  ) {
    setOvForm((prev) => ({ ...prev, [key]: value }));
  }

  async function addOverride(e: FormEvent) {
    e.preventDefault();
    setOvErr(null);
    try {
      setOvSubmitting(true);
      const res = await api.post("/companies/day-overrides", {
        date: ovForm.date,
        type: ovForm.type,
        note: ovForm.note,
      });
      setOverrides(res.data.overrides || []);
      setOvForm({ date: "", type: "WORKING", note: "" });
    } catch (e: any) {
      setOvErr(e?.response?.data?.error || "Failed to save override");
    } finally {
      setOvSubmitting(false);
    }
  }

  async function runAutoLeaveCleanup(e: FormEvent) {
    e.preventDefault();
    setCleanupMsg(null);
    setCleanupErr(null);
    if (!cleanupDate) {
      setCleanupErr("Select a date to clear auto leaves for.");
      return;
    }
    try {
      setCleanupBusy(true);
      const res = await api.post("/attendance/admin/auto-leave/bulk-resolve", {
        date: cleanupDate,
      });
      const data = res.data || {};
      const resolvedCount = Number(data.resolved) || 0;
      const deletedCount = Number(data.autoLeavesDeleted) || 0;
      const failedCount = Number(data.failed) || 0;
      const targetDate = data.date || cleanupDate;
      const bits = [
        `resolved ${resolvedCount} penalties`,
        `removed ${deletedCount} auto leave records`,
      ];
      if (failedCount > 0) bits.push(`${failedCount} failed`);
      setCleanupMsg(
        `Cleared auto leaves for ${targetDate}: ${bits.join(", ")}.`,
      );
    } catch (e: any) {
      setCleanupErr(
        e?.response?.data?.error ||
          "Failed to clear auto leaves for the selected date",
      );
    } finally {
      setCleanupBusy(false);
    }
  }

  async function updateEmploymentStatus(
    empId: string,
    next: "PROBATION" | "PERMANENT",
  ) {
    setProbationBusy((prev) => ({ ...prev, [empId]: true }));
    try {
      const res = await api.put(`/companies/employees/${empId}/probation`, {
        status: next,
      });
      const payload = res.data?.employee;
      setBfEmployees((prev) =>
        prev.map((emp) =>
          emp.id === empId
            ? {
                ...emp,
                employmentStatus:
                  (payload?.employmentStatus as EmployeeLite["employmentStatus"]) ??
                  next,
                probationSince: payload?.probationSince ?? null,
              }
            : emp,
        ),
      );
      toast.success(
        next === "PROBATION"
          ? "Employee moved to probation"
          : "Employee marked permanent",
      );
    } catch (e: any) {
      toast.error(
        e?.response?.data?.error || "Failed to update employment status",
      );
    } finally {
      setProbationBusy((prev) => {
        const copy = { ...prev };
        delete copy[empId];
        return copy;
      });
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold">Leave Settings</h2>
        <p className="text-sm text-muted-foreground">
          Manage default leave allocation.
        </p>
      </div>

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

      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-lg font-semibold">Leave Policy</h3>
        </div>

        <form onSubmit={submit} className="px-6 py-5 space-y-5">
          <div className="grid gap-4 md:grid-cols-4">
            <Field label="Accrual Strategy">
              <>
                <select
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                  value={form.accrualStrategy}
                  onChange={(e) =>
                    onChange(
                      "accrualStrategy",
                      (e.target.value as FormState["accrualStrategy"]) ||
                        "ACCRUAL",
                    )
                  }
                >
                  <option value="ACCRUAL">Accrue every month</option>
                  <option value="LUMP_SUM">Grant full balance at once</option>
                </select>
                <p className="text-xs text-muted-foreground">
                  Choose whether leaves accrue monthly or are allocated upfront.
                </p>
              </>
            </Field>
            <Field label="Total Annual Leaves" required>
              <input
                type="number"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={form.totalAnnual}
                onChange={(e) => onChange("totalAnnual", e.target.value)}
              />
            </Field>
            <Field label="Accrual Per Month" required={isAccrualStrategy}>
              <input
                type="number"
                step="0.5"
                disabled={!isAccrualStrategy}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
                value={form.ratePerMonth}
                onChange={(e) => onChange("ratePerMonth", e.target.value)}
              />
            </Field>
            <Field label="Probation Accrual Per Month">
              <>
                <input
                  type="number"
                  step="0.5"
                  disabled={!isAccrualStrategy}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
                  value={form.probationRatePerMonth}
                  onChange={(e) =>
                    onChange("probationRatePerMonth", e.target.value)
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Used when an employee is marked as on probation.
                </p>
              </>
            </Field>
            <div className="md:col-span-2">
              <Field label="Leave Applicable From">
                <>
                  <input
                    type="month"
                    disabled={!isAccrualStrategy}
                    className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
                    value={form.applicableFrom}
                    onChange={(e) => onChange("applicableFrom", e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Month when accrual should begin. Ignored when granting the
                    full balance upfront.
                  </p>
                </>
              </Field>
            </div>
            <div className="md:col-span-4">
              <Field label="Sandwich Policy">
                <div className="space-y-2">
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.sandwichEnabled}
                      onChange={(e) =>
                        onChange("sandwichEnabled", e.target.checked)
                      }
                    />
                    <span className="font-medium">
                      Include weekends and holidays for long leave spans
                    </span>
                  </label>
                  <p className="text-xs text-muted-foreground">
                    When enabled, weekends and holidays sandwiched between
                    consecutive leave days are deducted once the minimum length
                    is reached.
                  </p>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      Minimum consecutive days
                    </span>
                    <input
                      type="number"
                      min={1}
                      className="w-24 rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
                      value={form.sandwichMinDays}
                      onChange={(e) =>
                        onChange("sandwichMinDays", e.target.value)
                      }
                      disabled={!form.sandwichEnabled}
                    />
                  </div>
                </div>
              </Field>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3 border-t border-border pt-5 mt-2">
            <Field label="Paid Cap (from total)" required>
              <input
                type="number"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={form.capsPaid}
                onChange={(e) => onChange("capsPaid", e.target.value)}
              />
            </Field>
            <Field label="Casual Cap (from total)" required>
              <input
                type="number"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={form.capsCasual}
                onChange={(e) => onChange("capsCasual", e.target.value)}
              />
            </Field>
            <Field label="Sick Cap (from total)" required>
              <input
                type="number"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={form.capsSick}
                onChange={(e) => onChange("capsSick", e.target.value)}
              />
            </Field>
          </div>
          <div className="pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
            >
              {submitting ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              disabled={resetting}
              onClick={async () => {
                setResetMsg(null);
                if (
                  !window.confirm(
                    "Reset all employees' leave balances? This will zero out usage and pool, then re-accrue to current month.",
                  )
                )
                  return;
                try {
                  setResetting(true);
                  const res = await api.post(
                    "/companies/leave-balances/reset",
                    { reaccrue: true },
                  );
                  setResetMsg(
                    `Reset completed for ${res.data.count || 0} employees.`,
                  );
                } catch (e: any) {
                  setResetMsg(
                    e?.response?.data?.error ||
                      "Failed to reset leave balances",
                  );
                } finally {
                  setResetting(false);
                }
              }}
              className="ml-3 inline-flex items-center justify-center rounded-md border border-error/30 bg-error/10 px-4 py-2 text-error hover:bg-error/15 disabled:opacity-60"
            >
              {resetting ? "Resetting…" : "Reset Leave Balances"}
            </button>
            {resetMsg && (
              <span className="ml-3 text-sm text-muted-foreground">
                {resetMsg}
              </span>
            )}
          </div>
        </form>
      </section>

      {/* <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-6 py-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Employment Status</h3>
        </div>
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-muted-foreground">
            Toggle employees between permanent and probation. Probation staff use
            the probation accrual rate you set above.
          </p>
          {bfEmpLoading ? (
            <p className="text-sm text-muted-foreground">Loading employees…</p>
          ) : sortedEmployees.length === 0 ? (
            <p className="text-sm text-muted-foreground">No employees found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="py-2 pr-4 font-medium">Employee</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 font-medium">Probation Since</th>
                    <th className="py-2 pr-0 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedEmployees.map((emp) => {
                    const status =
                      (emp.employmentStatus || "PROBATION") === "PROBATION"
                        ? "Probation"
                        : "Permanent";
                    const disableToggle =
                      ["ADMIN", "SUPERADMIN"].includes(emp.primaryRole || "");
                    const nextStatus =
                      (emp.employmentStatus || "PROBATION") === "PROBATION"
                        ? "PERMANENT"
                        : "PROBATION";
                    const busy = Boolean(probationBusy[emp.id]);
                    return (
                      <tr key={emp.id} className="border-b border-border/60">
                        <td className="py-2 pr-4">
                          <div className="font-medium">{emp.name}</div>
                          <div className="text-xs text-muted-foreground">{emp.email}</div>
                        </td>
                        <td className="py-2 pr-4">{status}</td>
                        <td className="py-2 pr-4">
                          {status === "Probation"
                            ? formatProbationSince(emp.probationSince)
                            : "—"}
                        </td>
                        <td className="py-2 pr-0 text-right">
                          {disableToggle ? (
                            <span className="text-xs text-muted-foreground">
                              Admin accounts stay permanent
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => updateEmploymentStatus(emp.id, nextStatus)}
                              className="inline-flex items-center justify-center rounded-md border border-border bg-bg px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-60"
                            >
                              {busy
                                ? "Updating…"
                                : nextStatus === "PROBATION"
                                ? "Set Probation"
                                : "Mark Permanent"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section> */}

      {hErr && (
        <div className="rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
          {hErr}
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-lg font-semibold">Bank Holidays</h3>
        </div>
        <div className="px-6 py-5 space-y-5">
          {holidays.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No holidays added.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-md border border-border overflow-hidden bg-surface">
                  {holidaysByYear.map(([year], index) => {
                    const label = year === "Unknown" ? "Unknown" : year;
                    const active = year === activeHolidayYear;
                    return (
                      <button
                        key={year}
                        type="button"
                        onClick={() => setHolidayYear(year)}
                        title={year === "Unknown" ? "Unknown" : year}
                        className={`px-3 py-1.5 text-sm ${
                          index > 0 ? "border-l border-border" : ""
                        } ${
                          active ? "bg-primary/10 text-primary font-medium" : ""
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <ul className="space-y-3">
                {holidayList.length === 0 && (
                  <li className="text-sm text-muted-foreground">
                    No holidays for this year.
                  </li>
                )}
                {holidayList.map((h) => {
                  const refId = h._id || h.id;
                  const listKey = refId || h.date;
                  const isEditing = !!refId && editHoliday?.id === refId;
                  const isDeleting = !!refId && deletingHolidayId === refId;
                  return (
                    <li
                      key={listKey}
                      className="rounded-md border border-border/60 px-3 py-3"
                    >
                      {isEditing && editHoliday ? (
                        <form
                          onSubmit={saveHolidayChanges}
                          className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto]"
                        >
                          <div className="space-y-1">
                            <label className="text-xs font-medium required-label">
                              Date
                            </label>
                            <input
                              type="date"
                              value={editHoliday.date}
                              onChange={(e) =>
                                onEditHolidayChange("date", e.target.value)
                              }
                              className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-medium required-label">
                              Name
                            </label>
                            <input
                              type="text"
                              value={editHoliday.name}
                              onChange={(e) =>
                                onEditHolidayChange("name", e.target.value)
                              }
                              className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                            />
                          </div>
                          <div className="flex items-end gap-2">
                            <button
                              type="submit"
                              disabled={editSubmitting}
                              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
                            >
                              {editSubmitting ? "Saving..." : "Save"}
                            </button>
                            <button
                              type="button"
                              disabled={editSubmitting}
                              onClick={() => setEditHoliday(null)}
                              className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-60"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              disabled={editSubmitting || isDeleting}
                              onClick={() => refId && deleteHoliday(refId)}
                              className="inline-flex items-center justify-center rounded-md border border-error/40 bg-error/10 px-4 py-2 text-sm text-error hover:bg-error/15 disabled:opacity-60"
                            >
                              {isDeleting ? "Deleting..." : "Delete"}
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                          <div className="text-sm">
                            {new Date(h.date).toLocaleDateString()}
                            {h.name ? ` - ${h.name}` : ""}
                          </div>
                          <div className="flex items-center gap-2 self-start">
                            <button
                              type="button"
                              className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-bg"
                              onClick={() => startEditingHoliday(h)}
                              disabled={!refId}
                              title={
                                !refId
                                  ? "Unable to edit this holiday"
                                  : undefined
                              }
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="rounded-md border border-error/40 bg-error/10 px-3 py-1.5 text-xs text-error hover:bg-error/15 disabled:opacity-60"
                              onClick={() => refId && deleteHoliday(refId)}
                              disabled={!refId || isDeleting}
                              title={
                                !refId
                                  ? "Unable to delete this holiday"
                                  : undefined
                              }
                            >
                              {isDeleting ? "Deleting..." : "Delete"}
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <form
            onSubmit={addHoliday}
            className="grid gap-4 md:grid-cols-3 items-end"
          >
            <div className="space-y-2">
              <label className="text-sm font-medium required-label">Date</label>
              <input
                type="date"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={hForm.date}
                onChange={(e) => onHolidayChange("date", e.target.value)}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium required-label">Name</label>
              <input
                type="text"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={hForm.name}
                onChange={(e) => onHolidayChange("name", e.target.value)}
              />
            </div>
            <button
              type="submit"
              disabled={hSubmitting}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
            >
              {hSubmitting ? "Adding..." : "Add"}
            </button>
          </form>
        </div>
      </section>

      {ovErr && (
        <div className="rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
          {ovErr}
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-6 py-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Day Overrides</h3>
          <div className="inline-flex items-center gap-2">
            <label className="text-sm text-muted-foreground">Month</label>
            <input
              type="month"
              value={ovMonth}
              onChange={async (e) => {
                setOvMonth(e.target.value);
                await loadOverrides(e.target.value);
              }}
              className="rounded-md border border-border bg-surface px-3 py-2"
            />
          </div>
        </div>
        <div className="px-6 py-5 space-y-5">
          <p className="text-sm text-muted-foreground">
            Declare exceptions: mark a working day as Holiday or Half-Day; or
            lift a weekend/bank holiday as Working.
          </p>
          {sortedOverrides.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No overrides for {ovMonth}.
            </div>
          ) : (
            <ul className="space-y-3">
              {sortedOverrides.map((o) => (
                <li
                  key={o.date}
                  className="rounded-md border border-border/60 px-3 py-3"
                >
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div className="text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{new Date(o.date).toLocaleDateString()}</span>
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${overrideTone(
                            o.type,
                          )}`}
                        >
                          {formatOverrideType(o.type)}
                        </span>
                      </div>
                      {o.note ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {o.note}
                        </div>
                      ) : null}
                    </div>
                    <button
                      className="self-start rounded-md border border-border px-3 py-1.5 text-xs hover:bg-bg"
                      onClick={() =>
                        setConfirmOverrideDelete({
                          date: o.date,
                          id: (o as any).id || (o as any)._id,
                          label: new Date(o.date).toLocaleDateString(),
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <form
            onSubmit={addOverride}
            className="grid gap-4 md:grid-cols-4 items-end"
          >
            <div className="space-y-2">
              <label className="text-sm font-medium required-label">Date</label>
              <input
                type="date"
                value={ovForm.date}
                onChange={(e) => onOvChange("date", e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium required-label">Type</label>
              <select
                value={ovForm.type}
                onChange={(e) =>
                  onOvChange("type", e.target.value as DayOverride["type"])
                }
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="WORKING">Working Day</option>
                <option value="HOLIDAY">Holiday</option>
                <option value="HALF_DAY">Half-Day</option>
              </select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium">Note (optional)</label>
              <input
                type="text"
                value={ovForm.note || ""}
                onChange={(e) => onOvChange("note", e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                placeholder="e.g., Special working Saturday"
              />
            </div>
            <button
              type="submit"
              disabled={ovSubmitting}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
            >
              {ovSubmitting ? "Saving..." : "Save"}
            </button>
          </form>
        </div>
      </section>

      {confirmOverrideDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md space-y-4 rounded-lg border border-border bg-surface p-6 shadow-xl">
            <div>
              <h4 className="text-lg font-semibold">Delete override</h4>
              <p className="mt-1 text-sm text-muted-foreground">
                Are you sure you want to delete the override for{" "}
                {confirmOverrideDelete.label}?
              </p>
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmOverrideDelete(null)}
                className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
                disabled={deletingOverride === confirmOverrideDelete.date}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() =>
                  deleteOverride(
                    confirmOverrideDelete.id || confirmOverrideDelete.date,
                  )
                }
                disabled={
                  deletingOverride === confirmOverrideDelete.date ||
                  deletingOverride === confirmOverrideDelete.id
                }
                className="rounded-md border border-error/40 bg-error/10 px-4 py-2 text-sm text-error hover:bg-error/15 disabled:opacity-60"
              >
                {deletingOverride === confirmOverrideDelete.date
                  ? "Deleting..."
                  : deletingOverride === confirmOverrideDelete.id
                    ? "Deleting..."
                    : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-lg font-semibold">Auto Leave Cleanup</h3>
        </div>
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-muted-foreground">
            Remove auto-applied leave deductions for a date that was marked as a
            working day by mistake. Mark the date as a holiday override first,
            then clear the auto leave entries here.
          </p>
          {cleanupErr && (
            <div className="rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
              {cleanupErr}
            </div>
          )}
          {cleanupMsg && (
            <div className="rounded-md border border-success/20 bg-success/10 px-4 py-2 text-sm text-success">
              {cleanupMsg}
            </div>
          )}
          <form
            onSubmit={runAutoLeaveCleanup}
            className="grid items-end gap-4 md:grid-cols-[minmax(0,220px)_1fr]"
          >
            <div className="space-y-2">
              <label className="text-sm font-medium required-label">
                Date to clear
              </label>
              <input
                type="date"
                value={cleanupDate}
                onChange={(e) => setCleanupDate(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
              <button
                type="submit"
                disabled={cleanupBusy || !cleanupDate}
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
              >
                {cleanupBusy ? "Clearing..." : "Clear auto leaves"}
              </button>
              <span className="text-xs text-muted-foreground">
                Example: clear 2024-12-06 after switching it back to a holiday.
              </span>
            </div>
          </form>
        </div>
      </section>

      {/* Pass bfEmployees and bfEmpLoading as props */}
      <BackfillLeaves
        bfEmployees={bfEmployees}
        bfEmpLoading={bfEmpLoading}
        allowedTypes={allowedTypes}
      />
    </div>
  );
}

type BackfillRow = {
  email: string;
  type: "PAID" | "CASUAL" | "SICK" | "UNPAID";
  startDate: string; // yyyy-mm-dd
  endDate: string; // yyyy-mm-dd
  fallbackType?: "PAID" | "CASUAL" | "SICK" | "UNPAID" | "";
  reason?: string;
  _err?: string;
};

function isBackfillRowEmpty(r: BackfillRow) {
  return !r.email && !r.startDate && !r.endDate && !r.reason && !r.fallbackType;
}

function toCsv(rows: BackfillRow[]) {
  const header = "email,type,startDate,endDate,fallbackType,reason";
  const body = rows
    .map((r) =>
      [
        r.email,
        r.type,
        r.startDate,
        r.endDate,
        r.fallbackType || "",
        (r.reason || "").replace(/"/g, '""'),
      ]
        .map((c) => (c?.includes(",") ? `"${c}"` : c))
        .join(","),
    )
    .join("\n");
  return `${header}\n${body}`;
}

function parseCsv(text: string): BackfillRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];
  const hasHeader = /email\s*,\s*type/i.test(lines[0]);
  const start = hasHeader ? 1 : 0;
  const out: BackfillRow[] = [];
  for (let i = start; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    if (cols.length < 4) continue;
    const [email, type, startDate, endDate, fallbackType, reason] = cols;
    out.push({
      email,
      type: (type as BackfillRow["type"]) || "PAID",
      startDate,
      endDate,
      fallbackType: (fallbackType as BackfillRow["fallbackType"]) || "",
      reason,
    });
  }
  return out;
}

// make validateRow depend on allowedTypes
function validateRow(
  r: BackfillRow,
  allowed: BackfillRow["type"][],
): string | null {
  if (isBackfillRowEmpty(r)) return null;
  if (!/.+@.+\..+/.test(r.email)) return "Invalid email";
  if (!allowed.includes(r.type)) return "Invalid type";
  if (!r.startDate || !/^\d{4}-\d{2}-\d{2}$/.test(r.startDate))
    return "Invalid start date";
  if (!r.endDate || !/^\d{4}-\d{2}-\d{2}$/.test(r.endDate))
    return "Invalid end date";
  if (new Date(r.startDate) > new Date(r.endDate))
    return "Start date must be before end date";
  if (r.fallbackType && !allowed.includes(r.fallbackType as any))
    return "Invalid fallback type";
  return null;
}

function BackfillLeaves({
  bfEmployees,
  bfEmpLoading,
  allowedTypes,
}: BackfillLeavesProps) {
  const [rows, setRows] = useState<BackfillRow[]>([
    {
      email: "",
      type: allowedTypes[0] ?? "UNPAID",
      startDate: "",
      endDate: "",
      fallbackType: "",
      reason: "",
    },
  ]);
  const [approve, setApprove] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setRows((prev) =>
      prev.map((r) => {
        const type = allowedTypes.includes(r.type)
          ? r.type
          : (allowedTypes[0] ?? "UNPAID");
        const fallbackType =
          r.fallbackType && allowedTypes.includes(r.fallbackType as any)
            ? r.fallbackType
            : "";
        return {
          ...r,
          type,
          fallbackType,
          _err:
            validateRow({ ...r, type, fallbackType }, allowedTypes) ||
            undefined,
        };
      }),
    );
  }, [allowedTypes]);

  const validCount = useMemo(
    () =>
      rows.filter(
        (r) => !isBackfillRowEmpty(r) && !validateRow(r, allowedTypes),
      ).length,
    [rows, allowedTypes], // add allowedTypes here
  );
  const nonEmptyCount = useMemo(
    () => rows.filter((r) => !isBackfillRowEmpty(r)).length,
    [rows],
  );
  const invalidCount = useMemo(
    () => Math.max(0, nonEmptyCount - validCount),
    [nonEmptyCount, validCount],
  );

  function update(i: number, patch: Partial<BackfillRow>) {
    setRows((prev) =>
      prev.map((r, idx) =>
        idx === i
          ? (() => {
              const next = { ...r, ...patch };
              if (!allowedTypes.includes(next.type))
                next.type = allowedTypes[0] ?? "UNPAID";
              if (
                next.fallbackType &&
                !allowedTypes.includes(next.fallbackType as any)
              )
                next.fallbackType = "";
              return {
                ...next,
                _err: validateRow(next, allowedTypes) || undefined,
              };
            })()
          : r,
      ),
    );
  }
  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        email: "",
        type: allowedTypes[0] ?? "UNPAID",
        startDate: "",
        endDate: "",
        fallbackType: "",
        reason: "",
      },
    ]);
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function importCsv(file: File) {
    const text = await file.text();
    const parsed = parseCsv(text);
    if (!parsed.length) {
      setErr("No valid rows found in CSV");
      return;
    }
    const normalized = parsed.map((r) => {
      const type = allowedTypes.includes(r.type)
        ? r.type
        : (allowedTypes[0] ?? "UNPAID");
      const fallbackType =
        r.fallbackType && allowedTypes.includes(r.fallbackType as any)
          ? r.fallbackType
          : "";
      const row = { ...r, type, fallbackType } as BackfillRow;
      return { ...row, _err: validateRow(row, allowedTypes) || undefined };
    });
    setErr(null);
    setMsg(`Imported ${normalized.length} rows from CSV`);
    setRows(normalized);
  }

  function downloadTemplate() {
    const sample: BackfillRow[] = [
      {
        email: "jane@example.com",
        type: "PAID",
        startDate: "2025-02-10",
        endDate: "2025-02-12",
        fallbackType: "SICK",
        reason: "Flu",
      },
    ];
    const blob = new Blob([toCsv(sample)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "leave-backfill-template.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function submit() {
    setErr(null);
    setMsg(null);
    // Validate all rows once more
    const next = rows.map((r) => ({
      ...r,
      _err: validateRow(r, allowedTypes) || undefined,
    }));
    setRows(next);
    const nonEmpty = next.filter((r) => !isBackfillRowEmpty(r));
    const invalid = nonEmpty.filter((r) => r._err);
    if (invalid.length) {
      setErr(`Fix ${invalid.length} row(s) with errors before submitting.`);
      return;
    }
    if (!nonEmpty.length) {
      setErr("Nothing to submit.");
      return;
    }
    try {
      setBusy(true);
      const res = await api.post("/leaves/backfill", {
        entries: nonEmpty.map(({ _err, ...r }) => r),
        approve,
      });
      const msg = `Created ${res.data.created || 0}, Approved ${
        res.data.approved || 0
      }${
        (res.data.errors || []).length
          ? `, Errors: ${res.data.errors.length}`
          : ""
      }`;
      setMsg(msg);
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to backfill");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface shadow-sm">
      <div className="border-b border-border px-6 py-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold">Backfill Historical Leaves</h3>
        <div className="flex items-center gap-2">
          <label className="text-sm inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={approve}
              onChange={(e) => setApprove(e.target.checked)}
            />
            Approve on import
          </label>
          <button
            type="button"
            onClick={downloadTemplate}
            className="rounded-md border border-border bg-bg px-3 py-2 text-sm hover:bg-muted"
          >
            Download CSV template
          </button>
          <label className="rounded-md border border-border bg-bg px-3 py-2 text-sm hover:bg-muted cursor-pointer">
            Import CSV
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) =>
                e.target.files?.[0] && importCsv(e.target.files[0])
              }
            />
          </label>
        </div>
      </div>

      <div className="px-6 py-5 space-y-4">
        {err && (
          <div className="rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
            {err}
          </div>
        )}
        {msg && (
          <div className="rounded-md border border-success/20 bg-success/10 px-4 py-2 text-sm text-success">
            {msg}
          </div>
        )}

        <div className="overflow-auto">
          <table className="min-w-[880px] w-full text-sm">
            <thead>
              <tr className="bg-bg border-b border-border text-left">
                <th className="px-2 py-2 font-medium">Employee</th>
                <th className="px-2 py-2 font-medium">Type</th>
                <th className="px-2 py-2 font-medium">Start</th>
                <th className="px-2 py-2 font-medium">End</th>
                <th className="px-2 py-2 font-medium">Fallback</th>
                <th className="px-2 py-2 font-medium">Reason</th>
                <th className="px-2 py-2 font-medium w-[60px]"> </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-border/60 align-top">
                  <td className="px-2 py-2">
                    <select
                      value={r.email}
                      onChange={(e) => {
                        e.preventDefault();
                        update(i, { email: e.target.value });
                      }}
                      className={`w-full rounded-md border px-2 py-1 ${
                        r._err?.includes("email")
                          ? "border-error bg-error/5"
                          : "border-border bg-surface"
                      }`}
                    >
                      <option value="">
                        {bfEmpLoading
                          ? "Loading employees…"
                          : "Select employee"}
                      </option>
                      {bfEmployees.map((emp) => (
                        <option key={emp.id} value={emp.email}>
                          {emp.name} ({emp.email})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <select
                      value={r.type}
                      onChange={(e) =>
                        update(i, {
                          type: e.target.value as BackfillRow["type"],
                        })
                      }
                      className="w-full rounded-md border border-border bg-surface px-2 py-1"
                    >
                      {allowedTypes.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="date"
                      value={r.startDate}
                      onChange={(e) => update(i, { startDate: e.target.value })}
                      className={`w-full rounded-md border px-2 py-1 ${
                        r._err?.includes("start")
                          ? "border-error bg-error/5"
                          : "border-border bg-surface"
                      }`}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="date"
                      value={r.endDate}
                      onChange={(e) => update(i, { endDate: e.target.value })}
                      className={`w-full rounded-md border px-2 py-1 ${
                        r._err?.includes("end")
                          ? "border-error bg-error/5"
                          : "border-border bg-surface"
                      }`}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <select
                      value={r.fallbackType || ""}
                      onChange={(e) => {
                        e.preventDefault();
                        update(i, {
                          fallbackType: (e.target.value ||
                            "") as BackfillRow["fallbackType"],
                        });
                      }}
                      className="w-full rounded-md border border-border bg-surface px-2 py-1"
                    >
                      <option value="">(none)</option>
                      {allowedTypes.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="text"
                      value={r.reason || ""}
                      placeholder="Optional"
                      onChange={(e) => update(i, { reason: e.target.value })}
                      className="w-full rounded-md border border-border bg-surface px-2 py-1"
                    />
                    {r._err && (
                      <div className="mt-1 text-xs text-error">{r._err}</div>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      className="text-xs rounded-md border border-border px-2 py-1 hover:bg-bg"
                      title="Remove row"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-2 py-6 text-center text-muted-foreground"
                  >
                    No rows. Click “Add Row” to begin or import a CSV.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            {rows.length} row(s) • {validCount} valid • {invalidCount} need
            fixes
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={addRow}
              className="rounded-md border border-border bg-bg px-3 py-2 text-sm hover:bg-muted"
            >
              Add Row
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={submit}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
            >
              {busy ? "Importing…" : "Import & Submit"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
