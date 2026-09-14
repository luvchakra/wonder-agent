"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { TableContainer, Thead, Th, Td, Tr } from "./Table";
import { Button } from "./Button";
import { EmptyState, TableSkeleton } from "./States";

export type SortDir = "asc" | "desc";

export type TableState = {
  page: number;
  pageSize: number;
  sortKey: string | null;
  sortDir: SortDir;
  filter: string;
  setPage: (page: number) => void;
  setSort: (key: string) => void;
  setFilter: (value: string) => void;
};

/**
 * EXPERIENCE-P0-08 — saved-URL-state for sort/filter/page, namespaced by
 * `paramPrefix` so more than one DataTable can live on the same page
 * without colliding. This hook only manages *state in the URL*; the
 * calling Server Component page is the one that reads these values (via
 * `searchParams`) and does the actual `limit`/`offset` (or keyset) query,
 * per CLAUDE.md §15 — no client-side-only pagination over a full table.
 */
export function useTableState(paramPrefix: string, defaults: { pageSize?: number; sortKey?: string | null; sortDir?: SortDir } = {}): TableState {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const page = Number(searchParams.get(`${paramPrefix}_page`) ?? "1") || 1;
  const pageSize = Number(searchParams.get(`${paramPrefix}_pageSize`) ?? String(defaults.pageSize ?? 25)) || 25;
  const sortKey = searchParams.get(`${paramPrefix}_sort`) ?? defaults.sortKey ?? null;
  const sortDir = (searchParams.get(`${paramPrefix}_dir`) as SortDir | null) ?? defaults.sortDir ?? "asc";
  const filter = searchParams.get(`${paramPrefix}_q`) ?? "";

  const update = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(`${paramPrefix}_${key}`);
        else next.set(`${paramPrefix}_${key}`, value);
      }
      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams, paramPrefix],
  );

  return {
    page,
    pageSize,
    sortKey,
    sortDir,
    filter,
    setPage: (p) => update({ page: String(p) }),
    setSort: (key) =>
      update(
        sortKey === key
          ? { sort: key, dir: sortDir === "asc" ? "desc" : "asc" }
          : { sort: key, dir: "asc" },
      ),
    setFilter: (value) => update({ q: value || null, page: "1" }),
  };
}

export type DataTableColumn<T> = {
  key: string;
  header: string;
  sortable?: boolean;
  render: (row: T) => React.ReactNode;
  /** Rendered in the narrow-viewport card transform's label position; defaults to `header`. */
  cardLabel?: string;
};

/**
 * EXPERIENCE-P0-08. A shared sortable/filterable/paginated table with a
 * responsive card-transform below `sm` — the table itself is hidden and
 * each row renders as a labelled key/value card instead, per
 * docs/design/UI-UX-DESIGN-RULES.md's per-breakpoint layout guidance
 * (never just a shrunk desktop table). Domain screens (Agent Inventory,
 * Access, Findings, etc.) pass their own columns/rows; pagination/sort/
 * filter state comes from `useTableState()` above, and totalCount/loading
 * come from the calling page's own server-side query.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowId,
  totalCount,
  state,
  loading = false,
  emptyTitle = "Nothing to show",
  emptyDescription,
  filterPlaceholder = "Filter…",
  onRowClick,
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  totalCount: number;
  state: TableState;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  filterPlaceholder?: string;
  onRowClick?: (row: T) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / state.pageSize));

  const rangeStart = totalCount === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
  const rangeEnd = Math.min(state.page * state.pageSize, totalCount);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <input
          type="search"
          value={state.filter}
          onChange={(e) => state.setFilter(e.target.value)}
          placeholder={filterPlaceholder}
          aria-label={filterPlaceholder}
          className="w-full max-w-xs rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        />
        <p className="text-xs text-text-muted">
          {totalCount === 0 ? "0 results" : `${rangeStart}-${rangeEnd} of ${totalCount}`}
        </p>
      </div>

      {loading ? (
        <TableSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <>
          {/* Desktop/tablet: real table, sm+ only. */}
          <div className="hidden sm:block">
            <TableContainer>
              <Thead>
                <tr>
                  {columns.map((col) => (
                    <Th
                      key={col.key}
                      aria-sort={col.sortable ? (state.sortKey === col.key ? (state.sortDir === "asc" ? "ascending" : "descending") : "none") : undefined}
                    >
                      {col.sortable ? (
                        <button
                          type="button"
                          onClick={() => state.setSort(col.key)}
                          className="inline-flex items-center gap-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                        >
                          {col.header}
                          {state.sortKey === col.key && <span aria-hidden>{state.sortDir === "asc" ? "▲" : "▼"}</span>}
                        </button>
                      ) : (
                        col.header
                      )}
                    </Th>
                  ))}
                </tr>
              </Thead>
              <tbody>
                {rows.map((row) => (
                  <Tr key={getRowId(row)}>
                    {columns.map((col) => (
                      <Td key={col.key}>
                        {onRowClick ? (
                          <button
                            type="button"
                            onClick={() => onRowClick(row)}
                            className="text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                          >
                            {col.render(row)}
                          </button>
                        ) : (
                          col.render(row)
                        )}
                      </Td>
                    ))}
                  </Tr>
                ))}
              </tbody>
            </TableContainer>
          </div>

          {/* Narrow viewports: card-transform, below sm only. */}
          <ul className="space-y-2 sm:hidden">
            {rows.map((row) => (
              <li key={getRowId(row)}>
                <button
                  type="button"
                  onClick={() => onRowClick?.(row)}
                  disabled={!onRowClick}
                  className="w-full rounded-lg border border-border bg-surface p-3 text-left shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default"
                >
                  <dl className="space-y-1">
                    {columns.map((col) => (
                      <div key={col.key} className="flex items-baseline justify-between gap-3 text-sm">
                        <dt className="shrink-0 text-xs font-medium uppercase tracking-wide text-text-muted">{col.cardLabel ?? col.header}</dt>
                        <dd className="text-right text-text-primary">{col.render(row)}</dd>
                      </div>
                    ))}
                  </dl>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {totalPages > 1 && (
        <nav className="flex items-center justify-between gap-2" aria-label="Pagination">
          <Button variant="ghost" onClick={() => state.setPage(state.page - 1)} disabled={state.page <= 1}>
            Previous
          </Button>
          <p className="text-xs text-text-muted">
            Page {state.page} of {totalPages}
          </p>
          <Button variant="ghost" onClick={() => state.setPage(state.page + 1)} disabled={state.page >= totalPages}>
            Next
          </Button>
        </nav>
      )}
    </div>
  );
}

/** Client-side helper for pages that haven't wired server-side filtering yet — filters an already-fetched page of rows by a simple substring match. Prefer server-side filtering per CLAUDE.md §15 where the underlying query supports it. */
export function useClientFilteredRows<T>(rows: T[], filter: string, getSearchableText: (row: T) => string): T[] {
  return useMemo(() => {
    if (!filter.trim()) return rows;
    const needle = filter.trim().toLowerCase();
    return rows.filter((r) => getSearchableText(r).toLowerCase().includes(needle));
  }, [rows, filter, getSearchableText]);
}
