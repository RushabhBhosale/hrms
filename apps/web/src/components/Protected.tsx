import { Navigate, useLocation } from "react-router-dom";
import { getEmployee } from "../lib/auth";

export default function Protected({ children }: { children: React.ReactNode }) {
  const employee = getEmployee();
  const loc = useLocation();
  if (!employee) return <Navigate to="/login" state={{ from: loc }} replace />;
  return <>{children}</>;
}
