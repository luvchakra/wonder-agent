"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * "Good morning, Jane". The time of day has to come from the browser —
 * the server renders in UTC, which would greet half the world wrongly.
 * useSyncExternalStore's server snapshot is `false`, so the first paint
 * (and the SSR markup it must match) shows the name alone and the
 * greeting appears once hydrated, rather than flipping from wrong to
 * right in front of the user.
 */
export function Greeting({ name }: { name: string }) {
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const hour = new Date().getHours();
  const partOfDay = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground sm:text-2xl">
      {hydrated ? `${partOfDay}, ${name}` : name}
    </h1>
  );
}
