"use client";

import { useEffect, useMemo, useState, Fragment } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-hot-toast";
import { api } from "../lib/api";
import { useForm, FormProvider, Controller } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff } from "lucide-react";

type CountryOption = { id: string; name: string; isoCode?: string | null };
type StateOption = { id: string; name: string };
type CityOption = { id: string; name: string };
type CompanyTypeOption = { id: string; name: string };

const schema = z.object({
  companyName: z.string().trim().min(1, "Company name is required"),
  adminName: z.string().trim().min(1, "Admin name is required"),
  adminEmail: z.string().trim().email("Enter a valid email"),
  adminPassword: z.string().min(6, "Password must be more than 5 characters"),
  countryId: z.string().min(1, "Select a country"),
  stateId: z.string().min(1, "Select a state"),
  cityId: z.string().min(1, "Select a city"),
  companyTypeId: z.string().min(1, "Select a company type"),
  leaveApplicableFrom: z
    .string()
    .optional()
    .transform((v) => (v === "" ? undefined : v))
    .refine(
      (v) => v === undefined || /^\d{4}-\d{2}$/.test(v),
      "Invalid month format",
    ),
});

type FormValues = z.infer<typeof schema>;

export default function RegisterCompany() {
  const methods = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      companyName: "",
      adminName: "",
      adminEmail: "",
      adminPassword: "",
      countryId: "",
      stateId: "",
      cityId: "",
      companyTypeId: "",
      leaveApplicableFrom: "",
    },
    mode: "onTouched",
  });
  const {
    handleSubmit,
    formState: { errors, isSubmitting },
    setValue,
    watch,
    reset,
  } = methods;

  const [countries, setCountries] = useState<CountryOption[]>([]);
  const [states, setStates] = useState<StateOption[]>([]);
  const [cities, setCities] = useState<CityOption[]>([]);
  const [companyTypes, setCompanyTypes] = useState<CompanyTypeOption[]>([]);
  const [countriesLoading, setCountriesLoading] = useState(false);
  const [statesLoading, setStatesLoading] = useState(false);
  const [citiesLoading, setCitiesLoading] = useState(false);
  const [companyTypesLoading, setCompanyTypesLoading] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const countryId = watch("countryId");
  const stateId = watch("stateId");

  async function loadCountries() {
    try {
      setOptionsError(null);
      setCountriesLoading(true);
      const res = await api.get("/masters/countries");
      setCountries(
        Array.isArray(res.data?.countries) ? res.data.countries : [],
      );
    } catch (err: any) {
      setOptionsError(
        err?.response?.data?.error || "Failed to load countries.",
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
  async function loadStates(cid: string) {
    if (!cid) {
      setStates([]);
      setValue("stateId", "");
      setCities([]);
      setValue("cityId", "");
      return;
    }
    try {
      setOptionsError(null);
      setStatesLoading(true);
      const res = await api.get("/masters/states", {
        params: { countryId: cid },
      });
      setStates(Array.isArray(res.data?.states) ? res.data.states : []);
    } catch (err: any) {
      setOptionsError(err?.response?.data?.error || "Failed to load states.");
      setStates([]);
      setValue("stateId", "");
      setCities([]);
      setValue("cityId", "");
    } finally {
      setStatesLoading(false);
    }
  }
  async function loadCities(sid: string) {
    if (!sid) {
      setCities([]);
      setValue("cityId", "");
      return;
    }
    try {
      setOptionsError(null);
      setCitiesLoading(true);
      const res = await api.get("/masters/cities", {
        params: { stateId: sid },
      });
      setCities(Array.isArray(res.data?.cities) ? res.data.cities : []);
    } catch (err: any) {
      setOptionsError(err?.response?.data?.error || "Failed to load cities.");
      setCities([]);
      setValue("cityId", "");
    } finally {
      setCitiesLoading(false);
    }
  }
  async function loadCompanyTypes() {
    try {
      setOptionsError(null);
      setCompanyTypesLoading(true);
      const res = await api.get("/masters/company-types");
      setCompanyTypes(
        Array.isArray(res.data?.companyTypes) ? res.data.companyTypes : [],
      );
    } catch (err: any) {
      setOptionsError(
        err?.response?.data?.error || "Failed to load company types.",
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    loadStates(countryId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countryId]);
  useEffect(() => {
    loadCities(stateId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateId]);

  async function onSubmit(values: FormValues) {
    setSuccess(null);
    setOptionsError(null);
    try {
      await api.post("/companies/register", values);
      setSuccess(
        "Thanks! Your registration was submitted. A superadmin will review it shortly.",
      );
      reset();
    } catch (e: any) {
      const msg = e?.response?.data?.error || "Failed to submit registration";
      toast.error(msg);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-bg text-text">
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
          <section className="bg-white rounded-lg border border-border shadow-sm p-6 w-full max-w-2xl">
            <h2 className="text-xl font-semibold">Register your company</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Submit your details and we’ll notify your admin after approval.
            </p>

            {success && (
              <div className="mt-4 rounded-md border border-success/20 bg-success/10 px-3 py-2 text-sm text-success">
                {success}
              </div>
            )}
            {optionsError && (
              <div className="mt-4 rounded-md border border-warning/20 bg-warning/10 px-3 py-2 text-xs text-warning">
                {optionsError}
              </div>
            )}

            <FormProvider {...methods}>
              <form
                onSubmit={handleSubmit(onSubmit)}
                className="mt-6 space-y-4"
              >
                <RHFField
                  name="companyName"
                  label="Company Name"
                  placeholder="Peracto Corporation"
                />
                <div className="grid sm:grid-cols-2 gap-4">
                  <RHFField
                    name="adminName"
                    label="Admin Name"
                    placeholder="Jane Doe"
                  />
                  <RHFField
                    name="adminEmail"
                    label="Admin Email"
                    type="email"
                    placeholder="jane@peracto.com"
                  />
                </div>
                <PasswordField
                  name="adminPassword"
                  label="Admin Password"
                  placeholder="••••••••"
                />

                <div className="space-y-3 rounded-md border border-border/60 bg-muted/10 p-4">
                  <div className="text-sm font-semibold">Company location</div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <RHFSelect
                      name="countryId"
                      label="Country"
                      disabled={countriesLoading || isSubmitting}
                      options={countries.map((c) => ({
                        value: c.id,
                        label: c.name,
                      }))}
                      loadingText="Loading countries..."
                      placeholder="Select country"
                    />
                    <RHFSelect
                      name="stateId"
                      label="State"
                      disabled={!countryId || statesLoading || isSubmitting}
                      options={states.map((s) => ({
                        value: s.id,
                        label: s.name,
                      }))}
                      loadingText={
                        !countryId
                          ? "Select a country first"
                          : "Loading states..."
                      }
                      placeholder="Select state"
                    />
                    <RHFSelect
                      name="cityId"
                      label="City"
                      disabled={!stateId || citiesLoading || isSubmitting}
                      options={cities.map((c) => ({
                        value: c.id,
                        label: c.name,
                      }))}
                      loadingText={
                        !stateId ? "Select a state first" : "Loading cities..."
                      }
                      placeholder="Select city"
                    />
                  </div>
                  <RHFSelect
                    name="companyTypeId"
                    label="Company type"
                    disabled={companyTypesLoading || isSubmitting}
                    options={companyTypes.map((t) => ({
                      value: t.id,
                      label: t.name,
                    }))}
                    loadingText="Loading company types..."
                    placeholder="Select company type"
                  />
                </div>

                <RHFField
                  name="leaveApplicableFrom"
                  label="Leave Applicable From"
                  type="month"
                />
                <p className="text-xs text-muted-foreground -mt-2">
                  Optional: choose the starting month for monthly leave accrual.
                </p>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full inline-flex items-center justify-center rounded-md bg-primary text-white h-10 disabled:opacity-60"
                >
                  {isSubmitting ? "Submitting…" : "Submit Registration"}
                </button>
                <p className="text-xs text-muted-foreground text-center">
                  Already approved?{" "}
                  <Link to="/login" className="underline">
                    Login
                  </Link>
                </p>
              </form>
            </FormProvider>
          </section>
        </div>
      </main>

      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} HRMS — All rights reserved.
      </footer>
    </div>
  );
}

/* ---------- Reusable RHF inputs ---------- */

function RHFField({
  name,
  label,
  type = "text",
  placeholder,
}: {
  name: keyof FormValues;
  label: string;
  type?: string;
  placeholder?: string;
}) {
  const {
    register,
    formState: { errors },
  } = useFormContextStrict<FormValues>();
  const err = errors[name]?.message as string | undefined;
  return (
    <div className="space-y-1.5">
      <label className={`text-sm font-medium ${err ? "text-error" : ""}`}>
        {label}
      </label>
      <input
        {...register(name)}
        type={type}
        placeholder={placeholder}
        className={`w-full rounded-md border bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-primary ${
          err ? "border-error" : "border-border"
        }`}
      />
      {err && <p className="text-xs text-error">{err}</p>}
    </div>
  );
}

function PasswordField({
  name,
  label,
  placeholder,
}: {
  name: keyof FormValues;
  label: string;
  placeholder?: string;
}) {
  const {
    register,
    formState: { errors },
  } = useFormContextStrict<FormValues>();
  const [show, setShow] = useState(false);
  const err = errors[name]?.message as string | undefined;

  return (
    <div className="space-y-1.5">
      <label className={`text-sm font-medium ${err ? "text-error" : ""}`}>
        {label}
      </label>
      <div className="relative">
        <input
          {...register(name)}
          type={show ? "text" : "password"}
          placeholder={placeholder}
          className={`w-full rounded-md border bg-white px-3 py-2 pr-10 outline-none focus:ring-2 focus:ring-primary ${
            err ? "border-error" : "border-border"
          }`}
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label={show ? "Hide password" : "Show password"}
        >
          {show ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {err && <p className="text-xs text-error">{err}</p>}
    </div>
  );
}

function RHFSelect({
  name,
  label,
  options,
  placeholder,
  loadingText,
  disabled,
}: {
  name: keyof FormValues;
  label: string;
  options: { value: string; label: string }[];
  placeholder?: string;
  loadingText?: string;
  disabled?: boolean;
}) {
  const {
    control,
    formState: { errors },
  } = useFormContextStrict<FormValues>();
  const err = errors[name]?.message as string | undefined;

  return (
    <div className="flex flex-col">
      <label
        className={`space-y-1.5 text-sm font-medium ${err ? "text-error" : ""}`}
      >
        <span>{label}</span>
      </label>
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <select
            {...field}
            disabled={disabled}
            className={`w-full rounded-md border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 ${
              err ? "border-error" : "border-border"
            }`}
          >
            <option value="">
              {disabled
                ? loadingText || "Loading…"
                : options.length === 0
                  ? "No options"
                  : placeholder || "Select option"}
            </option>
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        )}
      />
      {err && <p className="text-xs text-error mt-1">{err}</p>}
    </div>
  );
}

/* ---------- tiny helper to avoid optional chaining mistakes with RHF ---------- */
import { useFormContext } from "react-hook-form";
function useFormContextStrict<T>() {
  const ctx = useFormContext();
  if (!ctx)
    throw new Error("RHF components must be used inside <FormProvider>");
  return ctx;
}
