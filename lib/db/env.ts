function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Copy .env.local.example to .env.local and fill it in.`,
    );
  }
  return value;
}

export function getSupabaseUrl(): string {
  return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export function getSupabasePublishableKey(): string {
  return required(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

/**
 * Server-only. Throws if evaluated in a context bundled to the client.
 * `window` is never defined in Node/edge server runtimes, so this is a
 * reliable guard against accidental client-bundle inclusion.
 */
export function getSupabaseServiceRoleKey(): string {
  if (typeof window !== "undefined") {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY must never be read from client code.",
    );
  }
  return required(
    "SUPABASE_SERVICE_ROLE_KEY",
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export function getSecretEncryptionKey(): string {
  if (typeof window !== "undefined") {
    throw new Error("SECRET_ENCRYPTION_KEY must never be read from client code.");
  }
  return required("SECRET_ENCRYPTION_KEY", process.env.SECRET_ENCRYPTION_KEY);
}

/**
 * PLATFORM-P0-05.2's platform-wide default OpenAI key. Deliberately does
 * NOT use `required()` — unlike the vars above, this one is legitimately
 * optional: a deployment may run BYOK-only, with every tenant supplying its
 * own key and no platform-wide fallback configured at all.
 */
export function getPlatformOpenAiApiKey(): string | null {
  if (typeof window !== "undefined") {
    throw new Error("PLATFORM_OPENAI_API_KEY must never be read from client code.");
  }
  return process.env.PLATFORM_OPENAI_API_KEY || null;
}
