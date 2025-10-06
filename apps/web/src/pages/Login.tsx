import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { api } from "../lib/api";
import { setAuth } from "../lib/auth";
import { applyTheme } from "../lib/theme";
import { LoginSchema, type LoginValues } from "../schemas/auth";
import { PasswordField } from "../components/ui/PasswordInput";
import toast from "react-hot-toast";

export default function Login() {
  const nav = useNavigate();
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [user, setUser] = useState<any>();

  useEffect(() => {
    getUser();
    console.log("first");
  }, []);

  const getUser = async () => {
    try {
      const res = await api.get("/auth/me");
      setUser(res.data.employee);
    } catch (error) {}
  };

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: "", password: "" },
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  const onSubmit = async (data: LoginValues) => {
    setGeneralError(null);
    try {
      const res = await api.post("/auth/login", data);
      setAuth(res.data.token, res.data.employee);

      // theme (non-blocking)
      try {
        const t = await api.get("/companies/theme");
        if (t?.data?.theme) applyTheme(t.data.theme);
      } catch {}

      // role-based redirect
      const role = res.data.employee?.primaryRole;
      if (role === "SUPERADMIN") nav("/superadmin");
      else if (role === "ADMIN") nav("/admin");
      else nav("/app");
    } catch (e: any) {
      setGeneralError(e?.response?.data?.error || "Login failed");
    }
  };

  console.log("dhscds", user);
  if (user?.primaryRole === "ADMIN") return <Navigate to="/admin" replace />;
  if (user?.primaryRole) return <Navigate to="/app" replace />;

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-bg text-text">
      {/* Hero */}
      <header className="sticky top-0 z-30 bg-surface/70 backdrop-blur border-b border-border">
        <div className="mx-auto max-w-6xl px-4 h-16 flex items-center justify-between">
          <Link to="/" className="text-xl font-extrabold tracking-wide">
            <img src="/peracto_logo.png" className="w-[170px]" />
          </Link>
        </div>
      </header>
      <div className="flex items-center justify-center mt-20">
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="bg-surface p-6 rounded-lg border border-border shadow w-full max-w-sm space-y-4"
        >
          <h1 className="text-xl font-semibold">Sign in</h1>

          {generalError && (
            <div className="rounded-md border border-error/20 bg-error/10 px-3 py-2 text-sm text-error">
              {generalError}
            </div>
          )}

          <div className="space-y-1">
            <label className="text-sm required-label">Email</label>
            <input
              type="email"
              className="w-full border border-border bg-bg rounded px-3 h-10 outline-none focus:ring-2 focus:ring-primary"
              {...register("email")}
            />
            {errors.email && (
              <p className="text-xs text-error mt-1">{errors.email.message}</p>
            )}
          </div>

          <div className="space-y-1">
            <PasswordField
              label="Password"
              registration={register("password")}
              error={errors.password}
            />
          </div>

          <button
            disabled={isSubmitting}
            className="w-full h-10 rounded bg-primary text-white disabled:opacity-60"
          >
            {isSubmitting ? "..." : "Login"}
          </button>

          <div className="text-right text-sm">
            <Link
              className="text-primary hover:underline"
              to="/forgot-password"
            >
              Forgot password?
            </Link>
          </div>

          <p className="text-xs text-muted text-center">
            Don't have an account?{" "}
            <Link to="/register-company" className="underline">
              Register
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
