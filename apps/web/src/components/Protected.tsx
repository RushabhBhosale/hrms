import { Navigate, useLocation } from 'react-router-dom';
import { getUser } from '../lib/auth';

export default function Protected({ children }: { children: React.ReactNode }) {
  const user = getUser();
  const loc = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: loc }} replace />;
  return <>{children}</>;
}
