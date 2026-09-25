"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { TableContainer, Thead, Th, Td, Tr, type HideBelow } from "./Table";
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
  /** Column priority: drop this column below the breakpoint instead of scrolling sideways. */
  hideBelow?: HideBelow;
};

/**
 * EXPERIENCE-P0-08, UX-P0-07/08 (12_ADVANCED_PRODUCT_UX_REQUIREMENTS.md
 * §10-11). A shared sortable/filterable/paginated table with a responsive
 * card-transform below `md` — the table itself is hidden and each row
 * renders as a labelled key/value card instead, per docs/design/UI-UX-
 * DESIGN-RULES.md's per-breakpoint layout guidance (never just a shrunk
 * desktop table, never horizontal scroll for critical data). Domain
 * screens (Agent Inventory, Access, Findings, etc.) pass their own
 * columns/rows; pagination/sort/filter state comes from `useTableState()`
 * above, and totalCount/loading come from the calling page's own
 * server-side query. Row selection/bulk actions/column visibility/density
 * are not yet implemented — flagged as open UX-008 scope, not silently
 * dropped.
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
  renderCard,
  toolbar,
  bare = false,
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
  /**
   * Below `md`, render each row as this instead of the generic
   * label/value card. A screen whose design has a real mobile row — an
   * avatar, a title, a subtitle and a status — should supply it here:
   * the generic transform turns that into a stack of
   * "AGENT / LIFECYCLE / CRITICALITY" pairs, which is legible but reads
   * as a debug dump rather than a designed list.
   */
  renderCard?: (row: T) => React.ReactNode;
  /** Extra filters/actions shown beside the search box (selects, an export link). */
  toolbar?: React.ReactNode;
  /** The table already sits inside a card: drop its own outline. */
  bare?: boolean;
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / state.pageSize));

  const rangeStart = totalCount === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
  const rangeEnd = Math.min(state.page * state.pageSize, totalCount);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <input
            type="search"
            value={state.filter}
            onChange={(e) => state.setFilter(e.target.value)}
            placeholder={filterPlaceholder}
            aria-label={filterPlaceholder}
            className="h-9 w-full max-w-xs rounded-lg border border-border bg-card px-3 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          />
          {toolbar}
        </div>
        <p className="text-xs text-muted-foreground">
          {totalCount === 0 ? "0 results" : `${rangeStart}-${rangeEnd} of ${totalCount}`}
        </p>
      </div>

      {loading ? (
        <TableSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <>
          {/* Desktop/tablet: real table, md+ only. */}
          <div className="hidden md:block">
            <TableContainer bare={bare}>
              <Thead>
                <tr>
                  {columns.map((col) => (
                    <Th
                      key={col.key}
                      hideBelow={col.hideBelow}
                      aria-sort={col.sortable ? (state.sortKey === col.key ? (state.sortDir === "asc" ? "ascending" : "descending") : "none") : undefined}
                    >
                      {col.sortable ? (
                        <button
                          type="button"
                          onClick={() => state.setSort(col.key)}
                          className="inline-flex items-center gap-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
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
                      <Td key={col.key} hideBelow={col.hideBelow}>
                        {onRowClick ? (
                          <button
                            type="button"
                            onClick={() => onRowClick(row)}
                            className="text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
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

          {/* Narrow viewports: card-transform, below md only. */}
          {renderCard ? (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border/60 bg-card shadow-md md:hidden">
              {rows.map((row) => (
                <li key={getRowId(row)}>{renderCard(row)}</li>
              ))}
            </ul>
          ) : (
            <ul className="space-y-2 md:hidden">
              {rows.map((row) => (
                <li key={getRowId(row)}>
                  <button
                    type="button"
                    onClick={() => onRowClick?.(row)}
                    disabled={!onRowClick}
                    className="w-full rounded-lg border border-border bg-background p-3 text-left shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default"
                  >
                    <dl className="space-y-1">
                      {columns.map((col) => (
                        <div key={col.key} className="flex items-baseline justify-between gap-3 text-sm">
                          <dt className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">{col.cardLabel ?? col.header}</dt>
                          <dd className="text-right text-foreground">{col.render(row)}</dd>
                        </div>
                      ))}
                    </dl>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {totalPages > 1 && (
        <nav className="flex items-center justify-between gap-2" aria-label="Pagination">
          <Button variant="ghost" onClick={() => state.setPage(state.page - 1)} disabled={state.page <= 1}>
            Previous
          </Button>
          <p className="text-xs text-muted-foreground">
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

/**
 * EXPERIENCE-P0-08 rollout helper — the same client-side sort/filter/
 * paginate-over-an-already-fetched-list pattern `AgentsTable` established,
 * generalized so each new list screen only supplies its columns and a
 * `getSearchableText`/`getSortValue` pair rather than re-deriving the
 * filter/sort/slice boilerplate per page. Still a documented stopgap per
 * CLAUDE.md §15 (client-side over the full list) wherever the underlying
 * `list*()` contract has no server-side pagination yet — same caveat as
 * `AgentsTable`'s own comment, not a new limitation.
 */
export function SimpleDataTable<T>({
  rows,
  columns,
  getRowId,
  getSearchableText,
  getSortValue,
  paramPrefix,
  defaultSortKey,
  emptyTitle,
  emptyDescription,
  filterPlaceholder = "Filter…",
  onRowClick,
  renderCard,
}: {
  rows: T[];
  columns: DataTableColumn<T>[];
  getRowId: (row: T) => string;
  getSearchableText: (row: T) => string;
  getSortValue?: (row: T, key: string) => string | number;
  paramPrefix: string;
  defaultSortKey?: string;
  emptyTitle: string;
  emptyDescription?: string;
  filterPlaceholder?: string;
  onRowClick?: (row: T) => void;
  /**
   * Below `md`, render each row as this instead of the generic
   * label/value card. A screen whose design has a real mobile row — an
   * avatar, a title, a subtitle and a status — should supply it here:
   * the generic transform turns that into a stack of
   * "AGENT / LIFECYCLE / CRITICALITY" pairs, which is legible but reads
   * as a debug dump rather than a designed list.
   */
  renderCard?: (row: T) => React.ReactNode;
}) {
  const state = useTableState(paramPrefix, { sortKey: defaultSortKey ?? null, pageSize: 25 });
  const filtered = useClientFilteredRows(rows, state.filter, getSearchableText);

  const sorted = useMemo(() => {
    if (!state.sortKey || !getSortValue) return filtered;
    const dir = state.sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = getSortValue(a, state.sortKey!);
      const bv = getSortValue(b, state.sortKey!);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [filtered, state.sortKey, state.sortDir, getSortValue]);

  const pageRows = sorted.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);

  return (
    <DataTable
      columns={columns}
      rows={pageRows}
      getRowId={getRowId}
      totalCount={sorted.length}
      state={state}
      emptyTitle={emptyTitle}
      emptyDescription={emptyDescription}
      filterPlaceholder={filterPlaceholder}
      onRowClick={onRowClick}
      renderCard={renderCard}
    />
  );
}
