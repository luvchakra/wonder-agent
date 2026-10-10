import type { ConnectorCategory, ResourceKind } from "@/modules/integrations/framework/types";

export const CATEGORY_LABEL: Record<ConnectorCategory, string> = {
  hr: "HR systems",
  identity_provider: "Identity providers",
  directory: "Directories",
  application: "Applications",
  database: "Databases",
  secrets: "Secrets managers",
  infrastructure: "Infrastructure",
  other: "Other",
};

export const RESOURCE_LABEL: Record<ResourceKind, string> = {
  identity: "people",
  account: "accounts",
  entitlement: "roles and groups",
  access_grant: "who has what",
  application: "applications",
};
