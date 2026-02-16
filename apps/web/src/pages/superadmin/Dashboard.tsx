import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { CalendarClock, UploadCloud, Download } from "lucide-react";

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

type CountryOption = {
  id: string;
  name: string;
  nameKey: string;
  isoCode: string | null;
  phoneCode: string | null;
};

type StateOption = {
  id: string;
  name: string;
  nameKey: string;
  stateKey: string;
  isoCode: string | null;
  countryId: string;
  countryName: string;
  countryKey: string;
};

type CityOption = {
  id: string;
  name: string;
  nameKey: string;
  cityKey: string;
  stateId: string;
  stateName: string;
  stateKey: string;
  countryId: string;
  countryName: string;
  countryKey: string;
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
    null,
  );
  const [masterLoading, setMasterLoading] = useState(false);
  const [masterError, setMasterError] = useState<string | null>(null);
  const [masterFile, setMasterFile] = useState<File | null>(null);
  const [masterUploading, setMasterUploading] = useState(false);
  const [masterUploadError, setMasterUploadError] = useState<string | null>(
    null,
  );
  const [masterUploadResult, setMasterUploadResult] =
    useState<MasterImportResult | null>(null);
  const [masterWarnings, setMasterWarnings] = useState<MasterWarning[]>([]);
  const [countries, setCountries] = useState<CountryOption[]>([]);
  const [states, setStates] = useState<StateOption[]>([]);
  const [cities, setCities] = useState<CityOption[]>([]);
  const [countriesLoading, setCountriesLoading] = useState(false);
  const [statesLoading, setStatesLoading] = useState(false);
  const [citiesLoading, setCitiesLoading] = useState(false);
  const [hierarchyError, setHierarchyError] = useState<string | null>(null);
  const [selectedCountryId, setSelectedCountryId] = useState<string>("");
  const [selectedStateId, setSelectedStateId] = useState<string>("");
  const [selectedCityId, setSelectedCityId] = useState<string>("");
  const [downloadingSample, setDownloadingSample] = useState(false);
  const [sampleDownloadError, setSampleDownloadError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    refreshCompanyCount();
    refreshMasterSummary();
    loadCountries();
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
        err?.response?.data?.error || "Failed to load company count",
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
        err?.response?.data?.error || "Failed to load master summary",
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
      void loadCountries();
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
          })),
        );
      }
    } finally {
      setMasterUploading(false);
    }
  }

  async function loadCountries() {
    try {
      setHierarchyError(null);
      setCountriesLoading(true);
      const res = await api.get("/masters/countries");
      const list = Array.isArray(res.data?.countries)
        ? (res.data.countries as CountryOption[])
        : [];
      setCountries(list);
      if (!list.length) {
        setStates([]);
        setCities([]);
        setSelectedCountryId("");
        setSelectedStateId("");
        setSelectedCityId("");
      } else {
        setSelectedCountryId((prev) => {
          if (prev && list.some((country) => country.id === prev)) {
            return prev;
          }
          return list[0].id;
        });
      }
    } catch (err: any) {
      console.error(err);
      setHierarchyError(
        err?.response?.data?.error || "Failed to load countries.",
      );
      setCountries([]);
      setSelectedCountryId("");
      setStates([]);
      setSelectedStateId("");
      setCities([]);
      setSelectedCityId("");
    } finally {
      setCountriesLoading(false);
    }
  }

  async function loadStates(countryId: string) {
    if (!countryId) {
      setStates([]);
      setSelectedStateId("");
      setCities([]);
      setSelectedCityId("");
      return;
    }

    try {
      setHierarchyError(null);
      setStatesLoading(true);
      const res = await api.get("/masters/states", {
        params: { countryId },
      });
      const list = Array.isArray(res.data?.states)
        ? (res.data.states as StateOption[])
        : [];
      setStates(list);
      if (!list.length) {
        setSelectedStateId("");
        setCities([]);
        setSelectedCityId("");
      } else {
        setSelectedStateId((prev) => {
          if (prev && list.some((state) => state.id === prev)) {
            return prev;
          }
          return list[0].id;
        });
      }
    } catch (err: any) {
      console.error(err);
      setHierarchyError(
        err?.response?.data?.error ||
          "Failed to load states for the selected country.",
      );
      setStates([]);
      setSelectedStateId("");
      setCities([]);
      setSelectedCityId("");
    } finally {
      setStatesLoading(false);
    }
  }

  async function loadCities(stateId: string) {
    if (!stateId) {
      setCities([]);
      setSelectedCityId("");
      return;
    }

    try {
      setHierarchyError(null);
      setCitiesLoading(true);
      const res = await api.get("/masters/cities", {
        params: { stateId },
      });
      const list = Array.isArray(res.data?.cities)
        ? (res.data.cities as CityOption[])
        : [];
      setCities(list);
      if (!list.length) {
        setSelectedCityId("");
      } else {
        setSelectedCityId((prev) => {
          if (prev && list.some((city) => city.id === prev)) {
            return prev;
          }
          return list[0].id;
        });
      }
    } catch (err: any) {
      console.error(err);
      setHierarchyError(
        err?.response?.data?.error || "Failed to load cities for the state.",
      );
      setCities([]);
      setSelectedCityId("");
    } finally {
      setCitiesLoading(false);
    }
  }

  async function downloadSampleWorkbook() {
    try {
      setSampleDownloadError(null);
      setDownloadingSample(true);
      const res = await api.get("/masters/import/sample", {
        responseType: "blob",
      });
      const disposition = res.headers["content-disposition"] as
        | string
        | undefined;
      let filename = "master-data-sample.xlsx";
      if (disposition) {
        const utfMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
        const simpleMatch = disposition.match(/filename="?([^";]+)"?/i);
        if (utfMatch?.[1]) {
          filename = decodeURIComponent(utfMatch[1]);
        } else if (simpleMatch?.[1]) {
          filename = simpleMatch[1];
        }
      }
      const blob = new Blob([res.data], {
        type:
          res.headers["content-type"] ||
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error(err);
      setSampleDownloadError(
        err?.response?.data?.error || "Failed to download the sample workbook.",
      );
    } finally {
      setDownloadingSample(false);
    }
  }

  useEffect(() => {
    if (!selectedCountryId) {
      setStates([]);
      setSelectedStateId("");
      setCities([]);
      setSelectedCityId("");
      return;
    }
    loadStates(selectedCountryId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCountryId]);

  useEffect(() => {
    if (!selectedStateId) {
      setCities([]);
      setSelectedCityId("");
      return;
    }
    loadCities(selectedStateId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStateId]);

  const selectedCountry =
    countries.find((country) => country.id === selectedCountryId) || null;
  const selectedState =
    states.find((state) => state.id === selectedStateId) || null;
  const selectedCity =
    cities.find((city) => city.id === selectedCityId) || null;
  const statesDisabled =
    !selectedCountryId || statesLoading || states.length === 0;
  const citiesDisabled =
    !selectedStateId || citiesLoading || cities.length === 0;
  let hierarchyStatus = "";
  if (countriesLoading) {
    hierarchyStatus = "Loading countries...";
  } else if (statesLoading) {
    hierarchyStatus = "Loading states...";
  } else if (citiesLoading) {
    hierarchyStatus = "Loading cities...";
  } else if (selectedCity && selectedState && selectedCountry) {
    hierarchyStatus = `Showing ${cities.length} city${
      cities.length === 1 ? "" : "ies"
    } in ${selectedState.name}, ${selectedCountry.name}.`;
  } else if (selectedState && selectedCountry) {
    hierarchyStatus = `${cities.length} city${
      cities.length === 1 ? "" : "ies"
    } available for ${selectedState.name}.`;
  } else if (selectedCountry) {
    hierarchyStatus = `${states.length} state${
      states.length === 1 ? "" : "s"
    } available for ${selectedCountry.name}.`;
  } else if (countries.length === 0) {
    hierarchyStatus =
      "Upload the masters to start linking countries, states, and cities.";
  } else {
    hierarchyStatus = "Select a country to load its linked states.";
  }

  return (
    <div className="space-y-8">
      <section className="space-y-4 rounded-lg border border-border bg-surface p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Superadmin Overview</h2>
            <p className="text-sm text-muted-foreground">
              High-level snapshot of companies in the system.
            </p>
          </div>
        </div>
        {companyError && (
          <div className="rounded-md border border-error/20 bg-error/10 px-3 py-2 text-sm text-error">
            {companyError}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg border border-border bg-muted/10 px-4 py-3">
            <div className="text-xs uppercase text-muted-foreground">
              Total Companies
            </div>
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
            <p className="text-sm text-muted-foreground">
              Upload an Excel workbook to manage countries, states, cities, and
              company types.
            </p>
          </div>
        </div>

        {masterError && (
          <div className="rounded-md border border-error/20 bg-error/10 px-3 py-2 text-sm text-error">
            {masterError}
          </div>
        )}

        {masterLoading && !masterSummary ? (
          <div className="flex h-20 items-center justify-center text-sm text-muted-foreground">
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
                  <div className="text-xs uppercase text-muted-foreground">
                    {label}
                  </div>
                  <div className="mt-2 text-2xl font-semibold">{count}</div>
                  <div className="text-xs text-muted-foreground">
                    {last
                      ? `Updated ${formatDateLabel(last)}`
                      : "Not uploaded yet"}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex h-20 items-center justify-center text-sm text-muted-foreground">
            No master data available yet.
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <div className="space-y-3 rounded-lg border border-dashed border-border p-4">
            <h4 className="text-sm font-semibold">Workbook format</h4>
            <p className="text-xs text-muted-foreground">
              Prepare a single .xlsx file with the sheets below. Column names
              are case-insensitive.
            </p>
            <ul className="space-y-2 text-xs text-muted-foreground">
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
                <span className="font-semibold text-foreground">
                  CompanyTypes
                </span>
                : required <code>Name</code>; optional <code>Description</code>.
              </li>
              <li>
                Keep sheet names exactly as listed (Countries, States, Cities,
                CompanyTypes) for accurate parsing.
              </li>
            </ul>
            <div className="flex flex-wrap items-center gap-2 pt-3">
              <button
                onClick={downloadSampleWorkbook}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium hover:bg-bg disabled:opacity-60"
                disabled={downloadingSample}
              >
                <Download size={16} />
                {downloadingSample
                  ? "Preparing sample..."
                  : "Download sample workbook"}
              </button>
              <span className="text-[11px] text-muted-foreground">
                Includes linked country, state, and city examples.
              </span>
            </div>
            {sampleDownloadError && (
              <div className="rounded-md border border-error/20 bg-error/10 px-3 py-2 text-xs text-error">
                {sampleDownloadError}
              </div>
            )}
            <div className="mt-5 space-y-3 rounded-lg border border-border/60 bg-muted/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h5 className="text-sm font-semibold">Hierarchy preview</h5>
                <span className="text-[11px] text-muted-foreground">
                  Data pulls from the stored masters.
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Select a country to load its states, then pick a state to see
                the available cities.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="flex flex-col gap-1 text-xs font-medium">
                  <span>Country</span>
                  <select
                    className="rounded border border-border bg-surface px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    value={selectedCountryId}
                    onChange={(event) =>
                      setSelectedCountryId(event.target.value)
                    }
                    disabled={countriesLoading || countries.length === 0}
                  >
                    <option value="">
                      {countriesLoading
                        ? "Loading..."
                        : countries.length === 0
                          ? "No countries"
                          : "Select country"}
                    </option>
                    {countries.map((country) => (
                      <option key={country.id} value={country.id}>
                        {country.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium">
                  <span>State</span>
                  <select
                    className="rounded border border-border bg-surface px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    value={selectedStateId}
                    onChange={(event) => setSelectedStateId(event.target.value)}
                    disabled={statesDisabled}
                  >
                    <option value="">
                      {selectedCountryId
                        ? statesLoading
                          ? "Loading..."
                          : states.length === 0
                            ? "No states"
                            : "Select state"
                        : "Select a country"}
                    </option>
                    {states.map((state) => (
                      <option key={state.id} value={state.id}>
                        {state.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium">
                  <span>City</span>
                  <select
                    className="rounded border border-border bg-surface px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    value={selectedCityId}
                    onChange={(event) => setSelectedCityId(event.target.value)}
                    disabled={citiesDisabled}
                  >
                    <option value="">
                      {selectedStateId
                        ? citiesLoading
                          ? "Loading..."
                          : cities.length === 0
                            ? "No cities"
                            : "Select city"
                        : "Select a state"}
                    </option>
                    {cities.map((city) => (
                      <option key={city.id} value={city.id}>
                        {city.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {hierarchyError ? (
                <div className="rounded-md border border-error/20 bg-error/10 px-3 py-2 text-xs text-error">
                  {hierarchyError}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">
                  {hierarchyStatus}
                </div>
              )}
            </div>
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
                <div className="text-xs text-muted-foreground">
                  Selected:{" "}
                  <span className="font-medium">{masterFile.name}</span>
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
                        <span className="text-muted-foreground">
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
                      MASTER_LABELS[warning.sheet as keyof MasterSummary] ||
                      warning.sheet;
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
