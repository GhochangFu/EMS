import {
  PASSWORD_POLICY,
  desiredAdminClient,
  desiredRealmSettings,
  unlinkedUnverifiedReport,
  withAdminOnlyEmailEdit,
  type RealmUserSummary,
  type UserProfileConfig,
  type UserRowSummary,
} from "./provision-plan";

/**
 * `F3.78` U4 (ADR 0089 decisions 4–6, plan U4) — the pure half of
 * `keycloak:provision`: what the realm, the `bms-api-admin` client and the
 * user profile must look like, and the unlinked/unverified report.
 *
 * Assertions live here; `provision-plan.test.ts` runs them (ADR 0014). One
 * claim per exported function: an `assert` throws, so a second claim in the
 * same function would never be reached once the first reddens.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

// --- the client --------------------------------------------------------------

/** Decision 5: the repository carries no secret for the client, in any shape. */
export function assertTheDesiredClientHasNoSecret(): void {
  const client = desiredAdminClient();
  assert(
    !Object.prototype.hasOwnProperty.call(client, "secret"),
    `the desired client must carry no secret key; got keys ${JSON.stringify(Object.keys(client))}`,
  );
}

export function assertTheDesiredClientIsAConfidentialServiceAccount(): void {
  const c = desiredAdminClient();
  const ok =
    c.clientId === "bms-api-admin" &&
    c.publicClient === false &&
    c.serviceAccountsEnabled === true &&
    c.standardFlowEnabled === false &&
    c.directAccessGrantsEnabled === false &&
    c.implicitFlowEnabled === false;
  assert(ok, `the desired client must be confidential, service-account only; got ${JSON.stringify(c)}`);
}

// --- the realm settings --------------------------------------------------------

/** Decision 6: the policy lands in the provisioning step, not in the realm file. */
export function assertTheRealmSettingsCarryTheLengthTwelvePolicy(): void {
  const settings = desiredRealmSettings();
  assert(
    settings.passwordPolicy === PASSWORD_POLICY && PASSWORD_POLICY.includes("length(12)"),
    `the desired realm settings must carry a length(12) policy; got ${JSON.stringify(settings.passwordPolicy)}`,
  );
}

export function assertTheRealmSettingsTurnBruteForceProtectionOn(): void {
  const settings = desiredRealmSettings();
  assert(
    settings.bruteForceProtected === true && settings.permanentLockout === false,
    `brute-force protection must be on with a temporary lockout; got ${JSON.stringify(settings)}`,
  );
}

// --- the user profile --------------------------------------------------------

const CURRENT_PROFILE: UserProfileConfig = {
  attributes: [
    { name: "username", permissions: { view: ["admin", "user"], edit: ["admin", "user"] } },
    {
      name: "email",
      validations: { email: {} },
      required: { roles: ["user"] },
      permissions: { view: ["admin", "user"], edit: ["admin", "user"] },
    },
    { name: "firstName", permissions: { view: ["admin", "user"], edit: ["admin", "user"] } },
    { name: "lastName", permissions: { view: ["admin", "user"], edit: ["admin", "user"] } },
  ],
  groups: [{ name: "user-metadata" }],
};

/** Decision 4: a Keycloak user cannot edit its own email in realm `bms`. */
export function assertTheProfileLetsOnlyAnAdminEditTheEmail(): void {
  const next = withAdminOnlyEmailEdit(CURRENT_PROFILE);
  const edit = next.attributes.find((a) => a.name === "email")?.permissions?.edit;
  assert(
    JSON.stringify(edit) === JSON.stringify(["admin"]),
    `email.permissions.edit must be ["admin"]; got ${JSON.stringify(edit)}`,
  );
}

/**
 * `PUT /users/profile` replaces the whole configuration, so the transform must
 * hand back every other attribute, the email's other keys, and the groups as
 * they were — a config built from scratch would drop them and break sign-in.
 */
export function assertTheProfileTransformKeepsEverythingElse(): void {
  const next = withAdminOnlyEmailEdit(CURRENT_PROFILE);
  const expected = structuredClone(CURRENT_PROFILE);
  expected.attributes[1]!.permissions!.edit = ["admin"];
  assert(
    JSON.stringify(next) === JSON.stringify(expected),
    `only email.permissions.edit may change; got ${JSON.stringify(next)}`,
  );
}

export function assertTheProfileTransformDoesNotMutateItsInput(): void {
  const input = structuredClone(CURRENT_PROFILE);
  withAdminOnlyEmailEdit(input);
  assert(
    JSON.stringify(input) === JSON.stringify(CURRENT_PROFILE),
    "withAdminOnlyEmailEdit must not mutate the configuration it was given",
  );
}

export function assertAProfileWithNoEmailAttributeIsRefused(): void {
  let threw = false;
  try {
    withAdminOnlyEmailEdit({ attributes: [{ name: "username" }] });
  } catch {
    threw = true;
  }
  assert(threw, "a profile with no email attribute must be refused, not passed through unchanged");
}

// --- the unlinked/unverified report -----------------------------------------------

const REALM_ID_UNVERIFIED_UNLINKED = "kc-11111111-aaaa";
const REALM_ID_VERIFIED_UNLINKED = "kc-22222222-bbbb";
const REALM_ID_UNVERIFIED_LINKED = "kc-33333333-cccc";
const REALM_ID_UNVERIFIED_NO_ROW = "kc-44444444-dddd";
const REALM_ID_SERVICE_ACCOUNT = "kc-55555555-eeee";

const REALM_USERS: RealmUserSummary[] = [
  { id: REALM_ID_UNVERIFIED_UNLINKED, email: "Both@Example.test", emailVerified: false },
  { id: REALM_ID_VERIFIED_UNLINKED, email: "verified@example.test", emailVerified: true },
  { id: REALM_ID_UNVERIFIED_LINKED, email: "linked@example.test", emailVerified: false },
  { id: REALM_ID_UNVERIFIED_NO_ROW, email: "norow@example.test", emailVerified: false },
  // A service-account user: no email, not verified, no row.
  { id: REALM_ID_SERVICE_ACCOUNT, emailVerified: false },
];

const DB_ROWS: UserRowSummary[] = [
  { email: "both@example.test", oidcSubject: null },
  { email: "verified@example.test", oidcSubject: null },
  { email: "linked@example.test", oidcSubject: REALM_ID_UNVERIFIED_LINKED },
];

/** Decision 4: unverified AND unlinked — the one user who can never link. */
export function assertTheReportListsAnUnverifiedUnlinkedUser(): void {
  const report = unlinkedUnverifiedReport(REALM_USERS, DB_ROWS);
  assert(
    report.includes("both@example.test"),
    `an unverified user whose row is unlinked must be listed; got ${JSON.stringify(report)}`,
  );
}

export function assertTheReportOmitsAVerifiedUnlinkedUser(): void {
  const report = unlinkedUnverifiedReport(REALM_USERS, DB_ROWS);
  assert(
    !report.includes("verified@example.test"),
    `a verified user links on its next sign-in and must not be listed; got ${JSON.stringify(report)}`,
  );
}

export function assertTheReportOmitsAnUnverifiedLinkedUser(): void {
  const report = unlinkedUnverifiedReport(REALM_USERS, DB_ROWS);
  assert(
    !report.includes("linked@example.test"),
    `a linked user must not be listed, however its email stands; got ${JSON.stringify(report)}`,
  );
}

/**
 * A realm user with no `bms.users` row has nothing to link — the service
 * account is one on every realm, so counting it would exit 2 on every run.
 */
export function assertTheReportOmitsARealmUserWithNoRow(): void {
  const report = unlinkedUnverifiedReport(REALM_USERS, DB_ROWS);
  assert(
    JSON.stringify(report) === JSON.stringify(["both@example.test"]),
    `only the unverified, unlinked user with a row may be listed; got ${JSON.stringify(report)}`,
  );
}

/** The report names users by email only — never a Keycloak id. */
export function assertTheReportCarriesEmailsAndNoIds(): void {
  const text = JSON.stringify(unlinkedUnverifiedReport(REALM_USERS, DB_ROWS));
  const ids = [
    REALM_ID_UNVERIFIED_UNLINKED,
    REALM_ID_VERIFIED_UNLINKED,
    REALM_ID_UNVERIFIED_LINKED,
    REALM_ID_UNVERIFIED_NO_ROW,
    REALM_ID_SERVICE_ACCOUNT,
  ];
  const leaked = ids.filter((id) => text.includes(id));
  assert(leaked.length === 0, `the report must carry no Keycloak id; found ${JSON.stringify(leaked)}`);
}

export function assertTheReportIsEmptyWhenEveryoneIsLinked(): void {
  const report = unlinkedUnverifiedReport(REALM_USERS, [
    { email: "both@example.test", oidcSubject: REALM_ID_UNVERIFIED_UNLINKED },
  ]);
  assert(report.length === 0, `no unlinked row means an empty report; got ${JSON.stringify(report)}`);
}
