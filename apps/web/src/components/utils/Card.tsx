export function Card({
  icon,
  title,
  value,
  tone = "primary",
}: {
  icon: React.ReactNode;
  title: string;
  value: number;
  tone?: "primary" | "secondary" | "accent";
}) {
  const tones: Record<string, string> = {
    primary: "bg-primary/10 text-primary",
    secondary: "bg-secondary/10 text-secondary",
    accent: "bg-accent/10 text-accent",
  };

  return (
    <div className="rounded-xl border border-border bg-surface p-6 shadow-sm flex items-center gap-4">
      <div
        className={`flex h-12 w-12 items-center justify-center rounded-full ${tones[tone]}`}
      >
        {icon}
      </div>
      <div className="space-y-1">
        <div className="text-sm text-muted-foreground">{title}</div>
        <div className="text-2xl font-semibold">{value}</div>
      </div>
    </div>
  );
}
