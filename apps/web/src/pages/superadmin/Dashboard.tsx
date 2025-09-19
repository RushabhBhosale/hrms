import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { CalendarClock, UploadCloud } from "lucide-react";

import { api } from "../../lib/api";

type MasterSummaryEntry = {
  count: number;
  lastUpdatedAt: string | null;
};

type MasterSummary = {
  countries: MasterSummaryEntry;
  states: MasterSummaryEntry;
  cities: MasterSummaryEntry;
  companyTypes: MasterSummaryEntry;
};

type MasterImportStats = {
  inserted: number;
  updated: number;
  skipped: number;
};

type MasterImportResult = {
  countries: MasterImportStats;
  states: MasterImportStats;
  cities: MasterImportStats;
  companyTypes: MasterImportStats;
};

type MasterWarning = {
  sheet: string;
  rowNumber?: number;
  message: string;
};

const MASTER_LABELS: Record<keyof MasterSummary, string> = {
  countries: "Countries",
  states: "States",
  cities: "Cities",
  companyTypes: "Company Types",
};

function formatDateLabel(value?: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function SuperadminDashboard() {
  const masterFileInputRef = useRef<HTMLInputElement | null>(null);

  const [companyCount, setCompanyCount] = useState(0);
  const [companyLoading, setCompanyLoading] = useState(false);
  const [companyError, setCompanyError] = useState<string | null>(null);

  const [masterSummary, setMasterSummary] = useState<MasterSummary | null>(
    null
  );
  const [masterLoading, setMasterLoading] = useState(false);
  const [masterError, setMasterError] = useState<string | null>(null);
  const [masterFile, setMasterFile] = useState<File | null>(null);
  const [masterUploading, setMasterUploading] = useState(false);
  const [masterUploadError, setMasterUploadError] = useState<string | null>(
    null
  );
  const [masterUploadResult, setMasterUploadResult] =
    useState<MasterImportResult | null>(null);
  const [masterWarnings, setMasterWarnings] = useState<MasterWarning[]>([]);

  useEffect(() => {
    refreshCompanyCount();
    refreshMasterSummary();
  }, []);

  async function refreshCompanyCount() {
    try {
      setCompanyError(null);
      setCompanyLoading(true);
      const res = await api.get("/companies");
      setCompanyCount(res.data.companies?.length || 0);
    } catch (err: any) {
      console.error(err);
      setCompanyError(
        err?.response?.data?.error || "Failed to load company count"
      );
    } finally {
      setCompanyLoading(false);
    }
  }

  async function refreshMasterSummary() {
    try {
      setMasterError(null);
      setMasterLoading(true);
      const res = await api.get("/masters/summary");
      setMasterSummary(res.data.summary || null);
    } catch (err: any) {
      console.error(err);
      setMasterSummary(null);
      setMasterError(
        err?.response?.data?.error || "Failed to load master summary"
      );
    } finally {
      setMasterLoading(false);
    }
  }

  function onMasterFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    setMasterFile(file);
    setMasterUploadError(null);
  }

  async function handleMasterUpload() {
    if (!masterFile) {
      setMasterUploadError("Please select the Excel file to upload.");
      return;
    }

    try {
      setMasterUploading(true);
      setMasterUploadError(null);
      setMasterWarnings([]);
      const formData = new FormData();
      formData.append("file", masterFile);
      const res = await api.post("/masters/import", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setMasterSummary(res.data.summary || null);
      setMasterUploadResult(res.data.result || null);
      setMasterWarnings(res.data.warnings || []);
      setMasterFile(null);
      if (masterFileInputRef.current) {
        masterFileInputRef.current.value = "";
      }
    } catch (error: any) {
      console.error(error);
      setMasterUploadResult(null);
      const message =
        error?.response?.data?.error || "Failed to upload master data.";
      setMasterUploadError(message);
      const details = error?.response?.data?.details;
      if (Array.isArray(details)) {
        setMasterWarnings(
          details.map((msg: string) => ({
            sheet: "format",
            message: msg,
          }))
        );
      }
    } finally {
      setMasterUploading(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="space-y-4 rounded-lg border border-border bg-surface p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Superadmin Overview</h2>
            <p className="text-sm text-muted">
              High-level snapshot of companies in the system.
            </p>
          </div>
          <button
            onClick={refreshCompanyCount}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-bg disabled:opacity-60"
            disabled={companyLoading}
          >
            <CalendarClock size={16} />
            {companyLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        {companyError && (
          <div className="rounded-md border border-error/20 bg-error/10 px-3 py-2 text-sm text-error">
            {companyError}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg border border-border bg-muted/10 px-4 py-3">
            <div className="text-xs uppercase text-muted">Total Companies</div>
            <div className="mt-2 text-3xl font-semibold">
              {companyLoading ? "..." : companyCount}
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-6 rounded-lg border border-border bg-surface p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Master Data</h3>
            <p className="text-sm text-muted">
              Upload an Excel workbook to manage countries, states, cities, and
              company types.
            </p>
          </div>
          <button
            onClick={refreshMasterSummary}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-bg disabled:opacity-60"
            disabled={masterLoading}
          >
            <CalendarClock size={16} />
            {masterLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {masterError && (
          <div className="rounded-md border border-error/20 bg-error/10 px-3 py-2 text-sm text-error">
            {masterError}
          </div>
        )}

        {masterLoading && !masterSummary ? (
          <div className="flex h-20 items-center justify-center text-sm text-muted">
            Loading master summary...
          </div>
        ) : masterSummary ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Object.entries(MASTER_LABELS).map(([key, label]) => {
              const entry = masterSummary[key as keyof MasterSummary];
              const count = entry?.count ?? 0;
              const last = entry?.lastUpdatedAt;
              return (
                <div
                  key={key}
                  className="rounded-lg border border-border bg-surface px-4 py-3"
                >
                  <div className="text-xs uppercase text-muted">{label}</div>
                  <div className="mt-2 text-2xl font-semibold">{count}</div>
                  <div className="text-xs text-muted">
                    {last
                      ? `Updated ${formatDateLabel(last)}`
                      : "Not uploaded yet"}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex h-20 items-center justify-center text-sm text-muted">
            No master data available yet.
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <div className="space-y-3 rounded-lg border border-dashed border-border p-4">
            <h4 className="text-sm font-semibold">Workbook format</h4>
            <p className="text-xs text-muted">
              Prepare a single .xlsx file with the sheets below. Column names
              are case-insensitive.
            </p>
            <ul className="space-y-2 text-xs text-muted">
              <li>
                <span className="font-semibold text-foreground">Countries</span>
                : required <code>Name</code>; optional <code>ISO Code</code>,
                <code>Phone Code</code>.
              </li>
              <li>
                <span className="font-semibold text-foreground">States</span>:
                required <code>Name</code>, <code>Country</code>; optional
                <code>ISO Code</code>.
              </li>
              <li>
                <span className="font-semibold text-foreground">Cities</span>:
                required <code>Name</code>, <code>State</code>,
                <code>Country</code>.
              </li>
              <li>
                <span className="font-semibold text-foreground">CompanyTypes</span>
                : required <code>Name</code>; optional <code>Description</code>.
              </li>
              <li>
                Keep sheet names exactly as listed (Countries, States, Cities,
                CompanyTypes) for accurate parsing.
              </li>
            </ul>
          </div>

          <div className="space-y-3 rounded-lg border border-border p-4">
            <label className="flex flex-col gap-2 text-sm">
              <span className="font-medium">Upload Excel</span>
              <input
                ref={masterFileInputRef}
                type="file"
                accept=".xlsx"
                onChange={onMasterFileChange}
                className="rounded border border-border bg-surface px-3 py-2"
              />
              {masterFile && (
                <div className="text-xs text-muted">
                  Selected: <span className="font-medium">{masterFile.name}</span>
                </div>
              )}
            </label>
            {masterUploadError && (
              <div className="rounded-md border border-error/20 bg-error/10 px-3 py-2 text-xs text-error">
                {masterUploadError}
              </div>
            )}
            <button
              onClick={handleMasterUpload}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              disabled={masterUploading}
            >
              <UploadCloud size={16} />
              {masterUploading ? "Uploading..." : "Upload & Sync"}
            </button>
            {masterUploadResult && (
              <div className="rounded-md border border-border/60 bg-muted/10 px-3 py-2 text-xs">
                <div className="font-semibold">Last import</div>
                <div className="mt-1 space-y-1">
                  {Object.entries(MASTER_LABELS).map(([key, label]) => {
                    const stats =
                      masterUploadResult[key as keyof MasterImportResult];
                    return (
                      <div
                        key={`import-${key}`}
                        className="flex items-center justify-between gap-3"
                      >
                        <span>{label}</span>
                        <span className="text-muted">
                          {`${stats.inserted} new · ${stats.updated} updated · ${stats.skipped} skipped`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {masterWarnings.length > 0 && (
              <div className="rounded-md border border-warning/20 bg-warning/10 px-3 py-2 text-xs text-warning">
                <div className="mb-1 font-semibold">Warnings</div>
                <ul className="space-y-1">
                  {masterWarnings.slice(0, 6).map((warning, idx) => {
                    const label =
                      MASTER_LABELS[
                        warning.sheet as keyof MasterSummary
                      ] || warning.sheet;
                    return (
                      <li key={`${warning.sheet}-${idx}`}>
                        <span className="font-medium">{label}</span>
                        {warning.rowNumber ? ` (row ${warning.rowNumber})` : ""}
                        : {warning.message}
                      </li>
                    );
                  })}
                  {masterWarnings.length > 6 && (
                    <li>...and {masterWarnings.length - 6} more</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
