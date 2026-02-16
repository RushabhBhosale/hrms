import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { Field } from "../../components/utils/Field";
import { toast } from "react-hot-toast";
import { Button } from "../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";

type InventoryItem = {
  _id?: string;
  id?: string;
  name: string;
  category?: string;
  cost?: number;
  status?: "AVAILABLE" | "ASSIGNED" | "REPAIR" | "RETIRED";
  assignedTo?: { _id?: string; id?: string; name: string; email?: string };
  purchaseDate?: string;
  notes?: string;
};

type EmployeeLite = { id: string; name: string; email?: string };

const STATUS_OPTIONS: { value: InventoryItem["status"]; label: string }[] = [
  { value: "AVAILABLE", label: "Available" },
  { value: "ASSIGNED", label: "Assigned" },
  { value: "REPAIR", label: "In Repair" },
  { value: "RETIRED", label: "Retired" },
];

const currency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export default function InventoryList() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<Record<string, boolean>>({});
  const [updatingStatus, setUpdatingStatus] = useState<Record<string, boolean>>(
    {},
  );
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      setErr(null);
      const [itemsRes, empRes] = await Promise.all([
        api.get("/companies/inventory"),
        api
          .get("/companies/employees-lite")
          .catch(() => api.get("/companies/employees")),
      ]);
      setItems(itemsRes.data.items || []);
      const list =
        empRes?.data?.employees?.map((e: any) => ({
          id: e.id || e._id,
          name: e.name,
          email: e.email,
        })) || [];
      setEmployees(list);
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to load inventory");
    } finally {
      setLoading(false);
    }
  }

  async function changeAssignment(itemId: string, employeeId: string) {
    if (!itemId) return;
    setAssigning((prev) => ({ ...prev, [itemId]: true }));
    setErr(null);
    try {
      const res = await api.put(`/companies/inventory/${itemId}/assign`, {
        employeeId: employeeId || null,
      });
      setItems(res.data.items || []);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Failed to update assignment");
    } finally {
      setAssigning((prev) => {
        const copy = { ...prev };
        delete copy[itemId];
        return copy;
      });
    }
  }

  async function changeStatus(itemId: string, status: InventoryItem["status"]) {
    if (!itemId) return;
    setUpdatingStatus((prev) => ({ ...prev, [itemId]: true }));
    setErr(null);
    try {
      const res = await api.put(`/companies/inventory/${itemId}`, { status });
      setItems(res.data.items || []);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Failed to update status");
    } finally {
      setUpdatingStatus((prev) => {
        const copy = { ...prev };
        delete copy[itemId];
        return copy;
      });
    }
  }

  async function deleteItem(itemId: string) {
    if (!itemId) return;
    if (!window.confirm("Delete this inventory item?")) return;
    setDeleting((prev) => ({ ...prev, [itemId]: true }));
    setErr(null);
    try {
      const res = await api.delete(`/companies/inventory/${itemId}`);
      setItems(res.data.items || []);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Failed to delete item");
    } finally {
      setDeleting((prev) => {
        const copy = { ...prev };
        delete copy[itemId];
        return copy;
      });
    }
  }

  const categorySummary = useMemo(() => {
    const map = new Map<
      string,
      { count: number; value: number; assigned: number }
    >();
    items.forEach((item) => {
      const key = item.category?.trim() || "Uncategorized";
      const existing = map.get(key) || { count: 0, value: 0, assigned: 0 };
      existing.count += 1;
      existing.value += Number(item.cost || 0);
      if (item.assignedTo) existing.assigned += 1;
      map.set(key, existing);
    });
    return Array.from(map.entries()).sort((a, b) =>
      a[0].localeCompare(b[0], "en", { sensitivity: "base" }),
    );
  }, [items]);

  const totalValue = useMemo(
    () => items.reduce((sum, i) => sum + Number(i.cost || 0), 0),
    [items],
  );

  const employeeOptions = useMemo(
    () =>
      [...employees].sort((a, b) =>
        a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
      ),
    [employees],
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Inventory</h2>
          <p className="text-sm text-muted-foreground">
            Track company assets and assign them to employees.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild>
            <Link to="/admin/inventory/add">Add Item</Link>
          </Button>
          <Button asChild variant="outline" className="h-10">
            <Link to="/admin/inventory/categories">Categories</Link>
          </Button>
        </div>
      </div>

      {err && (
        <div className="rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
          {err}
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-6 py-4 flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Inventory Summary</h3>
          {totalValue ? (
            <div className="text-sm text-muted-foreground">
              Total asset value:{" "}
              <span className="font-semibold text-foreground">
                {currency.format(totalValue || 0)}
              </span>
            </div>
          ) : null}
        </div>
        <div className="px-6 py-5 space-y-4">
          {categorySummary.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-3">
              {categorySummary.map(([cat, data]) => (
                <div
                  key={cat}
                  className="rounded-md border border-border/60 bg-muted/10 p-3 text-sm"
                >
                  <div className="font-semibold">{cat}</div>
                  <div className="text-muted-foreground">
                    {data.count} item{data.count === 1 ? "" : "s"} •{" "}
                    {data.assigned} assigned
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Value: {currency.format(data.value)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              {loading ? "Loading…" : "No inventory items added yet."}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Inventory List</h3>
          {loading && (
            <div className="text-sm text-muted-foreground">Loading…</div>
          )}
        </div>
        <div className="px-6 py-5 space-y-4">
          {items.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              {loading ? "Loading…" : "No inventory items added yet."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="py-2 pr-4 font-medium w-32">Item</th>
                    <th className="py-2 pr-4 font-medium w-32">Status</th>
                    <th className="py-2 pr-6 font-medium w-32 line-clamp-1">
                      Assigned To
                    </th>
                    <th className="py-2 pr-2 font-medium w-24">Cost</th>
                    <th className="py-2 pr-2 font-medium w-28">
                      Purchase Date
                    </th>
                    <th className="py-2 pr-0 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const id = item._id || item.id || "";
                    const isAssigning = id ? assigning[id] : false;
                    const isUpdating = id ? updatingStatus[id] : false;
                    const isRemoving = id ? deleting[id] : false;
                    return (
                      <tr
                        key={id || item.name}
                        className="border-b border-border/60"
                      >
                        <td className="py-3 pr-4 align-top">
                          <div className="font-medium">{item.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {item.category || "Uncategorized"}
                          </div>
                          {item.notes ? (
                            <div className="text-xs text-muted-foreground mt-1">
                              {item.notes}
                            </div>
                          ) : null}
                        </td>
                        <td className="py-3 pr-4 align-top">
                          <Select
                            value={item.status || "AVAILABLE"}
                            disabled={isUpdating || !id}
                            onValueChange={(v) => {
                              if (!id) return;
                              changeStatus(id, v as InventoryItem["status"]);
                            }}
                          >
                            <SelectTrigger className="h-9 min-w-[140px] text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {STATUS_OPTIONS.map((opt) => (
                                <SelectItem
                                  key={opt.value}
                                  value={opt.value || ""}
                                >
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="py-3 pr-4 align-top">
                          <Select
                            value={
                              item.assignedTo?._id || item.assignedTo?.id || ""
                            }
                            disabled={isAssigning || !id}
                            onValueChange={(v) => id && changeAssignment(id, v)}
                          >
                            <SelectTrigger className="h-9 min-w-[160px] text-xs">
                              <SelectValue placeholder="Unassigned" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="">Unassigned</SelectItem>
                              {employeeOptions.map((emp) => (
                                <SelectItem key={emp.id} value={emp.id}>
                                  {emp.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="py-3 pr-4 align-top">
                          {currency.format(Number(item.cost || 0))}
                        </td>
                        <td className="py-3 pr-4 align-top">
                          {item.purchaseDate
                            ? new Date(item.purchaseDate).toLocaleDateString()
                            : "—"}
                        </td>
                        <td className="py-3 pr-0 align-top text-right">
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            disabled={isRemoving || !id}
                            onClick={() => id && deleteItem(id)}
                          >
                            {isRemoving ? "Deleting…" : "Delete"}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
