import { ChangeEvent, useEffect, useState } from "react";
import { api } from "../../lib/api";

type Company = {
  _id: string;
  name: string;
  admin?: { name: string; email: string };
  status?: "pending" | "approved" | "rejected";
  requestedAdmin?: { name?: string; email?: string };
  location?: {
    countryName?: string;
    stateName?: string;
    cityName?: string;
  };
  companyTypeName?: string | null;
};

export default function CompanyList() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const res = await api.get("/companies");
        setCompanies(res.data.companies || []);
      } catch (e: any) {
        setErr(e?.response?.data?.error || "Failed to load companies");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Company List</h2>

      {err && (
        <div className="rounded-md border border-error/20 bg-error/10 px-3 py-2 text-sm text-error">
          {err}
        </div>
      )}

      <div className="rounded-lg border border-border bg-surface shadow-sm overflow-hidden">
        <div className="grid grid-cols-12 text-xs font-medium uppercase text-muted-foreground border-b border-border px-4 py-2">
          <div className="col-span-5">Company</div>
          <div className="col-span-4">Admin</div>
          <div className="col-span-3 text-left sm:text-right">Status</div>
        </div>

        {loading ? (
          <div className="px-4 py-4 text-sm text-muted-foreground">
            Loading…
          </div>
        ) : companies.length === 0 ? (
          <div className="px-4 py-4 text-sm text-muted-foreground">
            No companies
          </div>
        ) : (
          companies.map((c) => (
            <Row key={c._id} company={c} onChange={setCompanies} />
          ))
        )}
      </div>
    </div>
  );
}

function Row({
  company,
  onChange,
}: {
  company: Company;
  onChange: (v: Company[]) => void;
}) {
  const normalizedStatus =
    company.status && company.status !== "pending" ? company.status : "";
  const [statusValue, setStatusValue] = useState(normalizedStatus);
  const [working, setWorking] = useState(false);
  const [rowErr, setRowErr] = useState<string | null>(null);

  useEffect(() => {
    const next =
      company.status && company.status !== "pending" ? company.status : "";
    setStatusValue(next);
  }, [company.status]);

  async function reload() {
    const res = await api.get("/companies");
    onChange(res.data.companies || []);
  }

  async function updateStatus(nextStatus: "approved" | "rejected") {
    setWorking(true);
    setRowErr(null);
    try {
      await api.patch(`/companies/${company._id}/status`, {
        status: nextStatus,
      });
      await reload();
    } catch (e: any) {
      setRowErr(e?.response?.data?.error || `Failed to mark as ${nextStatus}`);
      throw e;
    } finally {
      setWorking(false);
    }
  }

  async function onStatusChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextStatus = event.target.value as "approved" | "rejected";
    const previous = statusValue;
    setStatusValue(nextStatus);
    try {
      await updateStatus(nextStatus);
    } catch {
      setStatusValue(previous);
    }
  }

  const isPending = company.status === "pending";
  const locationParts = [
    company.location?.cityName,
    company.location?.stateName,
    company.location?.countryName,
  ].filter(Boolean);
  const locationLabel = locationParts.join(", ");

  return (
    <div className="grid grid-cols-12 items-start gap-4 px-4 py-3 border-b border-border text-sm last:border-b-0">
      <div className="col-span-12 sm:col-span-5 space-y-1">
        <div className="font-medium text-base">{company.name}</div>
        {company.companyTypeName && (
          <div className="text-xs text-muted-foreground">
            Type: {company.companyTypeName}
          </div>
        )}
        {locationLabel && (
          <div className="text-xs text-muted-foreground">
            Located in {locationLabel}
          </div>
        )}
        {isPending && company.requestedAdmin?.email && (
          <div className="text-xs text-muted-foreground">
            Requested by {company.requestedAdmin.name || "Admin"} (
            {company.requestedAdmin.email})
          </div>
        )}
      </div>
      <div className="col-span-12 sm:col-span-4 space-y-1">
        {company.admin ? (
          <>
            <div className="font-medium">{company.admin.name}</div>
            <div className="text-xs text-muted-foreground">
              {company.admin.email}
            </div>
          </>
        ) : company.requestedAdmin?.email ? (
          <div className="text-xs text-muted-foreground">
            Pending admin account ({company.requestedAdmin.email})
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            No admin assigned
          </span>
        )}
      </div>
      <div className="col-span-12 sm:col-span-3 flex flex-col items-start sm:items-end gap-2">
        <select
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 sm:w-auto"
          value={statusValue}
          onChange={onStatusChange}
          disabled={working}
        >
          <option value="" disabled={!!statusValue || working}>
            {working
              ? "Updating..."
              : statusValue
                ? "Status set"
                : "Select status"}
          </option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        {rowErr && (
          <span
            className="text-xs text-error max-w-[200px] text-left sm:text-right"
            title={rowErr}
          >
            {rowErr}
          </span>
        )}
      </div>
    </div>
  );
}
