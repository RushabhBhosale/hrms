export function RoleBadge({ role }: { role?: string }) {
  const label = (role || "employee").toLowerCase();
  const tone =
    label === "manager"
      ? "bg-secondary/10 text-secondary"
      : label === "hr"
      ? "bg-accent/10 text-accent"
      : "bg-primary/10 text-primary";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}
    >
      {label.charAt(0).toUpperCase() + label.slice(1)}
    </span>
  );
}
