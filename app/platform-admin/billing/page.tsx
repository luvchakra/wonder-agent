import { listAdjustments, listAllPrices, listWebhookEvents } from "@/modules/billing/adjustments";
import { listTenants } from "@/modules/platform-admin/service";
import { configuredProviders } from "@/modules/billing/config";
import { formatMoney } from "@/modules/billing/rules";
import { decideAdjustmentAction, requestAdjustmentAction, updatePriceAction } from "@/app/actions/platformBilling";

// See app/platform-admin/page.tsx for why this is forced.
export const dynamic = "force-dynamic";

/**
 * PLATFORM-P1-04 — vendor billing console: provider status, the price
 * catalogue, the maker-checker adjustment queue (refunds, plan overrides,
 * immediate cancellations) and the webhook intake log.
 */
export default async function PlatformBillingPage() {
  const [prices, pending, recent, events, tenants] = await Promise.all([
    listAllPrices(),
    listAdjustments({ status: "pending" }),
    listAdjustments(),
    listWebhookEvents({ limit: 50 }),
    listTenants(),
  ]);
  const providers = configuredProviders();
  const tenantName = new Map(tenants.map((t) => [t.tenantId, t.name ?? t.tenantId]));

  return (
    <main>
      <h1>Billing</h1>
      <p>
        Stripe: <strong>{providers.stripe ? "configured" : "not configured"}</strong> · Razorpay: <strong>{providers.razorpay ? "configured" : "not configured"}</strong>
      </p>

      <h2>Adjustments awaiting a second approver ({pending.length})</h2>
      <p style={{ fontSize: 13 }}>Refunds, plan overrides and immediate cancellations need a different platform administrator to approve. Approving executes them.</p>
      <table border={1} cellPadding={6}>
        <thead>
          <tr>
            <th>Tenant</th>
            <th>Kind</th>
            <th>Amount / plan</th>
            <th>Reason</th>
            <th>Requested</th>
            <th>Decision</th>
          </tr>
        </thead>
        <tbody>
          {pending.map((a) => (
            <tr key={a.id}>
              <td>{tenantName.get(a.tenantId) ?? a.tenantId}</td>
              <td>{a.kind}</td>
              <td>{a.amount && a.currency ? formatMoney(a.amount, a.currency) : (a.targetPlan ?? "—")}</td>
              <td>{a.reason}</td>
              <td>{new Date(a.requestedAt).toLocaleString()}</td>
              <td>
                <form action={decideAdjustmentAction.bind(null, a.id, true)} style={{ display: "inline" }}>
                  <input name="note" placeholder="Note (optional)" />
                  <button type="submit">Approve &amp; execute</button>
                </form>{" "}
                <form action={decideAdjustmentAction.bind(null, a.id, false)} style={{ display: "inline" }}>
                  <button type="submit">Reject</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Request an adjustment</h2>
      <form action={requestAdjustmentAction} style={{ display: "grid", gap: 6, maxWidth: 520 }}>
        <select name="tenantId" required defaultValue="">
          <option value="" disabled>
            Tenant
          </option>
          {tenants.map((t) => (
            <option key={t.tenantId} value={t.tenantId}>
              {t.name}
            </option>
          ))}
        </select>
        <select name="kind" required defaultValue="refund">
          <option value="refund">Refund (needs invoice id and amount)</option>
          <option value="plan_override">Plan override</option>
          <option value="cancel_immediately">Cancel immediately</option>
        </select>
        <input name="invoiceId" placeholder="Invoice id (refund)" />
        <input name="amount" placeholder="Refund amount in major units, e.g. 499.00" inputMode="decimal" />
        <select name="targetPlan" defaultValue="">
          <option value="">Target plan (override)</option>
          <option value="free">free</option>
          <option value="pro">pro</option>
          <option value="max">max</option>
          <option value="enterprise">enterprise</option>
        </select>
        <textarea name="reason" required minLength={10} placeholder="Reason (at least 10 characters; kept in the audit trail)" />
        <button type="submit">Request (a second administrator approves)</button>
      </form>

      <h2>Price catalogue</h2>
      <p style={{ fontSize: 13 }}>Changing an amount unlinks the provider price; the next checkout creates a new one. Existing subscribers keep their price.</p>
      <table border={1} cellPadding={6}>
        <thead>
          <tr>
            <th>Price</th>
            <th>Amount</th>
            <th>Tax</th>
            <th>Provider link</th>
            <th>Change</th>
          </tr>
        </thead>
        <tbody>
          {prices.map((p) => (
            <tr key={p.id}>
              <td>{p.id}</td>
              <td>{formatMoney(p.unitAmount, p.currency)}</td>
              <td>{p.taxBehavior}</td>
              <td>
                {p.stripeLinked ? "Stripe " : ""}
                {p.razorpayLinked ? "Razorpay" : ""}
                {!p.stripeLinked && !p.razorpayLinked ? "—" : ""}
              </td>
              <td>
                <form action={updatePriceAction.bind(null, p.id)}>
                  <input name="amount" defaultValue={(p.unitAmount / 100).toFixed(2)} inputMode="decimal" size={10} aria-label={`${p.id} amount`} />
                  <label>
                    <input type="checkbox" name="active" defaultChecked={p.active} /> active
                  </label>{" "}
                  <button type="submit">Save</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Recent adjustments</h2>
      <table border={1} cellPadding={6}>
        <thead>
          <tr>
            <th>Tenant</th>
            <th>Kind</th>
            <th>Status</th>
            <th>Provider ref</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          {recent.slice(0, 50).map((a) => (
            <tr key={a.id}>
              <td>{tenantName.get(a.tenantId) ?? a.tenantId}</td>
              <td>{a.kind}</td>
              <td>{a.status}</td>
              <td>{a.providerReference ?? "—"}</td>
              <td>{a.error ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Webhook intake (latest 50)</h2>
      <table border={1} cellPadding={6}>
        <thead>
          <tr>
            <th>Received</th>
            <th>Provider</th>
            <th>Event</th>
            <th>Tenant</th>
            <th>Status</th>
            <th>Attempts</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td>{new Date(e.receivedAt).toLocaleString()}</td>
              <td>{e.provider}</td>
              <td>{e.eventType}</td>
              <td>{e.tenantId ? (tenantName.get(e.tenantId) ?? e.tenantId) : "—"}</td>
              <td>{e.status}</td>
              <td>{e.attempts}</td>
              <td>{e.error ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
