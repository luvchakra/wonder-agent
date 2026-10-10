import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { getConnectorDefinition } from "@/modules/integrations/framework/catalog";
import type { ConnectorDefinition } from "@/modules/integrations/framework/types";
import { AuthorForm } from "./AuthorForm";

const STARTER: ConnectorDefinition = {
  schemaVersion: 1,
  key: "my-application",
  version: "1.0.0",
  name: "My application",
  category: "application",
  description: "Accounts and roles from My application.",
  driver: "http",
  settings: [{ key: "baseUrl", label: "Address", type: "url", required: true }],
  auth: { type: "bearer", token: "{secret.token}", fields: [{ key: "token", label: "API token" }] },
  test: { request: { path: "/api/me" } },
  resources: {
    account: {
      request: { path: "/api/users" },
      records: "data",
      pagination: { type: "page", param: "page", sizeParam: "per_page", size: 100 },
      fields: { externalId: "id", username: "login", email: { path: "email", transform: ["lower"] }, status: "state" },
    },
  },
};

/** Write, try and publish a connector definition. `?from=builtin:keycloak` starts from an existing one. */
export default async function NewConnectorPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("integration.create");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const { from } = await searchParams;
  const [origin, key] = (from ?? "").split(":");
  const base = (origin === "builtin" || origin === "custom") && key ? await getConnectorDefinition(ctx.tenantId!, origin, key) : null;
  const initial = base ? { ...base, key: origin === "builtin" ? `${base.key}-custom` : base.key } : STARTER;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/integrations/connectors" className="text-sm text-primary hover:underline">
        ← All connectors
      </Link>
      <div>
        <h1 className="text-xl font-semibold text-foreground">Write a connector</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A definition describes one product&apos;s API; your organization can then connect any number of its systems with it.
        </p>
      </div>
      <AuthorForm initial={JSON.stringify(initial, null, 2)} />
    </div>
  );
}
