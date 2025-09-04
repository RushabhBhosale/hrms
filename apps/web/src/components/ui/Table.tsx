import React from "react";

export function Th({
  children,
  sortable,
  onSort,
  dir,
}: {
  children: React.ReactNode;
  sortable?: boolean;
  onSort?: () => void;
  dir?: "asc" | "desc" | null;
}) {
  const content = (
    <div className="inline-flex items-center gap-1 select-none">
      <span>{children}</span>
      {sortable ? (
        <span className="text-muted text-[10px] leading-none">
          {dir === "asc" ? "▲" : dir === "desc" ? "▼" : "↕"}
        </span>
      ) : null}
    </div>
  );
  if (sortable && onSort) {
    return (
      <th
        className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted cursor-pointer hover:text-text"
        onClick={onSort}
      >
        {content}
      </th>
    );
  }
  return (
    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted">
      {content}
    </th>
  );
}

export function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={["px-4 py-3 align-middle", className || ""].join(" ")}>
      {children}
    </td>
  );
}

export function SkeletonRows({ rows, cols }: { rows: number; cols: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-t border-border/70">
          {Array.from({ length: cols }).map((__, c) => (
            <td key={c} className="px-4 py-3">
              <div className="h-4 w-40 bg-bg rounded animate-pulse" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function Pagination({
  page,
  pages,
  onFirst,
  onPrev,
  onNext,
  onLast,
  disabled,
}: {
  page: number;
  pages: number;
  onFirst: () => void;
  onPrev: () => void;
  onNext: () => void;
  onLast: () => void;
  disabled?: boolean;
}) {
  const btn =
    "h-9 px-3 rounded-md bg-surface border border-border text-sm hover:bg-bg disabled:opacity-50";
  return (
    <div className="flex items-center gap-2">
      <button
        className={btn}
        onClick={onFirst}
        disabled={page === 1 || disabled}
      >
        First
      </button>
      <button
        className={btn}
        onClick={onPrev}
        disabled={page === 1 || disabled}
      >
        Prev
      </button>
      <div className="text-sm text-muted">
        Page {page} of {Math.max(1, pages)}
      </div>
      <button
        className={btn}
        onClick={onNext}
        disabled={page >= pages || disabled}
      >
        Next
      </button>
      <button
        className={btn}
        onClick={onLast}
        disabled={page >= pages || disabled}
      >
        Last
      </button>
    </div>
  );
}
