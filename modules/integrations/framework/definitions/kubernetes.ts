import type { ConnectorDefinition } from "../types";

const RBAC = "/apis/rbac.authorization.k8s.io/v1";
const page = { type: "cursor", param: "continue", from: "metadata.continue", sizeParam: "limit", size: 500 } as const;
/** The cluster's own namespaces: their service accounts are Kubernetes' controllers, not workloads. */
const SYSTEM_NAMESPACES = ["kube-system", "kube-public", "kube-node-lease"];
const serviceAccount = "system:serviceaccount:{record.namespace}:{record.name}";

/** Kubernetes: workload service accounts, Roles and ClusterRoles, and the bindings that grant them. */
export const kubernetes: ConnectorDefinition = {
  schemaVersion: 1,
  key: "kubernetes",
  version: "1.0.0",
  name: "Kubernetes",
  vendor: "Kubernetes",
  category: "infrastructure",
  description:
    "Service accounts outside the system namespaces (an `owner` annotation is read as the owner), Roles and ClusterRoles (system: roles left out), and which service account each RoleBinding and ClusterRoleBinding grants.",
  documentationUrl: "https://kubernetes.io/docs/reference/access-authn-authz/rbac/",
  driver: "http",
  settings: [{ key: "baseUrl", label: "API server address", type: "url", required: true, help: "For example https://k8s.example.com:6443, with a publicly trusted certificate" }],
  auth: {
    type: "bearer",
    token: "{secret.token}",
    fields: [{ key: "token", label: "Service account token", help: "Bound to a ClusterRole allowing only get and list on serviceaccounts, namespaces and the four RBAC resources" }],
  },
  test: { request: { path: "/api/v1/namespaces", query: { limit: "1" } } },
  application: "Kubernetes",
  rateLimitPerSecond: 20,
  resources: {
    account: {
      request: { path: "/api/v1/serviceaccounts" },
      records: "items",
      pagination: page,
      where: [{ path: "metadata.namespace", notIn: SYSTEM_NAMESPACES }],
      fields: {
        externalId: { template: "system:serviceaccount:{record.metadata.namespace}:{record.metadata.name}" },
        username: { template: "system:serviceaccount:{record.metadata.namespace}:{record.metadata.name}" },
        displayName: { template: "{record.metadata.namespace}/{record.metadata.name}" },
        owner: "metadata.annotations.owner",
        accountType: { value: "service" },
        status: { value: "active" },
        createdAt: { path: "metadata.creationTimestamp", transform: ["date"] },
      },
    },
    entitlement: [
      {
        request: { path: `${RBAC}/clusterroles` },
        records: "items",
        pagination: page,
        where: [{ path: "metadata.name", notPrefix: "system:" }],
        fields: {
          externalId: { template: "clusterrole:{record.metadata.name}" },
          name: "metadata.name",
          type: { value: "cluster-role" },
          privilegeLevel: { path: "metadata.name", transform: [{ map: { "cluster-admin": "admin", admin: "admin", edit: "elevated" }, default: "standard" }] },
        },
      },
      {
        request: { path: `${RBAC}/roles` },
        records: "items",
        pagination: page,
        where: [{ path: "metadata.namespace", notIn: SYSTEM_NAMESPACES }],
        fields: {
          externalId: { template: "role:{record.metadata.namespace}/{record.metadata.name}" },
          name: { template: "{record.metadata.namespace}/{record.metadata.name}" },
          type: { value: "role" },
        },
      },
    ],
    access_grant: [
      {
        request: { path: `${RBAC}/clusterrolebindings` },
        records: "items",
        pagination: page,
        unwind: "subjects",
        where: [{ path: "kind", equals: "ServiceAccount" }, { path: "namespace", notIn: SYSTEM_NAMESPACES }],
        fields: {
          externalId: { template: "crb:{parent.metadata.name}:{record.namespace}:{record.name}" },
          accountExternalId: { template: serviceAccount },
          entitlementExternalId: { template: "clusterrole:{parent.roleRef.name}" },
          grantType: { value: "cluster" },
        },
      },
      {
        request: { path: `${RBAC}/rolebindings` },
        records: "items",
        pagination: page,
        unwind: "subjects",
        where: [{ path: "kind", equals: "ServiceAccount" }, { path: "parent.roleRef.kind", equals: "Role" }, { path: "parent.metadata.namespace", notIn: SYSTEM_NAMESPACES }],
        fields: {
          externalId: { template: "rb:{parent.metadata.namespace}/{parent.metadata.name}:{record.namespace}:{record.name}" },
          accountExternalId: { template: serviceAccount },
          entitlementExternalId: { template: "role:{parent.metadata.namespace}/{parent.roleRef.name}" },
          grantType: { value: "namespace" },
        },
      },
      {
        request: { path: `${RBAC}/rolebindings` },
        records: "items",
        pagination: page,
        unwind: "subjects",
        where: [{ path: "kind", equals: "ServiceAccount" }, { path: "parent.roleRef.kind", equals: "ClusterRole" }, { path: "parent.metadata.namespace", notIn: SYSTEM_NAMESPACES }],
        fields: {
          externalId: { template: "rb:{parent.metadata.namespace}/{parent.metadata.name}:{record.namespace}:{record.name}" },
          accountExternalId: { template: serviceAccount },
          entitlementExternalId: { template: "clusterrole:{parent.roleRef.name}" },
          grantType: { value: "namespace" },
        },
      },
    ],
  },
};
