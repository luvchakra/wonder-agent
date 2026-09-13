"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublishableKey, getSupabaseUrl } from "./env";

/**
 * The only sanctioned way to get a Supabase client from client components.
 * Uses the public URL + publishable key only — never the service role key.
 */
export function supabaseBrowser() {
  return createBrowserClient(getSupabaseUrl(), getSupabasePublishableKey());
}
