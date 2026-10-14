import { listAdjustments, listAllPrices, listWebhookEvents } from "@/modules/billing/adjustments";
import { listTenants } from "@/modules/platform-admin/service";
import { configuredProviders } from "@/modules/billing/config";
import { formatMoney } from "@/modules/billing/rules";
import { decideAdjustmentAction, requestAdjustmentAction, updatePriceAction } from "@/app/actions/platformBilling";
import { Badge, Button, Card, CardBody, CardHeader, StatusBadge, TableContainer, Td, Th, Thead, Tr, fieldInputClass, fieldLabelClass } from "@/modules/ui";
import { cn } from "@/lib/utils";
import { PageHeading } from "@/app/platform-admin/PageHeading";

// See app/platform-admin/page.tsx for why this is forced.
export const dynamic = "force-dynamic";

const disclosure = "group rounded-xl border border-border/60 bg-card";
const summary = "cursor-pointer px-4 py-3 text-sm font-semibold text-card-foreground";

/**
 * PLATFORM-P1-04 — vendor billing console: provider status, the price
 * catalogue, the maker-checker adjustment queue (refunds, plan overrides,
 * immediate cancellations) and the webhook intake log.
 */
export default async function PlatformBillingPage() {
  const [prices, pending, recent, events, tenants] = await Promise.all([listAllPrices(), listAdjustments({ status: "pending" }), listAdjustments(), listWebhookEvents({ limit: 50 }), listTenants()]);
  const providers = configuredProviders();
  const tenantName = new Map(tenants.map((t) => [t.tenantId, t.name ?? t.tenantId]));

  return (
    <>
      <PageHeading title="Billing">
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone={providers.stripe ? "success" : "neutral"}>Stripe {providers.stripe ? "configured" : "not configured"}</StatusBadge>
          <StatusBadge tone={providers.razorpay ? "success" : "neutral"}>Razorpay {providers.razorpay ? "configured" : "not configured"}</StatusBadge>
        </div>
      </PageHeading>

      <Card>
        <CardHeader
          title={`Awaiting a second approver (${pending.length})`}
          description="Refunds, plan overrides and immediate cancellations need a different platform administrator. Approving executes them."
        />
        {pending.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">Nothing waiting.</p>
        ) : (
          <TableContainer label="Adjustments awaiting approval" bare>
            <Thead>
              <tr>
                <Th>Tenant</Th>
                <Th>Kind</Th>
                <Th>Amount / plan</Th>
                <Th hideBelow="xl">Reason</Th>
                <Th hideBelow="lg">Requested</Th>
                <Th className="text-right">Decision</Th>
              </tr>
            </Thead>
            <tbody>
              {pending.map((a) => (
                <Tr key={a.id}>
                  <Td className="font-medium">{tenantName.get(a.tenantId) ?? a.tenantId}</Td>
                  <Td>{a.kind}</Td>
                  <Td className="tabular-nums">{a.amount && a.currency ? formatMoney(a.amount, a.currency) : (a.targetPlan ?? "—")}</Td>
                  <Td hideBelow="xl" className="text-muted-foreground">
                    {a.reason}
                  </Td>
                  <Td hideBelow="lg" className="text-muted-foreground">
                    {new Date(a.requestedAt).toLocaleString()}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <form action={decideAdjustmentAction.bind(null, a.id, true)} className="flex items-center gap-1.5">
                        <input name="note" placeholder="Note (optional)" aria-label="Note" className={cn(fieldInputClass, "w-36 py-1")} />
                        <Button type="submit" size="sm">
                          Approve &amp; execute
                        </Button>
                      </form>
                      <form action={decideAdjustmentAction.bind(null, a.id, false)}>
                        <Button type="submit" size="sm" variant="ghost">
                          Reject
                        </Button>
                      </form>
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableContainer>
        )}
      </Card>

      <details className={disclosure}>
        <summary className={summary}>Request an adjustment</summary>
        <CardBody className="border-t border-border">
          <form action={requestAdjustmentAction} className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="adj-tenant" className={fieldLabelClass}>
                Tenant
              </label>
              <select id="adj-tenant" name="tenantId" required defaultValue="" className={fieldInputClass}>
                <option value="" disabled>
                  Choose…
                </option>
                {tenants.map((t) => (
                  <option key={t.tenantId} value={t.tenantId}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="adj-kind" className={fieldLabelClass}>
                Kind
              </label>
              <select id="adj-kind" name="kind" required defaultValue="refund" className={fieldInputClass}>
                <option value="refund">Refund (needs invoice id and amount)</option>
                <option value="plan_override">Plan override</option>
                <option value="cancel_immediately">Cancel immediately</option>
              </select>
            </div>
            <div>
              <label htmlFor="adj-invoice" className={fieldLabelClass}>
                Invoice id (refund)
              </label>
              <input id="adj-invoice" name="invoiceId" className={fieldInputClass} />
            </div>
            <div>
              <label htmlFor="adj-amount" className={fieldLabelClass}>
                Refund amount (e.g. 499.00)
              </label>
              <input id="adj-amount" name="amount" inputMode="decimal" className={fieldInputClass} />
            </div>
            <div>
              <label htmlFor="adj-plan" className={fieldLabelClass}>
                Target plan (override)
              </label>
              <select id="adj-plan" name="targetPlan" defaultValue="" className={fieldInputClass}>
                <option value="">—</option>
                <option value="free">Free</option>
                <option value="pro">Pro</option>
                <option value="max">Max</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="adj-reason" className={fieldLabelClass}>
                Reason (kept in the audit trail)
              </label>
              <textarea id="adj-reason" name="reason" required minLength={10} rows={2} placeholder="At least 10 characters" className={fieldInputClass} />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit">Request (a second administrator approves)</Button>
            </div>
          </form>
        </CardBody>
      </details>

      <Card>
        <CardHeader title="Price catalogue" description="Changing an amount unlinks the provider price; the next checkout creates a new one. Existing subscribers keep their price." />
        <TableContainer label="Price catalogue" bare>
          <Thead>
            <tr>
              <Th>Price</Th>
              <Th>Amount</Th>
              <Th hideBelow="lg">Tax</Th>
              <Th hideBelow="lg">Provider link</Th>
              <Th className="text-right">Change</Th>
            </tr>
          </Thead>
          <tbody>
            {prices.map((p) => (
              <Tr key={p.id}>
                <Td className="font-mono text-xs">{p.id}</Td>
                <Td className="tabular-nums">{formatMoney(p.unitAmount, p.currency)}</Td>
                <Td hideBelow="lg" className="text-muted-foreground">
                  {p.taxBehavior}
                </Td>
                <Td hideBelow="lg">
                  <div className="flex gap-1">
                    {p.stripeLinked ? <Badge>Stripe</Badge> : null}
                    {p.razorpayLinked ? <Badge>Razorpay</Badge> : null}
                    {!p.stripeLinked && !p.razorpayLinked ? <span className="text-muted-foreground">—</span> : null}
                  </div>
                </Td>
                <Td>
                  <form action={updatePriceAction.bind(null, p.id)} className="flex items-center justify-end gap-2">
                    <input
                      name="amount"
                      defaultValue={(p.unitAmount / 100).toFixed(2)}
                      inputMode="decimal"
                      aria-label={`${p.id} amount`}
                      className={cn(fieldInputClass, "w-24 py-1 text-right tabular-nums")}
                    />
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                      <input type="checkbox" name="active" defaultChecked={p.active} /> Active
                    </label>
                    <Button type="submit" size="sm" variant="outline">
                      Save
                    </Button>
                  </form>
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableContainer>
      </Card>

      <details className={disclosure}>
        <summary className={summary}>Recent adjustments ({Math.min(recent.length, 50)})</summary>
        <div className="border-t border-border">
          <TableContainer label="Recent adjustments" bare>
            <Thead>
              <tr>
                <Th>Tenant</Th>
                <Th>Kind</Th>
                <Th>Status</Th>
                <Th hideBelow="lg">Provider ref</Th>
                <Th hideBelow="lg">Error</Th>
              </tr>
            </Thead>
            <tbody>
              {recent.slice(0, 50).map((a) => (
                <Tr key={a.id}>
                  <Td>{tenantName.get(a.tenantId) ?? a.tenantId}</Td>
                  <Td>{a.kind}</Td>
                  <Td>{a.status}</Td>
                  <Td hideBelow="lg" className="font-mono text-xs">
                    {a.providerReference ?? "—"}
                  </Td>
                  <Td hideBelow="lg" className="text-destructive">
                    {a.error ?? ""}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableContainer>
        </div>
      </details>

      <details className={disclosure}>
        <summary className={summary}>Webhook intake (latest {events.length})</summary>
        <div className="border-t border-border">
          <TableContainer label="Webhook intake" bare>
            <Thead>
              <tr>
                <Th>Received</Th>
                <Th>Provider</Th>
                <Th>Event</Th>
                <Th hideBelow="lg">Tenant</Th>
                <Th>Status</Th>
                <Th hideBelow="xl">Attempts</Th>
                <Th hideBelow="xl">Error</Th>
              </tr>
            </Thead>
            <tbody>
              {events.map((e) => (
                <Tr key={e.id}>
                  <Td className="text-muted-foreground">{new Date(e.receivedAt).toLocaleString()}</Td>
                  <Td>{e.provider}</Td>
                  <Td className="font-mono text-xs">{e.eventType}</Td>
                  <Td hideBelow="lg">{e.tenantId ? (tenantName.get(e.tenantId) ?? e.tenantId) : "—"}</Td>
                  <Td>{e.status}</Td>
                  <Td hideBelow="xl" className="tabular-nums">
                    {e.attempts}
                  </Td>
                  <Td hideBelow="xl" className="text-destructive">
                    {e.error ?? ""}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableContainer>
        </div>
      </details>
    </>
  );
}
