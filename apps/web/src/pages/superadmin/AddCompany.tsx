import { useEffect, useMemo, useState, FormEvent } from "react";
import { api } from "../../lib/api";

type CountryOption = {
  id: string;
  name: string;
};

type StateOption = {
  id: string;
  name: string;
};

type CityOption = {
  id: string;
  name: string;
};

type CompanyTypeOption = {
  id: string;
  name: string;
};

type Company = {
  _id: string;
  name: string;
  admin?: { name: string; email: string };
};

export default function AddCompany() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submittingExisting, setSubmittingExisting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [companyName, setCompanyName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [countries, setCountries] = useState<CountryOption[]>([]);
  const [states, setStates] = useState<StateOption[]>([]);
  const [cities, setCities] = useState<CityOption[]>([]);
  const [companyTypes, setCompanyTypes] = useState<CompanyTypeOption[]>([]);
  const [selectedCountry, setSelectedCountry] = useState("");
  const [selectedState, setSelectedState] = useState("");
  const [selectedCity, setSelectedCity] = useState("");
  const [selectedCompanyType, setSelectedCompanyType] = useState("");
  const [countryQuery, setCountryQuery] = useState("");
  const [stateQuery, setStateQuery] = useState("");
  const [cityQuery, setCityQuery] = useState("");
  const [companyTypeQuery, setCompanyTypeQuery] = useState("");
  const [countriesLoading, setCountriesLoading] = useState(false);
  const [statesLoading, setStatesLoading] = useState(false);
  const [citiesLoading, setCitiesLoading] = useState(false);
  const [companyTypesLoading, setCompanyTypesLoading] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  const [existingCompany, setExistingCompany] = useState("");
  const [newAdminName, setNewAdminName] = useState("");
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [newAdminPassword, setNewAdminPassword] = useState("");

  function resetAlerts() {
    setErr(null);
    setOk(null);
  }

  // Clear banners on any field edit to avoid sticky errors
  function clearBanners() {
    if (err) setErr(null);
    if (ok) setOk(null);
  }

  async function load() {
    try {
      setLoading(true);
      const res = await api.get("/companies");
      setCompanies(res.data.companies);
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to load companies");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function loadCountries() {
    try {
      setCountriesLoading(true);
      setOptionsError(null);
      const res = await api.get("/masters/countries");
      const list = Array.isArray(res.data?.countries)
        ? (res.data.countries as CountryOption[])
        : [];
      setCountries(list);
      setSelectedCountry((prev) =>
        prev && list.some((item) => item.id === prev) ? prev : ""
      );
    } catch (error: any) {
      console.error(error);
      setOptionsError(
        error?.response?.data?.error || "Failed to load countries"
      );
      setCountries([]);
      setSelectedCountry("");
      setStates([]);
      setSelectedState("");
      setCities([]);
      setSelectedCity("");
    } finally {
      setCountriesLoading(false);
    }
  }

  async function loadStates(countryId: string) {
    if (!countryId) {
      setStates([]);
      setSelectedState("");
      setCities([]);
      setSelectedCity("");
      return;
    }
    try {
      setStatesLoading(true);
      setOptionsError(null);
      const res = await api.get("/masters/states", { params: { countryId } });
      const list = Array.isArray(res.data?.states)
        ? (res.data.states as StateOption[])
        : [];
      setStates(list);
      setSelectedState((prev) =>
        prev && list.some((item) => item.id === prev) ? prev : ""
      );
    } catch (error: any) {
      console.error(error);
      setOptionsError(
        error?.response?.data?.error || "Failed to load states"
      );
      setStates([]);
      setSelectedState("");
      setCities([]);
      setSelectedCity("");
    } finally {
      setStatesLoading(false);
    }
  }

  async function loadCities(stateId: string) {
    if (!stateId) {
      setCities([]);
      setSelectedCity("");
      return;
    }
    try {
      setCitiesLoading(true);
      setOptionsError(null);
      const res = await api.get("/masters/cities", { params: { stateId } });
      const list = Array.isArray(res.data?.cities)
        ? (res.data.cities as CityOption[])
        : [];
      setCities(list);
      setSelectedCity((prev) =>
        prev && list.some((item) => item.id === prev) ? prev : ""
      );
    } catch (error: any) {
      console.error(error);
      setOptionsError(
        error?.response?.data?.error || "Failed to load cities"
      );
      setCities([]);
      setSelectedCity("");
    } finally {
      setCitiesLoading(false);
    }
  }

  async function loadCompanyTypes() {
    try {
      setCompanyTypesLoading(true);
      setOptionsError(null);
      const res = await api.get("/masters/company-types");
      const list = Array.isArray(res.data?.companyTypes)
        ? (res.data.companyTypes as CompanyTypeOption[])
        : [];
      setCompanyTypes(list);
      setSelectedCompanyType((prev) =>
        prev && list.some((item) => item.id === prev) ? prev : ""
      );
    } catch (error: any) {
      console.error(error);
      setOptionsError(
        error?.response?.data?.error || "Failed to load company types"
      );
      setCompanyTypes([]);
      setSelectedCompanyType("");
    } finally {
      setCompanyTypesLoading(false);
    }
  }

  useEffect(() => {
    loadCountries();
    loadCompanyTypes();
  }, []);

  useEffect(() => {
    if (!selectedCountry) {
      setStates([]);
      setSelectedState("");
      setCities([]);
      setSelectedCity("");
      return;
    }
    loadStates(selectedCountry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCountry]);

  useEffect(() => {
    if (!selectedState) {
      setCities([]);
      setSelectedCity("");
      return;
    }
    loadCities(selectedState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedState]);

  const filteredCountries = useMemo(() => {
    const query = countryQuery.trim().toLowerCase();
    if (!query) return countries;
    const matches = countries.filter((country) =>
      country.name.toLowerCase().includes(query)
    );
    if (selectedCountry && !matches.some((item) => item.id === selectedCountry)) {
      const selected = countries.find((item) => item.id === selectedCountry);
      if (selected) matches.unshift(selected);
    }
    return matches;
  }, [countries, countryQuery, selectedCountry]);

  const filteredStates = useMemo(() => {
    const query = stateQuery.trim().toLowerCase();
    if (!query) return states;
    const matches = states.filter((state) =>
      state.name.toLowerCase().includes(query)
    );
    if (selectedState && !matches.some((item) => item.id === selectedState)) {
      const selected = states.find((item) => item.id === selectedState);
      if (selected) matches.unshift(selected);
    }
    return matches;
  }, [states, stateQuery, selectedState]);

  const filteredCities = useMemo(() => {
    const query = cityQuery.trim().toLowerCase();
    if (!query) return cities;
    const matches = cities.filter((city) =>
      city.name.toLowerCase().includes(query)
    );
    if (selectedCity && !matches.some((item) => item.id === selectedCity)) {
      const selected = cities.find((item) => item.id === selectedCity);
      if (selected) matches.unshift(selected);
    }
    return matches;
  }, [cities, cityQuery, selectedCity]);

  const filteredCompanyTypes = useMemo(() => {
    const query = companyTypeQuery.trim().toLowerCase();
    if (!query) return companyTypes;
    const matches = companyTypes.filter((type) =>
      type.name.toLowerCase().includes(query)
    );
    if (
      selectedCompanyType &&
      !matches.some((item) => item.id === selectedCompanyType)
    ) {
      const selected = companyTypes.find(
        (item) => item.id === selectedCompanyType
      );
      if (selected) matches.unshift(selected);
    }
    return matches;
  }, [companyTypes, companyTypeQuery, selectedCompanyType]);

  const companiesWithoutAdmin = useMemo(
    () => companies.filter((c) => !c.admin),
    [companies]
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    resetAlerts();
    setOptionsError(null);
    setSubmitting(true);
    try {
      await api.post("/companies", {
        companyName: companyName.trim(),
        adminName: adminName.trim(),
        adminEmail: adminEmail.trim(),
        adminPassword,
        countryId: selectedCountry,
        stateId: selectedState,
        cityId: selectedCity,
        companyTypeId: selectedCompanyType,
      });
      setCompanyName("");
      setAdminName("");
      setAdminEmail("");
      setAdminPassword("");
      setSelectedCountry("");
      setSelectedState("");
      setSelectedCity("");
      setSelectedCompanyType("");
      setCountryQuery("");
      setStateQuery("");
      setCityQuery("");
      setCompanyTypeQuery("");
      setOk("Company and admin created");
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to create company");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitExisting(e: FormEvent) {
    e.preventDefault();
    resetAlerts();
    setSubmittingExisting(true);
    try {
      await api.post(`/companies/${existingCompany}/admin`, {
        adminName: newAdminName.trim(),
        adminEmail: newAdminEmail.trim(),
        adminPassword: newAdminPassword,
      });
      setExistingCompany("");
      setNewAdminName("");
      setNewAdminEmail("");
      setNewAdminPassword("");
      setOk("Admin assigned to company");
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to assign admin");
    } finally {
      setSubmittingExisting(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold">Companies</h2>
        <p className="text-sm text-muted">
          Create a company or assign an admin.
        </p>
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

      <div className="grid gap-8 md:grid-cols-2">
        <section className="rounded-lg border border-border bg-surface shadow-sm">
          <div className="border-b border-border px-6 py-4">
            <h3 className="text-lg font-semibold">Create Company</h3>
          </div>
          <form onSubmit={submit} className="px-6 py-5 space-y-4">
            <Field
              label="Company Name"
              value={companyName}
              onChange={(v) => {
                clearBanners();
                setCompanyName(v);
              }}
              placeholder="Peracto Corp"
            />
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label="Admin Name"
                value={adminName}
                onChange={(v) => {
                  clearBanners();
                  setAdminName(v);
                }}
                placeholder="Jane Doe"
              />
              <Field
                label="Admin Email"
                type="email"
                value={adminEmail}
                onChange={(v) => {
                  clearBanners();
                  setAdminEmail(v);
                }}
                placeholder="jane@Peracto.com"
              />
            </div>
            <Field
              label="Admin Password"
              type="password"
              value={adminPassword}
              onChange={(v) => {
                clearBanners();
                setAdminPassword(v);
              }}
              placeholder="••••••••"
            />
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label="Company Type Search"
                value={companyTypeQuery}
                onChange={(v) => {
                  setOptionsError(null);
                  setCompanyTypeQuery(v);
                }}
                placeholder="Search company type"
              />
              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  label="Country Search"
                  value={countryQuery}
                  onChange={(v) => {
                    setOptionsError(null);
                    setCountryQuery(v);
                  }}
                  placeholder="Search country"
                />
                <Field
                  label="State Search"
                  value={stateQuery}
                  onChange={(v) => {
                    setOptionsError(null);
                    setStateQuery(v);
                  }}
                  placeholder="Search state"
                />
              </div>
            </div>
            <Field
              label="City Search"
              value={cityQuery}
              onChange={(v) => {
                setOptionsError(null);
                setCityQuery(v);
              }}
              placeholder="Search city"
            />
            <div className="space-y-3 rounded-md border border-border/60 bg-muted/10 p-4">
              <div className="text-sm font-semibold">Company location</div>
              <div className="grid gap-3 md:grid-cols-3">
                <label className="space-y-1.5 text-sm font-medium">
                  <span>Country</span>
                  <select
                    className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    value={selectedCountry}
                    onChange={(event) => {
                      clearBanners();
                      setOptionsError(null);
                      setSelectedCountry(event.target.value);
                      setStateQuery("");
                      setCityQuery("");
                    }}
                    disabled={countriesLoading || loading}
                  >
                    <option value="">
                      {countriesLoading
                        ? "Loading countries..."
                        : filteredCountries.length === 0
                        ? "No matches"
                        : "Select country"}
                    </option>
                    {filteredCountries.map((country) => (
                      <option key={country.id} value={country.id}>
                        {country.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5 text-sm font-medium">
                  <span>State</span>
                  <select
                    className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    value={selectedState}
                    onChange={(event) => {
                      clearBanners();
                      setOptionsError(null);
                      setSelectedState(event.target.value);
                      setCityQuery("");
                    }}
                    disabled={!selectedCountry || statesLoading || loading}
                  >
                    <option value="">
                      {!selectedCountry
                        ? 'Select a country first'
                        : statesLoading
                        ? 'Loading states...'
                        : filteredStates.length === 0
                        ? 'No matches'
                        : 'Select state'}
                    </option>
                    {filteredStates.map((state) => (
                      <option key={state.id} value={state.id}>
                        {state.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5 text-sm font-medium">
                  <span>City</span>
                  <select
                    className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    value={selectedCity}
                    onChange={(event) => {
                      clearBanners();
                      setOptionsError(null);
                      setSelectedCity(event.target.value);
                    }}
                    disabled={!selectedState || citiesLoading || loading}
                  >
                    <option value="">
                      {!selectedState
                        ? 'Select a state first'
                        : citiesLoading
                        ? 'Loading cities...'
                        : filteredCities.length === 0
                        ? 'No matches'
                        : 'Select city'}
                    </option>
                    {filteredCities.map((city) => (
                      <option key={city.id} value={city.id}>
                        {city.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block space-y-1.5 text-sm font-medium">
                <span>Company type</span>
                <select
                  className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  value={selectedCompanyType}
                  onChange={(event) => {
                    clearBanners();
                    setOptionsError(null);
                    setSelectedCompanyType(event.target.value);
                  }}
                  disabled={companyTypesLoading || loading}
                >
                  <option value="">
                    {companyTypesLoading
                      ? 'Loading company types...'
                      : filteredCompanyTypes.length === 0
                      ? 'No matches'
                      : 'Select company type'}
                  </option>
                  {filteredCompanyTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </label>
              {optionsError && (
                <div className="rounded-md border border-warning/20 bg-warning/10 px-3 py-2 text-xs text-warning">
                  {optionsError}
                </div>
              )}
            </div>
            <div className="pt-2">
              <button
                type="submit"
                disabled={
                  submitting ||
                  !companyName ||
                  !adminName ||
                  !adminEmail ||
                  !adminPassword ||
                  !selectedCountry ||
                  !selectedState ||
                  !selectedCity ||
                  !selectedCompanyType
                }
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
              >
                {submitting ? "Creating…" : "Add Company"}
              </button>
            </div>
          </form>
        </section>

        <section className="rounded-lg border border-border bg-surface shadow-sm">
          <div className="border-b border-border px-6 py-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold">Assign Admin</h3>
            <span className="text-xs text-muted">
              {loading
                ? "Loading…"
                : `${companiesWithoutAdmin.length} without admin`}
            </span>
          </div>
          <form onSubmit={submitExisting} className="px-6 py-5 space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Company</label>
              <select
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                value={existingCompany}
                onChange={(e) => {
                  clearBanners();
                  setExistingCompany(e.target.value);
                }}
              >
                <option value="">Select Company</option>
                {companiesWithoutAdmin.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label="Admin Name"
                value={newAdminName}
                onChange={(v) => {
                  clearBanners();
                  setNewAdminName(v);
                }}
                placeholder="John Smith"
              />
              <Field
                label="Admin Email"
                type="email"
                value={newAdminEmail}
                onChange={(v) => {
                  clearBanners();
                  setNewAdminEmail(v);
                }}
                placeholder="john@Peracto.com"
              />
            </div>
            <Field
              label="Admin Password"
              type="password"
              value={newAdminPassword}
              onChange={(v) => {
                clearBanners();
                setNewAdminPassword(v);
              }}
              placeholder="••••••••"
            />
            <div className="pt-2">
              <button
                type="submit"
                disabled={
                  submittingExisting ||
                  !existingCompany ||
                  !newAdminName ||
                  !newAdminEmail ||
                  !newAdminPassword
                }
                className="inline-flex items-center justify-center rounded-md bg-secondary px-4 py-2 text-white disabled:opacity-60"
              >
                {submittingExisting ? "Assigning…" : "Add Admin"}
              </button>
            </div>
          </form>
        </section>
      </div>

      <section className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-lg font-semibold">All Companies</h3>
        </div>
        <div className="divide-y divide-border">
          {loading ? (
            <div className="px-6 py-4 text-sm text-muted">Loading…</div>
          ) : companies.length === 0 ? (
            <div className="px-6 py-4 text-sm text-muted">
              No companies yet.
            </div>
          ) : (
            companies.map((c) => (
              <div
                key={c._id}
                className="px-6 py-3 flex items-center justify-between"
              >
                <div className="font-medium">{c.name}</div>
                <div className="text-sm text-muted">
                  {c.admin
                    ? `Admin: ${c.admin.name} (${c.admin.email})`
                    : "No admin"}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>
      <input
        className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
        placeholder={placeholder}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
