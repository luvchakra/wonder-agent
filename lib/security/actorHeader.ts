import "server-only";

/**
 * Who is acting, for the database (migration 0115). A request made as the
 * user carries their session, so PostgreSQL knows them (auth.uid()). A
 * service-role request carries no session, so the server names the actor
 * in this header from the request's own resolved session; the
 * `current_actor_id()` function reads it only on service-role requests,
 * only as a UUID, and never over a real session. Outside a request (a
 * cron, `after()` work) there is no actor, and the header is left out.
 */
export const ACTOR_HEADER = "x-wonderid-actor";

export async function currentActorId(): Promise<string | null> {
  try {
    const { getSessionUser } = await import("@/lib/tenant/session");
    const user = await getSessionUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

/** A fetch that adds the actor header to every request it sends. */
export function actorAwareFetch(): typeof fetch {
  return async (input, init) => {
    const actor = await currentActorId();
    if (!actor) return fetch(input, init);
    const headers = new Headers(init?.headers);
    headers.set(ACTOR_HEADER, actor);
    return fetch(input, { ...init, headers });
  };
}
