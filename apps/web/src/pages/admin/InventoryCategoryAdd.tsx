import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { Field } from "../../components/utils/Field";
import { Button } from "../../components/ui/button";

export default function InventoryCategoryAdd() {
  const [newCategory, setNewCategory] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function addCategory(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newCategory.trim();
    if (!trimmed) {
      setErr("Category name required");
      return;
    }
    try {
      setSaving(true);
      setErr(null);
      setOk(null);
      await api.post("/companies/inventory-categories", {
        name: trimmed,
      });
      setOk("Category added");
      setNewCategory("");
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to add category");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Add Inventory Category</h2>
          <p className="text-sm text-muted-foreground">
            Categories are required when adding inventory items.
          </p>
        </div>
        <Button asChild variant="outline" className="h-10">
          <Link to="/admin/inventory/categories">Back to Categories</Link>
        </Button>
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
          <h3 className="text-lg font-semibold">Category Details</h3>
        </div>
        <form onSubmit={addCategory} className="px-6 py-5 space-y-3">
          <Field label="Category Name" required>
            <input
              type="text"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
              placeholder="e.g., Laptop"
            />
          </Field>
          <Button type="submit" disabled={saving}>
            {saving ? "Adding…" : "Add Category"}
          </Button>
        </form>
      </section>
    </div>
  );
}
