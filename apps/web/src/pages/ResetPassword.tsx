import { FormEvent, useEffect, useState } from "react";
import { api } from "../lib/api";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../components/ui/button";

export default function ResetPassword() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [step, setStep] = useState<"otp" | "new">("otp");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = sp.get("email");
    if (q) setEmail(q);
  }, [sp]);

  async function verifyOtp(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setOk("");
    setLoading(true);
    try {
      const res = await api.post("/auth/verify-reset-otp", { email, otp });
      setResetToken(res.data.resetToken);
      setStep("new");
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Invalid or expired OTP");
    } finally {
      setLoading(false);
    }
  }

  async function setNewPassword(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setOk("");
    if (password !== confirm) {
      setErr("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      await api.post("/auth/complete-password-reset", {
        resetToken,
        newPassword: password,
      });
      setOk("Password reset successful. Redirecting to login...");
      setTimeout(() => nav("/login"), 1200);
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to reset password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-bg">
      {step === "otp" ? (
        <form
          onSubmit={verifyOtp}
          className="bg-surface p-6 rounded-lg border border-border shadow w-full max-w-sm space-y-4"
        >
          <h1 className="text-xl font-semibold">Verify OTP</h1>
          {ok && <div className="text-success text-sm">{ok}</div>}
          {err && <div className="text-error text-sm">{err}</div>}
          <div className="space-y-1">
            <label className="text-sm required-label">Work email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-border bg-bg rounded px-3 h-10 outline-none focus:ring-2 focus:ring-primary"
              type="email"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm required-label">OTP</label>
            <input
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              className="w-full border border-border bg-bg rounded px-3 h-10 outline-none focus:ring-2 focus:ring-primary"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              placeholder="6-digit code"
            />
          </div>
          <Button disabled={loading} className="w-full h-10">
            {loading ? "..." : "Verify"}
          </Button>
          <div className="text-sm text-center">
            <Button asChild variant="outline" className="w-full justify-center">
              <Link to={`/forgot-password`}>Resend OTP</Link>
            </Button>
          </div>
          <div className="text-xs text-center text-muted-foreground">
            <Button asChild variant="outline" className="w-full justify-center">
              <Link to="/login">Back to login</Link>
            </Button>
          </div>
        </form>
      ) : (
        <form
          onSubmit={setNewPassword}
          className="bg-surface p-6 rounded-lg border border-border shadow w-full max-w-sm space-y-4"
        >
          <h1 className="text-xl font-semibold">Set new password</h1>
          {ok && <div className="text-success text-sm">{ok}</div>}
          {err && <div className="text-error text-sm">{err}</div>}
          <div className="space-y-1">
            <label className="text-sm required-label">New password</label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-border bg-bg rounded px-3 h-10 outline-none focus:ring-2 focus:ring-primary"
              type="password"
              minLength={8}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm required-label">Confirm password</label>
            <input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full border border-border bg-bg rounded px-3 h-10 outline-none focus:ring-2 focus:ring-primary"
              type="password"
              minLength={8}
            />
          </div>
          <Button disabled={loading} className="w-full h-10">
            {loading ? "..." : "Reset password"}
          </Button>
          <div className="text-xs text-center text-muted-foreground">
            <Button
              type="button"
              variant="outline"
              className="w-full justify-center"
              onClick={() => setStep("otp")}
            >
              Back to OTP
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
