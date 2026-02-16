import { ReactNode } from "react";
import { hasPermission } from "../lib/auth";
import { useCurrentEmployee } from "../hooks/useCurrentEmployee";
import type { PrimaryRole, SubRole } from "../lib/auth";

type PermissionRequirement = {
  module: string;
  action?: string;
  actions?: string[];
};

export default function RoleGuard({
  primary,
  sub,
  permission,
  fallback,
  children,
}: {
  primary?: PrimaryRole[];
  sub?: SubRole[];
  permission?: PermissionRequirement;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const { employee: u } = useCurrentEmployee();
  const fallbackNode = fallback ?? null;
  if (!u) return fallbackNode;
  if (primary && !primary.includes(u.primaryRole)) return fallbackNode;
  if (sub && !u.subRoles.some((r) => sub.includes(r))) return fallbackNode;
  if (permission) {
    const actions =
      permission.actions && permission.actions.length > 0
        ? permission.actions
        : [permission.action || "read"];
    const allowed = actions.every((action) =>
      hasPermission(u, permission.module, action)
    );
    if (!allowed) return fallbackNode;
  }
  return <>{children}</>;
}
