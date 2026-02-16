import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { Field } from "../../components/utils/Field";
import { Button } from "../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";

type InventoryItemStatus = "AVAILABLE" | "ASSIGNED" | "REPAIR" | "RETIRED";

export default function InventoryAdd() {
  const [categories, setCategories] = useState<string[]>([]);
  const [employees, setEmployees] = useState<
    { id: string; name: string; email?: string }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    category: "",
    cost: "",
    status: "AVAILABLE" as InventoryItemStatus,
    assignedTo: "",
    purchaseDate: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        const [catRes, empRes] = await Promise.all([
          api.get("/companies/inventory-categories"),
          api
            .get("/companies/employees-lite")
            .catch(() => api.get("/companies/employees")),
        ]);
        setCategories(catRes.data.categories || []);
        const list =
          empRes?.data?.employees?.map((e: any) => ({
            id: e.id || e._id,
            name: e.name,
            email: e.email,
          })) || [];
        setEmployees(list);
        if (!form.category && catRes.data.categories?.length) {
          setForm((prev) => ({ ...prev, category: catRes.data.categories[0] }));
        }
      } catch (e: any) {
        setErr(e?.response?.data?.error || "Failed to load data");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function onFormChange<K extends keyof typeof form>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.category.trim()) {
      setErr("Select a category before adding an item.");
      return;
    }
    if (!form.name.trim()) {
      setErr("Item name is required.");
      return;
    }
    try {
      setSaving(true);
      setErr(null);
      const res = await api.post("/companies/inventory", {
        name: form.name.trim(),
        category: form.category.trim(),
        cost: form.cost ? Number(form.cost) : 0,
        status: form.status,
        assignedTo: form.assignedTo || undefined,
        purchaseDate: form.purchaseDate || undefined,
        notes: form.notes.trim(),
      });
      setForm({
        name: "",
        category: categories[0] || "",
        cost: "",
        status: "AVAILABLE",
        assignedTo: "",
        purchaseDate: "",
        notes: "",
      });
      setCategories(res.data.categories || categories);
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to add item");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Add Inventory Item</h2>
          <p className="text-sm text-muted-foreground">
            Create a new asset and optionally assign it to an employee.
          </p>
        </div>
        <Button asChild variant="outline" className="h-10">
          <Link to="/admin/inventory">Back to List</Link>
        </Button>
      </div>

      {err && (
        <div className="rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
          {err}
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-lg font-semibold">Item Details</h3>
        </div>
        <form
          onSubmit={submit}
          className="px-6 py-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3"
        >
          <Field label="Name" required>
            <input
              type="text"
              value={form.name}
              onChange={(e) => onFormChange("name", e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
              placeholder="e.g., MacBook Pro"
            />
          </Field>
          <Field label="Category" required>
            <Select
              value={form.category}
              onValueChange={(v) => onFormChange("category", v)}
              disabled={categories.length === 0}
            >
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={
                    categories.length
                      ? "Select a category"
                      : "No categories found"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {categories.length === 0 && (
              <p className="text-xs text-error">
                Add categories first (Assets → Categories).
              </p>
            )}
          </Field>
          <Field label="Cost">
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.cost}
              onChange={(e) => onFormChange("cost", e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
              placeholder="0"
            />
          </Field>
          <Field label="Status">
            <Select
              value={form.status}
              onValueChange={(v) =>
                onFormChange("status", v as InventoryItemStatus)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="AVAILABLE">Available</SelectItem>
                <SelectItem value="ASSIGNED">Assigned</SelectItem>
                <SelectItem value="REPAIR">In Repair</SelectItem>
                <SelectItem value="RETIRED">Retired</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Assign to">
            <Select
              value={form.assignedTo}
              onValueChange={(v) => onFormChange("assignedTo", v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Unassigned</SelectItem>
                {employees
                  .slice()
                  .sort((a, b) =>
                    a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
                  )
                  .map((emp) => (
                    <SelectItem key={emp.id} value={emp.id}>
                      {emp.name} {emp.email ? `(${emp.email})` : ""}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Purchase Date">
            <input
              type="date"
              value={form.purchaseDate}
              onChange={(e) => onFormChange("purchaseDate", e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
            />
          </Field>
          <div className="md:col-span-2 lg:col-span-3">
            <Field label="Notes">
              <textarea
                value={form.notes}
                onChange={(e) => onFormChange("notes", e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                rows={3}
                placeholder="Serial number, condition, etc."
              />
            </Field>
          </div>
          <div className="md:col-span-2 lg:col-span-3 flex items-center gap-3">
            <Button type="submit" disabled={saving || categories.length === 0}>
              {saving ? "Saving…" : "Add Item"}
            </Button>
            {loading && (
              <span className="text-xs text-muted-foreground">Loading…</span>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
