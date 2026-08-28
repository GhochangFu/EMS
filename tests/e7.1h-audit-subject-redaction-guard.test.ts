import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const servicePath = join(repoRoot, "apps", "api", "src", "admin", "audit", "audit.service.ts");

/**
 * `E7.1h` / ADR 0046 Amendment 2 — **a static test, and it says so.**
 *
 * AGENTS.md §4.4: when a guarantee cannot be expressed as a behavioural test,
 * write a static one and name which it is. Two of Amendment 2's three
 * implementation constraints are that case, and for different reasons.
 *
 * **Constraint 3 is not that case, and is held twice on purpose.**
 * `audit.integration.spec.ts` `assertActorSubjectRedaction` exports a CSV as
 * each role and looks for the sentinel — a real behavioural test, and the
 * better one, because it proves the export actually redacts rather than that
 * the code looks as though it would. The structural half below is kept anyway:
 * it names the *reason* a dropped argument is dangerous on the endpoint a
 * reviewer is least likely to open. An earlier draft of this docstring claimed
 * constraint 3 was absent here while the test at the bottom of this file
 * asserted it and its own failure message named it. Corrected rather than left
 * standing: a guard whose record disagrees with its code teaches the next
 * reader the wrong thing about both.
 *
 * **Constraint 2 — keyed on the role, not on the scope.** Inside the set of
 * principals that reach the projection at all, `admin` resolves to a `null`
 * scope and `organization_admin` to an array; every other role is refused
 * earlier by the gate. So `role !== "admin"` and `scope !== null` select
 * exactly the same callers today, and no fixture can distinguish them. The
 * amendment still requires the role, because a future role resolving to a null
 * scope would silently stop a scope-keyed redaction while the role-keyed one
 * keeps working. That is a claim about the *next* change, which is precisely
 * the kind a behavioural test cannot make.
 *
 * **Constraint 1 — redacted in SQL, not in the `.map()`.** A JS-side scrub
 * returns identical bytes to the caller and passes every assertion in the
 * integration suite. What it loses is the property the constraint is about:
 * the value must never leave Postgres for a tenant, because a row that crosses
 * the wire can reach a query log or an error dump. That is unobservable from
 * the endpoint's output by construction.
 *
 * Neither is a style rule. Both are the difference between code that is correct
 * now and code that stays correct, which is what a guard is for.
 */

const source = readFileSync(servicePath, "utf8");

/** The body of one method, from its signature to the closing brace at method indent. */
function methodBody(declaration: string, name: string): string {
  const start = source.indexOf(`  ${declaration} ${name}(`);
  expect(
    start,
    `audit.service.ts no longer declares \`${declaration} ${name}(\` at class indent. ` +
      "If it was renamed, rename it here too — do not delete this guard: it is the only " +
      "thing pinning ADR 0046 Amendment 2 constraints 1 and 2.",
  ).toBeGreaterThan(-1);
  const end = source.indexOf("\n  }", start);
  expect(end, `could not find the end of \`${name}\``).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("E7.1h / ADR 0046 Amendment 2 — the operator's oidcSubject is redacted in SQL, by role", () => {
  it("derives the redaction flag from the database role, never from the scope", () => {
    const body = methodBody("private async", "resolveReadScope");

    expect(
      /redactActorSubject:\s*user\.role\s*!==\s*"admin"/.test(body),
      "resolveReadScope must derive `redactActorSubject` from the DB role resolved through " +
        "`requireMasterDataUser` — `user.role !== \"admin\"`. Two other readings are wrong " +
        "and both pass the integration suite: `scope !== null` (Amendment 2 constraint 2 — " +
        "it silently stops redacting the day a role resolves to a null scope) and " +
        "`jwt.role` (a token outlives a demotion by up to JWT_TTL, and in OIDC mode " +
        "roleFromClaims falls back to `viewer` when realm roles are absent).",
    ).toBe(true);

    const derivation = body.slice(body.indexOf("redactActorSubject:"));
    expect(
      /\bscope\b/.test(derivation.split("\n")[0]),
      "the redaction flag must not be derived from the scope array. See constraint 2.",
    ).toBe(false);
  });

  for (const method of ["list", "export"] as const) {
    it(`${method}() passes that one flag through to selectRows`, () => {
      const body = methodBody("async", method);

      expect(
        /const \{ scope, redactActorSubject \} = await this\.resolveReadScope\(jwt\);/.test(body),
        `${method}() must take both halves of the gate from the single resolveReadScope call. ` +
          "Deriving the flag a second time here is how the list and the export come to " +
          "disagree about who is a tenant.",
      ).toBe(true);

      expect(
        /this\.selectRows\([^)]*redactActorSubject\s*\)/.test(body),
        `${method}() must pass redactActorSubject to selectRows. Amendment 2 constraint 3 ` +
          "makes the export inherit the redaction through this shared method — dropping the " +
          "argument on either call site leaks the subject on that endpoint alone, which is " +
          "the half a reviewer is least likely to open.",
      ).toBe(true);
    });
  }

  it("removes the key in SQL, and not in the row mapping", () => {
    const body = methodBody("private async", "selectRows");

    expect(
      /sql`[^`]*- 'oidcSubject'/s.test(body),
      "selectRows must remove the key with the jsonb `-` operator inside a `sql` template " +
        "(constraint 1). The value must never leave Postgres for a tenant: a row that " +
        "crosses the wire can reach a query log or an error dump, so a JS-side scrub has " +
        "already shipped it even though the response looks identical.",
    ).toBe(true);

    // Existence is not reach. The line above proves the template is *written*
    // in this method; `payload: auditLog.payload` in the select list would
    // leave it orphaned and still pass. Two other things also catch that —
    // behavioural step 2, and `noUnusedLocals` on the dead binding — but a
    // guard that names the constraint should hold the constraint.
    expect(
      /payload: payloadColumn,/.test(body),
      "the redacting expression must reach the select list: `payload: payloadColumn`. " +
        "Building it and then selecting the raw column returns the subject to every tenant.",
    ).toBe(true);

    // Everything after the drizzle query is the row mapping. A scrub there is
    // the failure this half of the test exists to name, and it returns exactly
    // the same bytes as the SQL version.
    //
    // The anchor is asserted BEFORE the slice, and that is not pedantry:
    // `indexOf` returns -1 when the anchor is gone, and `slice(-1)` yields the
    // body's last CHARACTER rather than the empty string — so a length check
    // after the fact can never fail, and the scan below would run against one
    // character and pass vacuously. §4.4: run the invariant against the shapes
    // you did not write.
    const mappingStart = body.indexOf("return rows.map(");
    expect(
      mappingStart,
      "selectRows must still end in a `return rows.map(`. If it was refactored to bind the " +
        "result first, re-anchor this scan — do not delete it: it is the only thing " +
        "rejecting a JS-side scrub.",
    ).toBeGreaterThan(-1);
    const mapping = body.slice(mappingStart);
    expect(
      /oidcSubject|\bdelete\b/.test(mapping),
      "the row mapping must not touch oidcSubject. Redacting there passes every behavioural " +
        "assertion and breaks constraint 1 — see this file's header.",
    ).toBe(false);
  });

  it("leaves the actor's email alone", () => {
    const body = methodBody("private async", "selectRows");

    expect(
      /actorEmail: users\.email,/.test(body),
      "Amendment 2 keeps `actorEmail`: an email answers \"who changed this\" and a tenant " +
        "is entitled to it for actions on its own data. Withholding it would stop the " +
        "ledger doing the job ADR 0021 built it for. If a later ruling redacts it too, " +
        "that is an amendment — change this expectation deliberately, with the ADR.",
    ).toBe(true);
  });
});
