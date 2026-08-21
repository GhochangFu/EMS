/**
 * Template authoring access (`F2.5`, ADR 0038 decision 10 — Unit 6).
 *
 * The role list comes from `userRoleSchema`, not from the module under test, so
 * a role added to the contract must be given an answer here before it can ship.
 */
import { accessibleScopeSchema, userRoleSchema } from "@bms/shared/contracts";
import type { UserRole } from "@bms/shared";

import * as access from "./template-authoring-access";
import {
  canAuthorTemplates,
  canInstantiateTemplates,
  templateFormsAreEditable,
} from "./template-authoring-access";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const ALL_ROLES = userRoleSchema.options as readonly UserRole[];

/** The authoring half, over the whole role union. */
export function runAuthoringRoleTests(): void {
  const allowed = ALL_ROLES.filter((role) => canAuthorTemplates(role));
  assert(
    allowed.join(",") === "admin,organization_admin",
    `only admin and organization_admin may author — got ${allowed.join(",")}`,
  );

  // Named individually as well, because the joined string above would still
  // read correctly if the union's order changed and a role went missing.
  assert(canAuthorTemplates("admin"), "admin may author");
  assert(canAuthorTemplates("organization_admin"), "organization_admin may author");
  assert(
    !canAuthorTemplates("location_admin"),
    "ADR 0015 §7: a location admin may not author — assertCanAuthor rejects it by name",
  );
  assert(!canAuthorTemplates("asset_group_admin"), "asset group admin may not author");
  assert(!canAuthorTemplates("operator"), "operator may not author");
  assert(!canAuthorTemplates("viewer"), "viewer may not author");
}

/**
 * The instantiate half, which is a **different** set.
 *
 * A location admin deploys plant. If this ever equals the authoring set, the
 * page has silently taken away the one action ADR 0015 §7 exists to keep.
 */
export function runInstantiateRoleTests(): void {
  const allowed = ALL_ROLES.filter((role) => canInstantiateTemplates(role));
  assert(
    allowed.join(",") === "admin,organization_admin,location_admin",
    `master-data roles may instantiate — got ${allowed.join(",")}`,
  );
  assert(canInstantiateTemplates("location_admin"), "a location admin deploys");
  assert(!canInstantiateTemplates("operator"), "operator may not instantiate");
  assert(!canInstantiateTemplates("viewer"), "viewer may not instantiate");
  assert(!canInstantiateTemplates("asset_group_admin"), "asset group admin may not instantiate");

  const authors = ALL_ROLES.filter((role) => canAuthorTemplates(role)).join(",");
  assert(authors !== allowed.join(","), "the two capabilities must not collapse into one");
}

/**
 * The organization-scope half stays absent, and stays absent for a reason.
 *
 * Two assertions rather than a comment:
 *
 * 1. `accessibleScopeSchema` still carries no organization list, so the
 *    question is still not answerable in the browser. If someone adds one, this
 *    fires and tells them the client can now do this check for real.
 * 2. This module exports exactly the two capability helpers. A third that
 *    claimed to answer "may this user manage this organization" would be
 *    guessing, and a guess that says no hides a control the API would have
 *    allowed.
 */
export function runNoOrganizationScopeHelperTests(): void {
  const scopeKeys = Object.keys(accessibleScopeSchema.shape).sort();
  assert(
    scopeKeys.join(",") === "assetGroups,assetIds,kind,locations",
    `the access scope contract changed — got ${scopeKeys.join(",")}`,
  );
  assert(
    !scopeKeys.includes("organizations"),
    "an organization list in the scope contract would make the D10 residual case derivable",
  );

  // Deliberately an exact list, so a new export cannot arrive without someone
  // reading the paragraph above and deciding it is not an organization-scope
  // guess. `templateFormsAreEditable` was added that way: it composes the role
  // helper with the version's frozen state and answers nothing about
  // organizations, which is the one question this module must never pretend to
  // answer.
  const exported = Object.keys(access).sort();
  assert(
    exported.join(",") ===
      "canAuthorTemplates,canInstantiateTemplates,templateFormsAreEditable",
    `this module must export exactly the three vetted helpers — got ${exported.join(",")}`,
  );

  // The rule that actually matters, asserted rather than left to the list:
  // nothing here may name an organization.
  for (const name of exported) {
    assert(
      !/organi[sz]ation/i.test(name),
      `"${name}" claims to answer an organization question the browser cannot answer`,
    );
  }
}

/**
 * The forms are editable only when **both** questions say yes.
 *
 * The defect this pins: the detail page asked only "is this version frozen?"
 * and passed that straight to all five tabs, so a `location_admin` saw every
 * authoring field editable on a draft. The lifecycle buttons were correctly
 * hidden, which made the page look right while the forms were not.
 *
 * Asserted over every role in the union rather than the one that was found
 * broken — the same omission would apply to any non-authoring role added
 * later.
 */
export function runFormEditabilityTests(): void {
  let checked = 0;
  for (const role of ALL_ROLES) {
    const mayAuthor = canAuthorTemplates(role);

    // A frozen version is read-only for everyone, authors included.
    assert(
      !templateFormsAreEditable(role, false),
      `a published or archived version must be read-only for ${role}`,
    );

    // An editable version follows the role, and nothing else.
    assert(
      templateFormsAreEditable(role, true) === mayAuthor,
      `on a draft, ${role} must see editable forms only if it may author (mayAuthor=${mayAuthor})`,
    );
    checked += 1;
  }

  // Anti-vacuity: an empty role union would pass every assertion above by
  // never running one.
  assert(checked === ALL_ROLES.length && checked > 0, `checked ${checked} roles`);

  // And the two halves must be genuinely independent — if every role could
  // author, this rule would be indistinguishable from `versionIsEditable`
  // alone, which is exactly the bug.
  const authors = ALL_ROLES.filter((role) => canAuthorTemplates(role));
  assert(authors.length > 0, "some role must be able to author, or the UI is unusable");
  assert(
    authors.length < ALL_ROLES.length,
    "some role must NOT be able to author, or this rule cannot be distinguished from the status check",
  );
}
