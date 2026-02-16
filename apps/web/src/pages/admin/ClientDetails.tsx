import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../lib/api";
import { resolveMediaUrl } from "../../lib/utils";
import { toast } from "react-hot-toast";
import { Button } from "../../components/ui/button";
import { Th, Td } from "../../components/utils/Table";

type Project = {
  _id: string;
  title: string;
  startTime?: string;
  estimatedTimeMinutes?: number;
  monthlyEstimateMinutes?: number;
  active?: boolean;
};

type Client = {
  _id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  website?: string;
  logo?: string;
  logoUrl?: string;
  pointOfContact?: string;
  pointEmail?: string;
  pointPhone?: string;
  bio?: string;
  notes?: string;
  createdAt?: string;
};

export default function ClientDetails() {
  const { id } = useParams();
  const nav = useNavigate();
  const [client, setClient] = useState<Client | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const resolveLogoUrl = (value?: string | null) => {
    if (!value) return null;
    return resolveMediaUrl(value);
  };

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        setLoading(true);
        const [clientsRes, projectsRes] = await Promise.all([
          api.get("/clients"),
          api.get("/projects", { params: { active: "true" } }),
        ]);
        const allClients: Client[] = clientsRes.data.clients || [];
        const found = allClients.find((c) => c._id === id);
        if (!found) {
          toast.error("Client not found");
          nav("/admin/clients", { replace: true });
          return;
        }
        setClient(found);
        const projs = (projectsRes.data.projects || []) as Project[];
        setProjects(projs.filter((p) => (p as any).client === id));
      } catch (e: any) {
        toast.error(e?.response?.data?.error || "Failed to load client");
      } finally {
        setLoading(false);
      }
    })();
  }, [id, nav]);

  const fmtDate = (s?: string) => {
    if (!s) return "-";
    const d = new Date(s);
    if (isNaN(d.getTime())) return "-";
    return d.toLocaleDateString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const minutesToHours = (min?: number) =>
    Math.round(((min || 0) / 60) * 10) / 10;

  const summary = useMemo(() => {
    const totalEst = projects.reduce(
      (s, p) => s + (p.estimatedTimeMinutes || 0),
      0,
    );
    const monthlyCap = projects.reduce(
      (s, p) => s + (p.monthlyEstimateMinutes || 0),
      0,
    );
    return { totalEst, monthlyCap };
  }, [projects]);

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading client…</div>;
  }
  if (!client) return null;
  const logoSrc = resolveLogoUrl(client.logo || client.logoUrl || null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm text-muted-foreground">
            <Link to="/admin/clients" className="hover:underline">
              Clients
            </Link>{" "}
            / Details
          </div>
          <h2 className="text-2xl font-semibold tracking-tight mt-1">
            {client.name}
          </h2>
          <div className="text-sm text-muted-foreground">
            Added {fmtDate(client.createdAt)}
          </div>
        </div>
        <Button asChild variant="outline" className="h-10">
          <Link to="/admin/clients">Back to Clients</Link>
        </Button>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="rounded-md border border-border bg-surface p-4 space-y-3">
          <div className="flex items-start gap-3">
            {logoSrc ? (
              <img
                src={logoSrc}
                alt={`${client.name} logo`}
                className="h-14 w-14 rounded border border-border object-contain bg-white"
              />
            ) : (
              <div className="h-14 w-14 rounded border border-border flex items-center justify-center text-xs text-muted-foreground bg-bg">
                No logo
              </div>
            )}
            <div>
              <div className="text-sm font-semibold">{client.name}</div>
              <div className="text-xs text-muted-foreground">
                {client.website ? (
                  <a
                    href={client.website}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    {client.website}
                  </a>
                ) : (
                  "No website provided"
                )}
              </div>
            </div>
          </div>
          <div className="text-sm">
            <span className="text-muted-foreground">Address: </span>
            {client.address || "—"}
          </div>
          <div className="text-sm space-y-1">
            <div className="text-muted-foreground">Bio</div>
            <div>{client.bio || "No bio added."}</div>
          </div>
          <div className="text-sm space-y-1">
            <div className="text-muted-foreground">Notes</div>
            <div>{client.notes || "No notes saved."}</div>
          </div>
        </div>
        <div className="rounded-md border border-border bg-surface p-4 space-y-2">
          <div className="text-sm font-semibold">Summary</div>
          <div className="text-sm">
            <span className="text-muted-foreground">Projects: </span>
            {projects.length}
          </div>
          <div className="text-sm">
            <span className="text-muted-foreground">Total Est. Hours: </span>
            {minutesToHours(summary.totalEst)}
          </div>
          <div className="text-sm">
            <span className="text-muted-foreground">Monthly Cap (sum): </span>
            {summary.monthlyCap
              ? `${minutesToHours(summary.monthlyCap)} h/mo`
              : "No caps"}
          </div>
        </div>
        <div className="rounded-md border border-border bg-surface p-4 space-y-2">
          <div className="text-sm font-semibold">Contacts</div>
          <div className="text-sm">
            <span className="text-muted-foreground">Email: </span>
            {client.email || "—"}
          </div>
          <div className="text-sm">
            <span className="text-muted-foreground">Phone: </span>
            {client.phone || "—"}
          </div>
          <div className="text-sm">
            <span className="text-muted-foreground">Point of Contact: </span>
            {client.pointOfContact || "—"}
          </div>
          <div className="text-sm">
            <span className="text-muted-foreground">POC Email: </span>
            {client.pointEmail || "—"}
          </div>
          <div className="text-sm">
            <span className="text-muted-foreground">POC Phone: </span>
            {client.pointPhone || "—"}
          </div>
        </div>
      </div>

      <div className="rounded-md border border-border bg-surface p-4">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="text-sm font-semibold">
            Linked Projects ({projects.length})
          </div>
          <Link
            to="/admin/projects/new"
            className="text-sm text-primary hover:underline"
          >
            Create Project
          </Link>
        </div>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <Th>Project</Th>
                <Th>Start</Th>
                <Th>Estimated (h)</Th>
                <Th>Monthly Cap</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p._id} className="border-t border-border/60">
                  <Td>
                    <Link
                      to={`/admin/projects/${p._id}`}
                      className="text-primary hover:underline"
                    >
                      {p.title}
                    </Link>
                  </Td>
                  <Td>{fmtDate(p.startTime)}</Td>
                  <Td>{minutesToHours(p.estimatedTimeMinutes)}</Td>
                  <Td>
                    {p.monthlyEstimateMinutes
                      ? `${minutesToHours(p.monthlyEstimateMinutes)} h/mo`
                      : "No cap"}
                  </Td>
                  <Td>
                    <span
                      className={`text-xs px-2 py-0.5 rounded border ${
                        p.active !== false
                          ? "border-secondary/30 text-secondary bg-secondary/10"
                          : "border-muted/40 text-muted-foreground"
                      }`}
                    >
                      {p.active !== false ? "Active" : "Inactive"}
                    </span>
                  </Td>
                </tr>
              ))}
              {projects.length === 0 && (
                <tr>
                  <td
                    className="px-3 py-3 text-sm text-muted-foreground"
                    colSpan={5}
                  >
                    No projects linked to this client.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
