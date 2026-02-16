import React from "react";
import { Button } from "../ui/button";

export function Th({
  children,
  sortable,
  onSort,
  dir,
  className,
}: {
  children: React.ReactNode;
  sortable?: boolean;
  onSort?: () => void;
  dir?: "asc" | "desc" | null;
  className?: string;
}) {
  const content = (
    <div className="inline-flex items-center gap-1 select-none whitespace-nowrap">
      <span>{children}</span>
      {sortable ? (
        <span className="text-muted-foreground text-[10px] leading-none">
          {dir === "asc" ? "▲" : dir === "desc" ? "▼" : "↕"}
        </span>
      ) : null}
    </div>
  );

  const base =
    "px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground";

  if (sortable && onSort) {
    return (
      <th
        className={[
          base,
          "cursor-pointer hover:text-text",
          className || "",
        ].join(" ")}
        onClick={onSort}
      >
        {content}
      </th>
    );
  }

  return <th className={[base, className || ""].join(" ")}>{content}</th>;
}

type TdProps = React.TdHTMLAttributes<HTMLTableDataCellElement> & {
  className?: string;
  children?: React.ReactNode;
};

export function Td({ children, className, ...rest }: TdProps) {
  return (
    <td
      className={["px-4 py-3 align-middle", className || ""].join(" ")}
      {...rest}
    >
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
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={onFirst}
        disabled={page === 1 || disabled}
      >
        First
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onPrev}
        disabled={page === 1 || disabled}
      >
        Prev
      </Button>
      <div className="text-sm text-muted-foreground">
        Page {page} of {Math.max(1, pages)}
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onNext}
        disabled={page >= pages || disabled}
      >
        Next
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onLast}
        disabled={page >= pages || disabled}
      >
        Last
      </Button>
    </div>
  );
}

export function PaginationFooter({
  page,
  pages,
  onFirst,
  onPrev,
  onNext,
  onLast,
  disabled,
  className,
}: {
  page: number;
  pages: number;
  onFirst: () => void;
  onPrev: () => void;
  onNext: () => void;
  onLast: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      className={[
        "flex flex-wrap items-center justify-between gap-3",
        className || "",
      ].join(" ")}
    >
      <div className="text-sm text-muted-foreground">
        Page {page} of {Math.max(1, pages)}
      </div>
      <Pagination
        page={page}
        pages={pages}
        onFirst={onFirst}
        onPrev={onPrev}
        onNext={onNext}
        onLast={onLast}
        disabled={disabled}
      />
    </div>
  );
}
