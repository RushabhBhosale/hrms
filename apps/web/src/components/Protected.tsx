import { Navigate, useLocation } from "react-router-dom";
import { useCurrentEmployee } from "../hooks/useCurrentEmployee";

export default function Protected({ children }: { children: React.ReactNode }) {
  const { employee } = useCurrentEmployee({
    refreshOnMount: true,
    refreshOnFocus: true,
    refreshIntervalMs: 60000,
  });
  const loc = useLocation();
  if (!employee) return <Navigate to="/login" state={{ from: loc }} replace />;
  return <>{children}</>;
}
