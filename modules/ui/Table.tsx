import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The shared table primitive. Above `md` it is a real table; below `md`
 * each row stacks into a labelled card, because
 * docs/design/UI-UX-DESIGN-RULES.md's table section forbids horizontal
 * scrolling for critical data — and a five-column audit table on a phone
 * is exactly that.
 *
 * The labels come from the table's own `<Th>` cells, injected into each
 * `<Td>` as `data-label` by `TableContainer` below, so callers keep
 * writing a plain table and get the responsive behaviour for free. That
 * matters here: twelve tables across eleven screens owned by seven
 * different module agents share this primitive, and fixing it once beats
 * eleven parallel rewrites.
 *
 * When the head is hidden the `<th>`/`<td>` association is gone, so the
 * stacked layout renders the label as real text next to the value rather
 * than relying on a CSS `content:` string a screen reader may skip.
 */

/** The visible text of an arbitrary node, for use as a column label. */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

/** The label of each column, read from the first row of the table head. */
function columnLabels(head: ReactNode): string[] {
  const headRow = Children.toArray((head as ReactElement<{ children?: ReactNode }>)?.props?.children).find(isValidElement);
  if (!headRow) return [];
  return Children.toArray((headRow.props as { children?: ReactNode }).children)
    .filter(isValidElement)
    .map((cell) => textOf((cell.props as { children?: ReactNode }).children).trim());
}

/** Clones a `<tbody>`, tagging every cell with the label of its column. */
function labelBody(body: ReactElement<{ children?: ReactNode; className?: string }>, labels: string[]): ReactElement {
  const rows = Children.toArray(body.props.children).map((row) => {
    if (!isValidElement(row)) return row;
    const rowElement = row as ReactElement<{ children?: ReactNode }>;
    const cells = Children.toArray(rowElement.props.children).map((cell, index) =>
      isValidElement(cell) ? cloneElement(cell as ReactElement<Record<string, unknown>>, { "data-label": labels[index] ?? "" }) : cell,
    );
    return cloneElement(rowElement, undefined, cells);
  });
  return cloneElement(body, { className: cn("block md:table-row-group", body.props.className) }, rows);
}

export function TableContainer({
  children,
  label = "Table",
  bare = false,
}: {
  children: ReactNode;
  label?: string;
  /** Drop the outline, for a table that already sits inside a card. */
  bare?: boolean;
}) {
  const items = Children.toArray(children);
  const head = items.find((item) => isValidElement(item) && item.type === Thead);
  const labels = head ? columnLabels(head) : [];

  const content = items.map((item) => {
    if (isValidElement(item) && item.type === "tbody" && labels.length > 0) {
      return labelBody(item as ReactElement<{ children?: ReactNode; className?: string }>, labels);
    }
    return item;
  });

  return (
    // `overflow-x-auto` only ever engages from `md` up, where the table is
    // a real table; the region is named and focusable so a keyboard user
    // can reach and scroll it there instead of it being pointer-only.
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn(
        "overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
        bare ? "rounded-md" : "rounded-2xl border border-border",
      )}
    >
      <table className="block w-full min-w-full text-left text-sm md:table">{content}</table>
    </div>
  );
}

export function Thead({ children }: { children: ReactNode }) {
  return (
    <thead className="hidden border-b border-border bg-muted/60 text-xs text-muted-foreground md:table-header-group">
      {children}
    </thead>
  );
}

export function Th({ children, className, ...rest }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className={cn("px-4 py-2 font-medium whitespace-nowrap", className)} {...rest}>
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
  ...rest
}: { children: ReactNode; className?: string } & React.TdHTMLAttributes<HTMLTableCellElement>) {
  const label = (rest as { "data-label"?: string })["data-label"];
  return (
    <td
      className={cn(
        "flex items-baseline justify-between gap-4 px-4 py-1.5 text-foreground",
        // A stacked cell can hold a form control, not just text. A select
        // sitting in a nowrap flex row will not shrink below the width of
        // its longest option, so it pushes the row past the edge of a
        // phone — exactly what the sideways scroll this layout replaces
        // used to hide. `min-w-0` lets it shrink; `max-w-full` stops it
        // outgrowing the cell.
        "[&_input]:min-w-0 [&_input]:max-w-full [&_select]:min-w-0 [&_select]:max-w-full",
        "md:table-cell md:py-2",
        className,
      )}
      {...rest}
    >
      {label ? (
        <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground md:hidden">
          {label}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 text-right md:contents md:text-left">{children}</span>
    </td>
  );
}

export function Tr({ children }: { children: ReactNode }) {
  return (
    <tr
      className={cn(
        // Below `md` a row is a card: its own block with padding and a
        // separating rule. From `md` it is an ordinary table row again.
        "block border-b border-border py-2 last:border-0 md:table-row md:py-0",
        "hover:bg-muted/60",
      )}
    >
      {children}
    </tr>
  );
}
