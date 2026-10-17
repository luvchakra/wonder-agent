import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { pageRef, resolveRef } from "@/lib/refs/objectRef";
import { ApiError } from "@/lib/shared/types/foundation";
import { Button, Card, EmptyState } from "@/modules/ui";
import { findDuplicatesOf, getIdentity, getIdentityNames, getMergePreview, listIdentities, MERGE_FIELDS, mergeDifferences } from "@/modules/agent-identity/service";
import { DirectorySearch, MergeForm, type MergeRow } from "../../IdentityForms";

// IDENTITY-P0-23 — merge another record of the same person into this one.
// This record survives; for each attribute that differs, the person chooses
// whose value stays. Nothing merges until they confirm.

export default async function MergeIdentityPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ with?: string; q?: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("identity.manage");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const [{ id: rawId }, search] = await Promise.all([params, searchParams]);
  const tenantId = ctx.tenantId!;
  const id = await pageRef(tenantId, "identities", rawId, (n) => `/identities/${n}/merge`, search);
  const identity = await getIdentity(tenantId, id);
  if (!identity) notFound();
  const back = `/identities/${identity.ref ?? identity.id}`;

  const other = search.with ? await resolveRef(tenantId, "identities", search.with) : null;
  const preview = other ? await getMergePreview(tenantId, identity.id, other.id) : null;

  let body: React.ReactNode;
  if (!["HUMAN", "EXTERNAL"].includes(identity.identityType) || identity.mergedIntoIdentityId) {
    body = <EmptyState title="This record cannot take a merge" description="Only an active person's record can keep another record merged into it." />;
  } else if (!preview) {
    const [duplicates, found] = await Promise.all([
      findDuplicatesOf(tenantId, identity),
      search.q?.trim() ? listIdentities(tenantId, { types: [identity.identityType], q: search.q, pageSize: 20 }) : Promise.resolve(null),
    ]);
    const choices = [
      ...duplicates.map((d) => ({ id: d.identity.id, ref: d.identity.ref, name: d.identity.displayName, email: d.identity.email, note: d.reason === "email" ? "Same email" : "Same name" })),
      ...(found?.rows ?? []).filter((r) => r.id !== identity.id && !duplicates.some((d) => d.identity.id === r.id)).map((r) => ({ id: r.id, ref: r.ref, name: r.displayName, email: r.email, note: null })),
    ];
    body = (
      <div className="space-y-4">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <DirectorySearch defaultValue={search.q ?? ""} />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
        {choices.length ? (
          <ul className="divide-y divide-border rounded-lg border border-border" aria-label="Records to merge">
            {choices.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="font-medium text-foreground">{c.name}</span>
                  {c.email ? <span className="text-muted-foreground"> · {c.email}</span> : null}
                  {c.note ? <span className="block text-xs text-muted-foreground">{c.note}</span> : null}
                </span>
                <Link href={`?with=${c.ref ?? c.id}`} className="text-primary hover:underline">
                  Compare
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No likely duplicates" description="No other record has the same email or name. Search for the record to merge." />
        )}
      </div>
    );
  } else if (preview.refusal) {
    body = (
      <p role="alert" className="text-sm text-destructive">
        {preview.refusal}
      </p>
    );
  } else {
    const { survivor, merged, moves } = preview;
    const managers = await getIdentityNames(tenantId, [survivor.managerIdentityId, merged.managerIdentityId].filter(Boolean) as string[]);
    const shown = (f: (typeof MERGE_FIELDS)[number], v: unknown) =>
      v === null || v === undefined || v === "" ? null : f.column === "manager_identity_id" ? (managers.get(String(v))?.displayName ?? "A person") : String(v);
    const rows: MergeRow[] = mergeDifferences(survivor, merged).map((f) => ({ column: f.column, label: f.label, keep: shown(f, survivor[f.key]), other: shown(f, merged[f.key]) }));
    const parts = [
      moves.accounts ? `${moves.accounts} account(s)` : null,
      moves.packages ? `${moves.packages} access package(s)` : null,
      moves.pendingRequests ? `${moves.pendingRequests} pending request(s)` : null,
      moves.openFindings ? `${moves.openFindings} open finding(s)` : null,
      moves.reports ? `${moves.reports} direct report(s)` : null,
      moves.sourceRecords ? `${moves.sourceRecords} source record(s)` : null,
      merged.userId ? "their WonderID sign-in" : null,
    ].filter(Boolean);
    const summary = parts.length ? `Moves ${parts.join(", ")} to this record, and sets the other record inactive.` : "Sets the other record inactive; it has nothing to move.";
    body = (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{summary} History stays with the record it happened to.</p>
        <MergeForm survivorId={survivor.id} mergedId={merged.id} survivorName={survivor.displayName} otherName={merged.displayName} rows={rows} summary={summary} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/identities" className="hover:text-foreground hover:underline">
          Identities
        </Link>
        <span aria-hidden> / </span>
        <Link href={back} className="hover:text-foreground hover:underline">
          {identity.displayName}
        </Link>
        <span aria-hidden> / </span>
        <span className="text-foreground">Merge</span>
      </nav>
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Merge into {identity.displayName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">This record stays. The other record&apos;s access moves here.</p>
      </div>
      <Card className="p-4">{body}</Card>
    </div>
  );
}
