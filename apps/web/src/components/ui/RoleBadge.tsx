function formatRoleLabel(value?: string) {
  if (!value) return "Employee";
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : ""))
    .join(" ") || "Employee";
}

export function RoleBadge({ role, label }: { role?: string; label?: string }) {
  const toneKey = (role || "").toLowerCase();
  const tone =
    toneKey === "manager"
      ? "bg-secondary/10 text-secondary"
      : toneKey === "hr"
      ? "bg-accent/10 text-accent"
      : "bg-primary/10 text-primary";
  const display = label || formatRoleLabel(role);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}
    >
      {display}
    </span>
  );
}
