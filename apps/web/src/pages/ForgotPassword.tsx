import { FormEvent, useState } from "react";
import { api } from "../lib/api";
import { Link, useNavigate } from "react-router-dom";

export default function ForgotPassword() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [ok, setOk] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setOk("");
    setErr("");
    setLoading(true);
    try {
      await api.post("/auth/request-password-reset", { email });
      setOk("If that email exists, we sent an OTP.");
      // small delay to show confirmation, then go to OTP screen
      setTimeout(
        () => nav(`/reset-password?email=${encodeURIComponent(email)}`),
        500
      );
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to request reset");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-gray-50">
      <form
        onSubmit={onSubmit}
        className="bg-white p-6 rounded-lg shadow w-full max-w-sm space-y-4"
      >
        <h1 className="text-xl font-semibold">Forgot password</h1>
        {ok && <div className="text-success text-sm">{ok}</div>}
        {err && <div className="text-error text-sm">{err}</div>}
        <div className="space-y-1">
          <label className="text-sm required-label">Work email</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border rounded px-3 h-10"
            type="email"
            placeholder="you@company.com"
          />
        </div>
        <button
          disabled={loading}
          className="w-full h-10 rounded bg-black text-white"
        >
          {loading ? "..." : "Send OTP"}
        </button>
        <div className="text-sm text-center">
          <Link className="text-primary hover:underline" to="/reset-password">
            Have an OTP? Reset here
          </Link>
        </div>
        <div className="text-xs text-center text-gray-500">
          <Link to="/login" className="hover:underline">
            Back to login
          </Link>
        </div>
      </form>
    </div>
  );
}
