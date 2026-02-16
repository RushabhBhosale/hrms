import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { Loader2, Plus } from "lucide-react";
import { toast } from "react-hot-toast";
import { Th, Td } from "../../components/utils/Table";
import { BackButton } from "../../components/utils/BackButton";

type ReimbursementType = {
  _id: string;
  name: string;
  description?: string;
  isActive?: boolean;
};

export default function AddReimbursementType() {
  const [form, setForm] = useState({ name: "", description: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [types, setTypes] = useState<ReimbursementType[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(true);
  const navigate = useNavigate();

  async function loadTypes() {
    try {
      setLoadingTypes(true);
      const res = await api.get("/reimbursements/types", {
        params: { includeInactive: true },
      });
      setTypes(res.data?.types || []);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Failed to load types");
    } finally {
      setLoadingTypes(false);
    }
  }

  useEffect(() => {
    loadTypes();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) {
      setError("Please enter a name");
      return;
    }
    try {
      setSaving(true);
      setError(null);
      await api.post("/reimbursements/types", form, {
        enableSuccessToast: true,
      });
      setForm({ name: "", description: "" });
      await loadTypes();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to add type");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-bold">Add reimbursement type</h2>
          <p className="text-sm text-muted-foreground">
            Create a category employees can select when submitting
            reimbursements.
          </p>
        </div>
        <BackButton to="/admin/reimbursements" />
      </div>

      {error && (
        <div className="rounded-md border border-error/20 bg-error/10 px-4 py-2 text-sm text-error">
          {error}
        </div>
      )}

      <form
        onSubmit={submit}
        className="space-y-4 rounded-lg border border-border bg-surface p-6 shadow-sm w-full"
      >
        <div className="space-y-1">
          <label className="text-sm font-medium required-label">Name</label>
          <input
            className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm"
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            placeholder="e.g. Travel, Meals"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">Description</label>
          <input
            className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm"
            value={form.description}
            onChange={(e) =>
              setForm((p) => ({ ...p, description: e.target.value }))
            }
            placeholder="Optional helper text"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
          >
            {saving ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Plus size={16} />
                Add type
              </>
            )}
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-4 py-2 text-sm"
            onClick={() => navigate("/admin/reimbursements")}
            disabled={saving}
          >
            Cancel
          </button>
        </div>
      </form>

      <section className="rounded-lg border border-border bg-surface shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h3 className="font-semibold">Existing types</h3>
            <p className="text-xs text-muted-foreground">
              Review current reimbursement categories.
            </p>
          </div>
          <span className="text-xs text-muted-foreground">
            {loadingTypes ? "Loading..." : `${types.length} total`}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border/70">
            <thead className="bg-bg">
              <tr>
                <Th>Name</Th>
                <Th>Description</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {loadingTypes ? (
                <tr>
                  <Td
                    colSpan={3}
                    className="text-center text-sm text-muted-foreground py-4"
                  >
                    <div className="inline-flex items-center gap-2">
                      <Loader2 size={16} className="animate-spin" />
                      Loading types...
                    </div>
                  </Td>
                </tr>
              ) : types.length === 0 ? (
                <tr>
                  <Td
                    colSpan={3}
                    className="text-center text-sm text-muted-foreground py-4"
                  >
                    No types created yet.
                  </Td>
                </tr>
              ) : (
                types.map((t) => (
                  <tr key={t._id} className="hover:bg-bg/60">
                    <Td className="font-medium">{t.name}</Td>
                    <Td className="text-sm text-muted-foreground">
                      {t.description || "-"}
                    </Td>
                    <Td>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-1 text-xs ${
                          t.isActive
                            ? "bg-secondary/10 text-secondary"
                            : "bg-border text-muted-foreground"
                        }`}
                      >
                        {t.isActive ? "Active" : "Disabled"}
                      </span>
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
