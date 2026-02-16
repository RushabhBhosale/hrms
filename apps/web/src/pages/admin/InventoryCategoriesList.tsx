import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { Button } from "../../components/ui/button";

export default function InventoryCategoriesList() {
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    loadCategories();
  }, []);

  async function loadCategories() {
    try {
      setLoading(true);
      setErr(null);
      const res = await api.get("/companies/inventory-categories");
      setCategories(res.data.categories || []);
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to load categories");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Inventory Categories</h2>
          <p className="text-sm text-muted-foreground">
            Manage the categories available when adding inventory items.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild className="h-10">
            <Link to="/admin/inventory/categories/add">Add Category</Link>
          </Button>
          <Button asChild variant="outline" className="h-10">
            <Link to="/admin/inventory">Back to Inventory</Link>
          </Button>
        </div>
      </div>

      {err && (
        <div className="rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
          {err}
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-6 py-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Categories</h3>
          {loading && (
            <div className="text-sm text-muted-foreground">Loading…</div>
          )}
        </div>
        <div className="px-6 py-5">
          {categories.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              {loading ? "Loading…" : "No categories added yet."}
            </div>
          ) : (
            <ul className="space-y-2 text-sm">
              {categories.map((c) => (
                <li
                  key={c}
                  className="rounded-md border border-border/60 bg-muted/10 px-3 py-2"
                >
                  {c}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
