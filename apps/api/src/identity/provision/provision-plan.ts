/**
 * `F3.78` U4 (ADR 0089 decisions 4–6) — the pure half of `keycloak:provision`:
 * what realm `bms`, the `bms-api-admin` client and the user profile must look
 * like after a run, and the unlinked/unverified report.
 *
 * Every function here is pure, so `provision-plan.spec.ts` enumerates the
 * cases with no Keycloak; `provision-cli.ts` makes the REST calls.
 *
 * The realm file (`infra/keycloak/bms-realm.json`) states the same client,
 * brute-force settings and user profile for a fresh import. The provisioning
 * step re-applies them so an existing realm — imported before F3.78, or built
 * by hand — converges too, and it alone sets the password policy and the
 * client secret (plan U4).
 */

/** The confidential client the users API calls Keycloak as (decision 5). */
export const ADMIN_CLIENT_ID = "bms-api-admin";

/**
 * The `realm-management` roles the service account holds — and the only ones.
 * Plan D1: if K1 shows `available` needs more, `view-realm` joins this list.
 */
export const SERVICE_ACCOUNT_ROLES = ["manage-users", "view-users"] as const;

/** Decision 6: a minimum length of at least 12. Not in the realm file (plan U4). */
export const PASSWORD_POLICY = "length(12) and notUsername and notEmail";

/**
 * The subset of Keycloak's `ClientRepresentation` the step owns. **No
 * `secret`**: the secret is set in its own `PUT` from
 * `KEYCLOAK_ADMIN_CLIENT_SECRET`, so this object can be printed, diffed or
 * committed without carrying one.
 */
export type AdminClientRepresentation = {
  readonly clientId: string;
  readonly name: string;
  readonly enabled: true;
  readonly protocol: "openid-connect";
  readonly clientAuthenticatorType: "client-secret";
  readonly publicClient: false;
  readonly serviceAccountsEnabled: true;
  readonly standardFlowEnabled: false;
  readonly directAccessGrantsEnabled: false;
  readonly implicitFlowEnabled: false;
};

export function desiredAdminClient(): AdminClientRepresentation {
  return {
    clientId: ADMIN_CLIENT_ID,
    name: "BMS API user administration",
    enabled: true,
    protocol: "openid-connect",
    clientAuthenticatorType: "client-secret",
    publicClient: false,
    serviceAccountsEnabled: true,
    standardFlowEnabled: false,
    directAccessGrantsEnabled: false,
    implicitFlowEnabled: false,
  };
}

/**
 * The realm settings the step `PUT`s. Keycloak's realm update leaves every
 * field the representation omits as it was, so this is a partial update.
 * The brute-force numbers match the realm file.
 */
export type RealmSettings = {
  readonly passwordPolicy: string;
  readonly bruteForceProtected: true;
  readonly permanentLockout: false;
  readonly failureFactor: number;
  readonly waitIncrementSeconds: number;
  readonly maxFailureWaitSeconds: number;
  readonly maxDeltaTimeSeconds: number;
  readonly minimumQuickLoginWaitSeconds: number;
  readonly quickLoginCheckMilliSeconds: number;
  readonly editUsernameAllowed: false;
};

export function desiredRealmSettings(): RealmSettings {
  return {
    passwordPolicy: PASSWORD_POLICY,
    bruteForceProtected: true,
    permanentLockout: false,
    failureFactor: 10,
    waitIncrementSeconds: 60,
    maxFailureWaitSeconds: 900,
    maxDeltaTimeSeconds: 43200,
    minimumQuickLoginWaitSeconds: 60,
    quickLoginCheckMilliSeconds: 1000,
    editUsernameAllowed: false,
  };
}

/** Keycloak 24's declarative user-profile configuration (`UPConfig`), loosely typed. */
export type UserProfileAttribute = {
  name: string;
  permissions?: { view?: string[]; edit?: string[] };
  [key: string]: unknown;
};

export type UserProfileConfig = {
  attributes: UserProfileAttribute[];
  [key: string]: unknown;
};

/**
 * The live configuration with `email.permissions.edit` set to `["admin"]` and
 * **nothing else changed** (decision 4: a user cannot edit its own email, so
 * cannot point its account at another person's row before it links).
 *
 * A transform, never a configuration built from scratch: `PUT /users/profile`
 * replaces the whole configuration, and one that dropped `username`,
 * `firstName` or `lastName` would break sign-in for every user. A
 * configuration with no `email` attribute is refused rather than passed
 * through, because the run would otherwise report success for a rule it
 * never applied.
 */
export function withAdminOnlyEmailEdit(current: UserProfileConfig): UserProfileConfig {
  const next = structuredClone(current);
  const email = next.attributes.find((attribute) => attribute.name === "email");
  if (email === undefined) {
    throw new Error("the realm's user profile has no email attribute; refusing to write it");
  }
  email.permissions = { ...email.permissions, edit: ["admin"] };
  return next;
}

/** A realm user as `GET /users?briefRepresentation=true` returns it. */
export type RealmUserSummary = {
  readonly id: string;
  readonly email?: string;
  readonly emailVerified?: boolean;
};

/** A `bms.users` row as the step reads it on `bms_auth`. */
export type UserRowSummary = {
  readonly email: string;
  readonly oidcSubject: string | null;
};

/**
 * Decision 4's report: every realm user whose email is **not verified** and
 * whose `bms.users` row (matched on `lower(email)`, the link's key) is **not
 * linked**. Such a user can never link, and an unlinked `admin` is refused by
 * ADR 0044 — the runbook's one-shot superuser link is the remedy.
 *
 * A realm user with no row is not listed: there is nothing to link, and every
 * realm has at least one (the service account). The report carries emails
 * only, never a Keycloak id; sorted and de-duplicated, so two runs compare.
 */
export function unlinkedUnverifiedReport(
  realmUsers: readonly RealmUserSummary[],
  rows: readonly UserRowSummary[],
): string[] {
  const unlinked = new Set(
    rows.filter((row) => row.oidcSubject === null).map((row) => row.email.toLowerCase()),
  );
  const listed = new Set<string>();
  for (const user of realmUsers) {
    if (user.emailVerified !== false || !user.email) {
      continue;
    }
    const email = user.email.toLowerCase();
    if (unlinked.has(email)) {
      listed.add(email);
    }
  }
  return [...listed].sort();
}
