import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { api } from "../../lib/api";
import { useNavigate } from "react-router-dom";
import {
  CompanyCreateSchema,
  type CompanyCreateValues,
} from "../../schemas/company";

type CountryOption = { id: string; name: string };
type StateOption = { id: string; name: string };
type CityOption = { id: string; name: string };
type CompanyTypeOption = { id: string; name: string };
type Company = {
  _id: string;
  name: string;
  admin?: { name: string; email: string };
};

export default function AddCompany() {
  const navigate = useNavigate();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [countries, setCountries] = useState<CountryOption[]>([]);
  const [states, setStates] = useState<StateOption[]>([]);
  const [cities, setCities] = useState<CityOption[]>([]);
  const [companyTypes, setCompanyTypes] = useState<CompanyTypeOption[]>([]);
  const [countryQuery, setCountryQuery] = useState("");
  const [stateQuery, setStateQuery] = useState("");
  const [cityQuery, setCityQuery] = useState("");
  const [companyTypeQuery, setCompanyTypeQuery] = useState("");
  const [countriesLoading, setCountriesLoading] = useState(false);
  const [statesLoading, setStatesLoading] = useState(false);
  const [citiesLoading, setCitiesLoading] = useState(false);
  const [companyTypesLoading, setCompanyTypesLoading] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting, isValid },
    watch,
  } = useForm<CompanyCreateValues>({
    resolver: zodResolver(CompanyCreateSchema),
    defaultValues: {
      companyName: "",
      adminName: "",
      adminEmail: "",
      adminPassword: "",
      countryId: "",
      stateId: "",
      cityId: "",
      companyTypeId: "",
    },
    mode: "onChange",
  });

  const countryId = watch("countryId");
  const stateId = watch("stateId");

  function resetAlerts() {
    setErr(null);
    setOk(null);
  }

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

  useEffect(() => {
    load();
  }, []);

  async function loadCountries() {
    try {
      setCountriesLoading(true);
      setOptionsError(null);
      const res = await api.get("/masters/countries");
      setCountries(
        Array.isArray(res.data?.countries) ? res.data.countries : []
      );
    } catch (error: any) {
      setOptionsError(
        error?.response?.data?.error || "Failed to load countries"
      );
      setCountries([]);
      setValue("countryId", "");
      setStates([]);
      setValue("stateId", "");
      setCities([]);
      setValue("cityId", "");
    } finally {
      setCountriesLoading(false);
    }
  }

  async function loadStates(countryIdParam: string) {
    if (!countryIdParam) {
      setStates([]);
      setValue("stateId", "");
      setCities([]);
      setValue("cityId", "");
      return;
    }
    try {
      setStatesLoading(true);
      setOptionsError(null);
      const res = await api.get("/masters/states", {
        params: { countryId: countryIdParam },
      });
      setStates(Array.isArray(res.data?.states) ? res.data.states : []);
    } catch (error: any) {
      setOptionsError(error?.response?.data?.error || "Failed to load states");
      setStates([]);
      setValue("stateId", "");
      setCities([]);
      setValue("cityId", "");
    } finally {
      setStatesLoading(false);
    }
  }

  async function loadCities(stateIdParam: string) {
    if (!stateIdParam) {
      setCities([]);
      setValue("cityId", "");
      return;
    }
    try {
      setCitiesLoading(true);
      setOptionsError(null);
      const res = await api.get("/masters/cities", {
        params: { stateId: stateIdParam },
      });
      setCities(Array.isArray(res.data?.cities) ? res.data.cities : []);
    } catch (error: any) {
      setOptionsError(error?.response?.data?.error || "Failed to load cities");
      setCities([]);
      setValue("cityId", "");
    } finally {
      setCitiesLoading(false);
    }
  }

  async function loadCompanyTypes() {
    try {
      setCompanyTypesLoading(true);
      setOptionsError(null);
      const res = await api.get("/masters/company-types");
      setCompanyTypes(
        Array.isArray(res.data?.companyTypes) ? res.data.companyTypes : []
      );
    } catch (error: any) {
      setOptionsError(
        error?.response?.data?.error || "Failed to load company types"
      );
      setCompanyTypes([]);
      setValue("companyTypeId", "");
    } finally {
      setCompanyTypesLoading(false);
    }
  }

  useEffect(() => {
    loadCountries();
    loadCompanyTypes();
  }, []);

  useEffect(() => {
    if (!countryId) {
      setStates([]);
      setValue("stateId", "");
      setCities([]);
      setValue("cityId", "");
      return;
    }
    setValue("stateId", "");
    setValue("cityId", "");
    loadStates(countryId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countryId]);

  useEffect(() => {
    if (!stateId) {
      setCities([]);
      setValue("cityId", "");
      return;
    }
    setValue("cityId", "");
    loadCities(stateId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateId]);

  const filteredCountries = useMemo(() => {
    const q = countryQuery.trim().toLowerCase();
    const list = !q
      ? countries
      : countries.filter((c) => c.name.toLowerCase().includes(q));
    if (watch("countryId") && !list.some((i) => i.id === watch("countryId"))) {
      const sel = countries.find((i) => i.id === watch("countryId"));
      if (sel) list.unshift(sel);
    }
    return list;
  }, [countries, countryQuery, watch]);

  const filteredStates = useMemo(() => {
    const q = stateQuery.trim().toLowerCase();
    const list = !q
      ? states
      : states.filter((s) => s.name.toLowerCase().includes(q));
    if (watch("stateId") && !list.some((i) => i.id === watch("stateId"))) {
      const sel = states.find((i) => i.id === watch("stateId"));
      if (sel) list.unshift(sel);
    }
    return list;
  }, [states, stateQuery, watch]);

  const filteredCities = useMemo(() => {
    const q = cityQuery.trim().toLowerCase();
    const list = !q
      ? cities
      : cities.filter((c) => c.name.toLowerCase().includes(q));
    if (watch("cityId") && !list.some((i) => i.id === watch("cityId"))) {
      const sel = cities.find((i) => i.id === watch("cityId"));
      if (sel) list.unshift(sel);
    }
    return list;
  }, [cities, cityQuery, watch]);

  const filteredCompanyTypes = useMemo(() => {
    const q = companyTypeQuery.trim().toLowerCase();
    const list = !q
      ? companyTypes
      : companyTypes.filter((t) => t.name.toLowerCase().includes(q));
    if (
      watch("companyTypeId") &&
      !list.some((i) => i.id === watch("companyTypeId"))
    ) {
      const sel = companyTypes.find((i) => i.id === watch("companyTypeId"));
      if (sel) list.unshift(sel);
    }
    return list;
  }, [companyTypes, companyTypeQuery, watch]);

  const onSubmit = async (data: CompanyCreateValues) => {
    resetAlerts();
    setOptionsError(null);
    setSubmitting(true);
    try {
      await api.post("/companies", {
        companyName: data.companyName.trim(),
        adminName: data.adminName.trim(),
        adminEmail: data.adminEmail.trim(),
        adminPassword: data.adminPassword,
        countryId: data.countryId,
        stateId: data.stateId,
        cityId: data.cityId,
        companyTypeId: data.companyTypeId,
      });
      reset();
      setCountryQuery("");
      setStateQuery("");
      setCityQuery("");
      setCompanyTypeQuery("");
      setOk("Company and admin created");
      navigate("/superadmin/companies");
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to create company");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold">Companies</h2>
        <p className="text-sm text-muted">Create a company.</p>
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

          <form
            onSubmit={handleSubmit(onSubmit)}
            className="px-6 py-5 space-y-4"
          >
            <div className="space-y-2">
              <label className="text-sm font-medium required-label">
                Company Name
              </label>
              <input
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                placeholder="Peracto Corp"
                {...register("companyName")}
              />
              {errors.companyName && (
                <p className="text-xs text-error mt-1">
                  {errors.companyName.message}
                </p>
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium required-label">
                  Admin Name
                </label>
                <input
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                  placeholder="Jane Doe"
                  {...register("adminName")}
                />
                {errors.adminName && (
                  <p className="text-xs text-error mt-1">
                    {errors.adminName.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium required-label">
                  Admin Email
                </label>
                <input
                  type="email"
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                  placeholder="jane@peracto.com"
                  {...register("adminEmail")}
                />
                {errors.adminEmail && (
                  <p className="text-xs text-error mt-1">
                    {errors.adminEmail.message}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium required-label">
                Admin Password
              </label>
              <input
                type="password"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                placeholder="••••••••"
                {...register("adminPassword")}
              />
              {errors.adminPassword && (
                <p className="text-xs text-error mt-1">
                  {errors.adminPassword.message}
                </p>
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Company Type Search
                </label>
                <input
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                  placeholder="Search company type"
                  value={companyTypeQuery}
                  onChange={(e) => {
                    setOptionsError(null);
                    setCompanyTypeQuery(e.target.value);
                  }}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Country Search</label>
                  <input
                    className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                    placeholder="Search country"
                    value={countryQuery}
                    onChange={(e) => {
                      setOptionsError(null);
                      setCountryQuery(e.target.value);
                    }}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">State Search</label>
                  <input
                    className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                    placeholder="Search state"
                    value={stateQuery}
                    onChange={(e) => {
                      setOptionsError(null);
                      setStateQuery(e.target.value);
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">City Search</label>
              <input
                className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus:ring-2 focus:ring-primary"
                placeholder="Search city"
                value={cityQuery}
                onChange={(e) => {
                  setOptionsError(null);
                  setCityQuery(e.target.value);
                }}
              />
            </div>

            <div className="space-y-3 rounded-md border border-border/60 bg-muted/10 p-4">
              <div className="text-sm font-semibold">Company location</div>
              <div className="grid gap-3 md:grid-cols-3">
                <label className="space-y-1.5 text-sm font-medium required-label">
                  <span>Country</span>
                  <select
                    className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    disabled={countriesLoading || loading}
                    {...register("countryId", {
                      onChange: () => {
                        setOptionsError(null);
                        setValue("stateId", "");
                        setValue("cityId", "");
                      },
                    })}
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
                  {errors.countryId && (
                    <p className="text-xs text-error mt-1">
                      {errors.countryId.message}
                    </p>
                  )}
                </label>

                <label className="space-y-1.5 text-sm font-medium required-label">
                  <span>State</span>
                  <select
                    className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    disabled={!countryId || statesLoading || loading}
                    {...register("stateId", {
                      onChange: () => {
                        setOptionsError(null);
                        setValue("cityId", "");
                      },
                    })}
                  >
                    <option value="">
                      {!countryId
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
                  {errors.stateId && (
                    <p className="text-xs text-error mt-1">
                      {errors.stateId.message}
                    </p>
                  )}
                </label>

                <label className="space-y-1.5 text-sm font-medium required-label">
                  <span>City</span>
                  <select
                    className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    disabled={!stateId || citiesLoading || loading}
                    {...register("cityId")}
                  >
                    <option value="">
                      {!stateId
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
                  {errors.cityId && (
                    <p className="text-xs text-error mt-1">
                      {errors.cityId.message}
                    </p>
                  )}
                </label>
              </div>

              <label className="block space-y-1.5 text-sm font-medium required-label">
                <span>Company type</span>
                <select
                  className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  disabled={companyTypesLoading || loading}
                  {...register("companyTypeId")}
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
                {errors.companyTypeId && (
                  <p className="text-xs text-error mt-1">
                    {errors.companyTypeId.message}
                  </p>
                )}
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
                disabled={submitting || isSubmitting}
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60"
              >
                {submitting || isSubmitting ? "Creating…" : "Add Company"}
              </button>
            </div>
          </form>
        </section>
      </div>

      {/* <section className="rounded-lg border border-border bg-surface shadow-sm">
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
      </section> */}
    </div>
  );
}
