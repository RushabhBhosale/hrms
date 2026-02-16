import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

type BankHoliday = {
  _id?: string;
  date: string;
  name: string;
};

export default function HolidaysPage() {
  const [holidays, setHolidays] = useState<BankHoliday[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await api.get("/companies/bank-holidays");
        if (!alive) return;
        setHolidays(res.data.bankHolidays || []);
      } catch (e: any) {
        if (!alive) return;
        setError(
          e?.response?.data?.error || "Failed to load company bank holidays",
        );
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, BankHoliday[]>();
    holidays.forEach((h) => {
      const d = new Date(h.date);
      const year = Number.isNaN(d.getTime())
        ? "Unknown"
        : String(d.getFullYear());
      const list = map.get(year) || [];
      list.push(h);
      map.set(year, list);
    });
    for (const [year, list] of map.entries()) {
      list.sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
      );
      map.set(year, list);
    }
    return Array.from(map.entries()).sort(
      (a, b) => Number(b[0]) - Number(a[0]),
    );
  }, [holidays]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold">Bank Holidays</h2>
        <p className="text-sm text-muted-foreground">
          Annual company holidays visible to everyone.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-error/30 bg-error/10 px-4 py-2 text-sm text-error">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading holidays…</div>
      ) : grouped.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          No bank holidays have been set yet.
        </div>
      ) : (
        grouped.map(([year, list]) => (
          <section
            key={year}
            className="rounded-lg border border-border bg-surface shadow-sm"
          >
            <div className="border-b border-border px-4 py-3 flex items-center justify-between">
              <div className="text-sm font-semibold">
                {year === "Unknown" ? "Unspecified Year" : year}
              </div>
              <div className="text-xs text-muted-foreground">
                {list.length} holiday(s)
              </div>
            </div>
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/20 text-left">
                  <tr>
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 font-medium">Name</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((h) => {
                    const d = new Date(h.date);
                    const label = Number.isNaN(d.getTime())
                      ? h.date
                      : d.toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        });
                    return (
                      <tr key={h._id || `${h.date}-${h.name}`}>
                        <td className="px-4 py-2 whitespace-nowrap">{label}</td>
                        <td className="px-4 py-2">{h.name || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </div>
  );
}
