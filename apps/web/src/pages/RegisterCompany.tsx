import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { isValidEmail, isValidPassword } from "../lib/validate";
import { toast } from "react-hot-toast";
import { Link } from "react-router-dom";

type CountryOption = {
  id: string;
  name: string;
  isoCode?: string | null;
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

export default function RegisterCompany() {
  const [companyName, setCompanyName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  const [leaveApplicableFrom, setLeaveApplicableFrom] = useState("");

  // Clear error feedback when user edits any input so stale errors don't linger
  function clearError() {
    if (error) setError(null);
  }

  async function loadCountries() {
    try {
      setOptionsError(null);
      setCountriesLoading(true);
      const res = await api.get("/masters/countries");
      const list = Array.isArray(res.data?.countries)
        ? (res.data.countries as CountryOption[])
        : [];
      setCountries(list);
      setSelectedCountry((prev) =>
        prev && list.some((item) => item.id === prev) ? prev : ""
      );
    } catch (err: any) {
      console.error(err);
      setOptionsError(
        err?.response?.data?.error ||
          "Failed to load countries. Please try again."
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
      setOptionsError(null);
      setStatesLoading(true);
      const res = await api.get("/masters/states", { params: { countryId } });
      const list = Array.isArray(res.data?.states)
        ? (res.data.states as StateOption[])
        : [];
      setStates(list);
      setSelectedState((prev) =>
        prev && list.some((item) => item.id === prev) ? prev : ""
      );
    } catch (err: any) {
      console.error(err);
      setOptionsError(
        err?.response?.data?.error ||
          "Failed to load states for the selected country."
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
      setOptionsError(null);
      setCitiesLoading(true);
      const res = await api.get("/masters/cities", { params: { stateId } });
      const list = Array.isArray(res.data?.cities)
        ? (res.data.cities as CityOption[])
        : [];
      setCities(list);
      setSelectedCity((prev) =>
        prev && list.some((item) => item.id === prev) ? prev : ""
      );
    } catch (err: any) {
      console.error(err);
      setOptionsError(
        err?.response?.data?.error ||
          "Failed to load cities for the selected state."
      );
      setCities([]);
      setSelectedCity("");
    } finally {
      setCitiesLoading(false);
    }
  }

  async function loadCompanyTypes() {
    try {
      setOptionsError(null);
      setCompanyTypesLoading(true);
      const res = await api.get("/masters/company-types");
      const list = Array.isArray(res.data?.companyTypes)
        ? (res.data.companyTypes as CompanyTypeOption[])
        : [];
      setCompanyTypes(list);
      setSelectedCompanyType((prev) =>
        prev && list.some((item) => item.id === prev) ? prev : ""
      );
    } catch (err: any) {
      console.error(err);
      setOptionsError(
        err?.response?.data?.error || "Failed to load company types."
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
    if (
      selectedCountry &&
      !matches.some((item) => item.id === selectedCountry)
    ) {
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

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setOptionsError(null);
    setLoading(true);
    try {
      if (!companyName.trim() || !adminName.trim()) {
        setError("Please fill in company and admin names");
        return;
      }
      if (!isValidEmail(adminEmail)) {
        setError("Please enter a valid admin email");
        return;
      }
      if (!isValidPassword(adminPassword)) {
        setError("Password must be more than 5 characters");
        return;
      }
      if (!selectedCountry || !selectedState || !selectedCity) {
        setError("Please select the company location (country, state, city)");
        return;
      }
      if (!selectedCompanyType) {
        setError("Please choose the company type");
        return;
      }
      await api.post("/companies/register", {
        companyName: companyName.trim(),
        adminName: adminName.trim(),
        adminEmail: adminEmail.trim(),
        adminPassword,
        countryId: selectedCountry,
        stateId: selectedState,
        cityId: selectedCity,
        companyTypeId: selectedCompanyType,
        leaveApplicableFrom,
      });
      setSuccess(
        "Thanks! Your registration was submitted. A superadmin will review it shortly."
      );
      setCompanyName("");
      setAdminName("");
      setAdminEmail("");
      setAdminPassword("");
      setOptionsError(null);
      setSelectedCountry("");
      setSelectedState("");
      setSelectedCity("");
      setSelectedCompanyType("");
      setCountryQuery("");
      setStateQuery("");
      setCityQuery("");
      setCompanyTypeQuery("");
      setLeaveApplicableFrom("");
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to submit registration";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-bg text-text">
      {/* Hero */}
      <header className="sticky top-0 z-30 bg-surface/70 backdrop-blur border-b border-border">
        <div className="mx-auto max-w-6xl px-4 h-16 flex items-center justify-between">
          <Link to="/" className="text-xl font-extrabold tracking-wide">
            <img src="/peracto_logo.png" className="w-[170px]" />
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <Link
              to="/login"
              className="inline-flex h-9 items-center justify-center rounded-md px-3 border border-border hover:bg-bg"
            >
              Login
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-10 md:py-16">
        <div className="flex items-center justify-center">
          <section className="bg-white rounded-lg border border-border shadow-sm p-6">
            <h2 className="text-xl font-semibold">Register your company</h2>
            <p className="text-sm text-muted mt-1">
              Submit your details and we’ll notify your admin after approval.
            </p>

            {error && (
              <div className="mt-4 rounded-md border border-error/20 bg-error/10 px-3 py-2 text-sm text-error">
                {error}
              </div>
            )}
            {success && (
              <div className="mt-4 rounded-md border border-success/20 bg-success/10 px-3 py-2 text-sm text-success">
                {success}
              </div>
            )}

            <form onSubmit={submit} className="mt-6 space-y-4">
              <Field
                label="Company Name"
                placeholder="Peracto Corporation"
                value={companyName}
                onChange={(v) => {
                  clearError();
                  setCompanyName(v);
                }}
              />
              <div className="grid sm:grid-cols-2 gap-4">
                <Field
                  label="Admin Name"
                  placeholder="Jane Doe"
                  value={adminName}
                  onChange={(v) => {
                    clearError();
                    setAdminName(v);
                  }}
                />
                <Field
                  label="Admin Email"
                  placeholder="jane@Peracto.com"
                  type="email"
                  value={adminEmail}
                  onChange={(v) => {
                    clearError();
                    setAdminEmail(v);
                  }}
                />
              </div>
              <Field
                label="Admin Password"
                placeholder="••••••••"
                type="password"
                value={adminPassword}
                onChange={(v) => {
                  clearError();
                  setAdminPassword(v);
                }}
              />

              {/* <div className="grid gap-4 md:grid-cols-2">
                <Field
                  label="Company Type Search"
                  value={companyTypeQuery}
                  onChange={(v) => {
                    setOptionsError(null);
                    setCompanyTypeQuery(v);
                  }}
                  placeholder="Search company type"
                />
                <Field
                  label="Country Search"
                  value={countryQuery}
                  onChange={(v) => {
                    setOptionsError(null);
                    setCountryQuery(v);
                  }}
                  placeholder="Search country"
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  label="State Search"
                  value={stateQuery}
                  onChange={(v) => {
                    setOptionsError(null);
                    setStateQuery(v);
                  }}
                  placeholder="Search state"
                />
                <Field
                  label="City Search"
                  value={cityQuery}
                  onChange={(v) => {
                    setOptionsError(null);
                    setCityQuery(v);
                  }}
                  placeholder="Search city"
                />
              </div> */}

              <div className="space-y-3 rounded-md border border-border/60 bg-muted/10 p-4">
                <div className="text-sm font-semibold">Company location</div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="flex flex-col">
                    <label className="space-y-1.5 text-sm font-medium required-label">
                      <span>Country</span>
                    </label>

                    <select
                      className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      value={selectedCountry}
                      onChange={(event) => {
                        clearError();
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
                  </div>
                  <div className="flex flex-col">
                    <label className="space-y-1.5 text-sm font-medium required-label">
                      <span>State</span>
                    </label>

                    <select
                      className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      value={selectedState}
                      onChange={(event) => {
                        clearError();
                        setOptionsError(null);
                        setSelectedState(event.target.value);
                        setCityQuery("");
                      }}
                      disabled={!selectedCountry || statesLoading || loading}
                    >
                      <option value="">
                        {!selectedCountry
                          ? "Select a country first"
                          : statesLoading
                          ? "Loading states..."
                          : filteredStates.length === 0
                          ? "No matches"
                          : "Select state"}
                      </option>
                      {filteredStates.map((state) => (
                        <option key={state.id} value={state.id}>
                          {state.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col">
                    <label className="space-y-1.5 text-sm font-medium required-label">
                      <span>City</span>
                    </label>

                    <select
                      className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      value={selectedCity}
                      onChange={(event) => {
                        clearError();
                        setOptionsError(null);
                        setSelectedCity(event.target.value);
                      }}
                      disabled={!selectedState || citiesLoading || loading}
                    >
                      <option value="">
                        {!selectedState
                          ? "Select a state first"
                          : citiesLoading
                          ? "Loading cities..."
                          : filteredCities.length === 0
                          ? "No matches"
                          : "Select city"}
                      </option>
                      {filteredCities.map((city) => (
                        <option key={city.id} value={city.id}>
                          {city.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex flex-col">
                  <label className="block space-y-1.5 text-sm font-medium required-label">
                    <span>Company type</span>
                  </label>
                  <select
                    className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    value={selectedCompanyType}
                    onChange={(event) => {
                      clearError();
                      setOptionsError(null);
                      setSelectedCompanyType(event.target.value);
                    }}
                    disabled={companyTypesLoading || loading}
                  >
                    <option value="">
                      {companyTypesLoading
                        ? "Loading company types..."
                        : filteredCompanyTypes.length === 0
                        ? "No matches"
                        : "Select company type"}
                    </option>
                    {filteredCompanyTypes.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.name}
                      </option>
                    ))}
                  </select>
                </div>
                {optionsError && (
                  <div className="rounded-md border border-warning/20 bg-warning/10 px-3 py-2 text-xs text-warning">
                    {optionsError}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Field
                  label="Leave Applicable From"
                  type="month"
                  value={leaveApplicableFrom}
                  onChange={(v) => {
                    clearError();
                    setLeaveApplicableFrom(v);
                  }}
                />
                <p className="text-xs text-muted">
                  Optional: choose the starting month for monthly leave accrual.
                </p>
              </div>

              <button
                type="submit"
                disabled={
                  loading ||
                  !companyName.trim() ||
                  !adminName.trim() ||
                  !isValidEmail(adminEmail) ||
                  !isValidPassword(adminPassword) ||
                  !selectedCountry ||
                  !selectedState ||
                  !selectedCity ||
                  !selectedCompanyType
                }
                className="w-full inline-flex items-center justify-center rounded-md bg-primary text-white h-10 disabled:opacity-60"
              >
                {loading ? "Submitting…" : "Submit Registration"}
              </button>
              <p className="text-xs text-muted text-center">
                Already approved?{" "}
                <Link to="/login" className="underline">
                  Login
                </Link>
              </p>
            </form>
          </section>
        </div>
      </main>

      <footer className="border-t border-border py-6 text-center text-xs text-muted">
        © {new Date().getFullYear()} HRMS — All rights reserved.
      </footer>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label
        className={`text-sm font-medium ${required ? "required-label" : ""}`}
      >
        {label}
      </label>
      <input
        className="w-full rounded-md border border-border bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
        placeholder={placeholder}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
