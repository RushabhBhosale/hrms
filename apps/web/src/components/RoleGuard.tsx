import { ReactNode } from 'react';
import { getEmployee } from '../lib/auth';
import type { PrimaryRole, SubRole } from '../lib/auth';

export default function RoleGuard({ primary, sub, children }: { primary?: PrimaryRole[]; sub?: SubRole[]; children: ReactNode }) {
  const u = getEmployee();
  if (!u) return null;
  if (primary && !primary.includes(u.primaryRole)) return null;
  if (sub && !u.subRoles.some(r => sub.includes(r))) return null;
  return <>{children}</>;
}
