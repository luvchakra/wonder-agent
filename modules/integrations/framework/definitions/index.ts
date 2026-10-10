import type { ConnectorDefinition } from "../types";
import { frappeHr } from "./frappe-hr";
import { erpnext } from "./erpnext";
import { ldapDirectory } from "./ldap-directory";
import { keycloak } from "./keycloak";
import { gitea } from "./gitea";
import { mattermost } from "./mattermost";
import { nextcloud } from "./nextcloud";
import { postgresql } from "./postgresql";
import { openbao } from "./openbao";
import { kubernetes } from "./kubernetes";

/**
 * WonderID's built-in connector definitions, one per product. Each is
 * generic: any organization running that product can use it by entering
 * its own address and credentials. definitions.test.ts validates every one.
 */
export const BUILTIN_DEFINITIONS: ConnectorDefinition[] = [frappeHr, erpnext, ldapDirectory, keycloak, gitea, mattermost, nextcloud, postgresql, openbao, kubernetes];
