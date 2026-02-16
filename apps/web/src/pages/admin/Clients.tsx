import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { toast } from "react-hot-toast";
import { Link } from "react-router-dom";

type Client = {
  _id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  projectsCount?: number;
  createdAt?: string;
};

export default function Clients() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  async function loadClients() {
    try {
      setLoading(true);
      const res = await api.get("/clients");
      setClients(res.data.clients || []);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Failed to load clients");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadClients();
  }, []);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.email || "").toLowerCase().includes(q) ||
        (c.phone || "").toLowerCase().includes(q),
    );
  }, [clients, filter]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Clients</h2>
          <p className="text-sm text-muted-foreground">
            View saved clients and their linked projects.
          </p>
        </div>
        <Link
          to="/admin/clients/new"
          className="h-10 px-4 py-2 rounded-md border border-border bg-primary text-white text-sm"
        >
          Add Client
        </Link>
      </div>

      <div className="rounded-md border border-border bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold">
            Client List ({filtered.length})
          </div>
          <input
            className="h-10 rounded border border-border bg-bg px-3 text-sm"
            placeholder="Search by name/email/phone"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground py-6">
            Loading clients…
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6">
            No clients found. Add one from the Add Client page.
          </div>
        ) : (
          <div className="overflow-auto mt-3">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Client</th>
                  <th className="py-2 pr-3 font-medium">Email</th>
                  <th className="py-2 pr-3 font-medium">Phone</th>
                  <th className="py-2 pr-3 font-medium">Projects</th>
                  <th className="py-2 pr-3 font-medium">Added</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c._id} className="border-t border-border/60">
                    <td className="py-2 pr-3 font-medium">
                      <Link
                        to={`/admin/clients/${c._id}`}
                        className="text-primary hover:underline"
                      >
                        {c.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {c.email || "—"}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {c.phone || "—"}
                    </td>
                    <td className="py-2 pr-3">
                      {Number(c.projectsCount || 0)}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {c.createdAt
                        ? new Date(c.createdAt).toLocaleDateString()
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
