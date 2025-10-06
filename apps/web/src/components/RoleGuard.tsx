import { ReactNode } from 'react';
import { getEmployee, hasPermission } from '../lib/auth';
import type { PrimaryRole, SubRole } from '../lib/auth';

type PermissionRequirement = {
  module: string;
  action?: string;
  actions?: string[];
};

export default function RoleGuard({
  primary,
  sub,
  permission,
  children,
}: {
  primary?: PrimaryRole[];
  sub?: SubRole[];
  permission?: PermissionRequirement;
  children: ReactNode;
}) {
  const u = getEmployee();
  if (!u) return null;
  if (primary && !primary.includes(u.primaryRole)) return null;
  if (sub && !u.subRoles.some(r => sub.includes(r))) return null;
  if (permission) {
    const actions = permission.actions && permission.actions.length > 0
      ? permission.actions
      : [permission.action || 'read'];
    const allowed = actions.every((action) => hasPermission(u, permission.module, action));
    if (!allowed) return null;
  }
  return <>{children}</>;
}
