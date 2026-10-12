import type { BadgeTone } from "@/modules/ui";

// EXPERIENCE-P0-29 — where a request line stands, in one place for the list
// and the request page. Every state is the server's (§17.5): the request's
// status, then, once approved, how far its fulfilment tasks and grants have
// really come (requestProgress), and whether its end date has passed.

type Label = { label: string; tone: BadgeTone };

export const STATUS: Record<string, Label> = {
  pending: { label: "Waiting for approval", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  fulfilled: { label: "Fulfilled", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  expired: { label: "Expired", tone: "neutral" },
};

const FAILED: Label = { label: "Fulfilment failed · see the task", tone: "danger" };

// ACCESS-P0-28/30/32: once approved, the request shows how far it has really come, in the words of what it asked for.
export const FULFILMENT: Record<string, Record<string, Label>> = {
  grant: {
    pending_fulfilment: { label: "Approved · waiting for fulfilment", tone: "warning" },
    failed: FAILED,
    fulfilled_unverified: { label: "Fulfilled · not yet verified", tone: "warning" },
    verified: { label: "Verified at the source", tone: "success" },
  },
  remove: {
    pending_fulfilment: { label: "Approved · waiting for removal", tone: "warning" },
    failed: FAILED,
    fulfilled_unverified: { label: "Removed · not yet verified", tone: "warning" },
    verified: { label: "Removal verified at the source", tone: "success" },
  },
  disable_account: {
    pending_fulfilment: { label: "Approved · waiting for the account to be disabled", tone: "warning" },
    failed: FAILED,
    fulfilled_unverified: { label: "Disabled · not yet verified", tone: "warning" },
    verified: { label: "Disabled at the source", tone: "success" },
  },
  // An extension changes nothing on the target; the access it keeps is already there.
  extend: {
    pending_fulfilment: { label: "Extended · the access is not yet at the source", tone: "warning" },
    failed: FAILED,
    fulfilled_unverified: { label: "Extended · not yet verified", tone: "warning" },
    verified: { label: "Extended", tone: "success" },
    untracked: { label: "Approved · nothing left to extend", tone: "neutral" },
  },
};

// WID-C02: ended access is not gone until a read of the system confirms it.
export const ENDED: Record<string, Label> = {
  pending: { label: "Ended · removal pending", tone: "warning" },
  removed_unverified: { label: "Ended · removed, not yet verified", tone: "warning" },
  verified: { label: "Ended · removal verified", tone: "success" },
  never_fulfilled: { label: "Ended · never fulfilled", tone: "neutral" },
};

/** One line's state: its status, or once approved its real progress; time-bound access past its end date has ended, and shows whether it is gone. */
export function lineState(
  r: { status: string; requestType: string; requestedExpiry: string | null },
  progress: string | null | undefined,
  now = new Date(),
  removal?: string | null,
): Label {
  const approved = r.status === "approved" || r.status === "fulfilled";
  if (approved && (r.requestType === "grant" || r.requestType === "extend") && r.requestedExpiry && Date.parse(r.requestedExpiry) <= now.getTime()) {
    return (removal && ENDED[removal]) || { label: "Ended", tone: "neutral" };
  }
  const real = approved && progress ? (FULFILMENT[r.requestType] ?? FULFILMENT.grant)[progress] : undefined;
  return real ?? STATUS[r.status] ?? { label: r.status, tone: "neutral" };
}
