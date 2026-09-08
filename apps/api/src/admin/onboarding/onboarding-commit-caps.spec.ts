import { BadRequestException, ForbiddenException } from "@nestjs/common";

import { MAX_ONBOARDING_ASSETS } from "@bms/shared";
import type { JwtPayload, OnboardingDraft } from "@bms/shared";

import { OnboardingCommitService } from "./onboarding-commit.service";
import { OnboardingValidateService } from "./onboarding-validate.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function times<T>(count: number, build: (index: number) => T): T[] {
  return Array.from({ length: count }, (_unused, index) => build(index));
}

const JWT: JwtPayload = {
  sub: "u-1",
  email: "someone@bms.local",
  name: "someone",
  role: "admin",
};

/** The plant-domain codes the stubbed vocabulary treats as live rows. */
const LIVE_DOMAINS = ["electrical", "hvac"];

function assetAt(index: number, domain = "electrical"): NonNullable<OnboardingDraft["assets"]>[number] {
  return {
    rtuIndex: 0,
    code: `ASSET-${index}`,
    name: `Asset ${index}`,
    siteName: "Site",
    domain,
  };
}

/** Assets in the given domains, in order — the fixture the de-duplication is measured on. */
function assetsInDomains(domains: readonly string[]): NonNullable<OnboardingDraft["assets"]> {
  return domains.map((domain, index) => assetAt(index, domain));
}

type SelectChain = {
  from: () => SelectChain;
  where: () => SelectChain;
  limit: () => Promise<unknown[]>;
};

type Harness = {
  service: OnboardingCommitService;
  /** Every code `commit` handed to `assertAssetDomain`, in call order. */
  domainCalls: string[];
  /** How many times `commit` asked the validate service for a verdict. */
  validateCalls: () => number;
};

/**
 * `OnboardingCommitService` with only the collaborators the cases below reach.
 *
 * Every case throws **before** `withTenant` opens, so `tenantDb` and the audit
 * writer are `{} as never`: reaching either of them is itself a failure, and a
 * `TypeError` naming the missing method is a clearer report than a stub that
 * quietly accepts the call. The Drizzle stand-in is narrower than `fakeDb` in
 * `onboarding-credentials.spec.ts` for the same reason — the only database work
 * `commit` does before the transaction is the four-link session read.
 */
function buildService(opts: {
  draft: unknown;
  readyToCommit: boolean;
  canManage?: boolean;
}): Harness {
  const session = {
    id: "s-1",
    organizationId: "org-1",
    status: "draft",
    draft: opts.draft,
  };
  const chain: SelectChain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve([session]),
  };
  const fleetDb = { select: () => chain } as never;

  const accessControl = {
    requireMasterDataUser: () => Promise.resolve({ id: "u-1", role: "admin" }),
    canManageOrganization: () => Promise.resolve(opts.canManage ?? true),
  } as never;

  const domainCalls: string[] = [];
  const vocabularies = {
    assertAssetDomain: (code: string) => {
      domainCalls.push(code);
      if (!LIVE_DOMAINS.includes(code)) {
        // The real `VocabulariesService.assertAssetDomain` names the code it
        // refused, and the message is what the operator is told to repair — so
        // the stub names it too, and the cases below read it.
        return Promise.reject(new BadRequestException(`Unknown domain code "${code}"`));
      }
      return Promise.resolve();
    },
  } as never;

  let validateCalls = 0;
  const validateService = {
    validate: () => {
      validateCalls += 1;
      return {
        valid: opts.readyToCommit,
        errors: opts.readyToCommit
          ? []
          : [{ path: "assets", message: "Array must contain at most N element(s)" }],
        readyToCommit: opts.readyToCommit,
        suggestedPhase: "review",
      };
    },
  } as never;

  const service = new OnboardingCommitService(
    fleetDb,
    {} as never,
    accessControl,
    {} as never,
    validateService,
    vocabularies,
  );
  return { service, domainCalls, validateCalls: () => validateCalls };
}

/** The error a call refused with, or a failure if it did not refuse at all. */
async function rejectionOf(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (error) {
    return error;
  }
  throw new Error("commit resolved where it had to refuse");
}

function messageOf(error: unknown): string {
  return String((error as { message?: unknown }).message);
}

/** A draft one item over the asset cap, and nothing else — every case starts here. */
function overCapDraft(): OnboardingDraft {
  return { assets: times(MAX_ONBOARDING_ASSETS + 1, (index) => assetAt(index)) };
}

/**
 * `F4.103` — an over-cap stored draft is refused by the count check, and the
 * check runs **before** `validate`.
 *
 * **The hazard this pins.** The ruling asks for the refusal "before the
 * transaction opens", and that admits a placement which is dead code: with the
 * API schema's `.max()`, `OnboardingValidateService.validate` already fails this
 * draft, so `commit` throws `"Draft is not ready to commit"` and anything below
 * that line is unreachable. The first block below pins that as a measured fact
 * rather than a claim in a docblock — the real validate service, no database, no
 * stub.
 *
 * **Three assertions hold the ordering, and each covers a different move.**
 * Measured, not asserted in prose: with the check moved below `validate`, the
 * run fails first on the assertion that the message names the array, with
 * `got "Draft is not ready to commit"`, and the call-count assertion is never
 * reached. So the message assertions are not the weak half — they already catch
 * that move.
 *
 * 1. The message names the array, the count it found and the cap it applied.
 *    Red as soon as the check moves anywhere below `validate`.
 * 2. The message is **not** `"Draft is not ready to commit"`. Red on the same
 *    move, and it is the one that says *which* gate answered rather than only
 *    that the answer was wrong.
 * 3. `validate` was called **zero** times. This is the only assertion that
 *    survives the move the other two cannot see: a refactor that calls
 *    `validate` for something other than its verdict — `suggestedPhase`, say —
 *    and still throws the count sentence. Both message assertions stay green,
 *    the per-item `safeParse` walk this placement exists to avoid is spent
 *    anyway, and only the call count reports it.
 */
export async function assertOverCapDraftIsRefusedBeforeValidate(): Promise<void> {
  // The stub's `readyToCommit: false` is not invented. This is what the real
  // service answers for this very draft, and it answers it *because of the
  // cap*: the same assets one item fewer raise no `assets` issue at all.
  const validateService = new OnboardingValidateService();
  const atCap: OnboardingDraft = { assets: times(MAX_ONBOARDING_ASSETS, (index) => assetAt(index)) };
  assert(
    validateService.validate(atCap).errors.filter((error) => error.path === "assets").length === 0,
    "a draft at the asset cap raises no array-level issue — the cap is a ceiling, not a target",
  );
  const realVerdict = validateService.validate(overCapDraft());
  assert(
    realVerdict.errors.some((error) => error.path === "assets"),
    `the real validate service reports the over-cap array, got ${JSON.stringify(realVerdict.errors)}`,
  );
  assert(
    realVerdict.readyToCommit === false,
    "the real validate service refuses an over-cap draft — so a count check placed after it is unreachable",
  );

  const { service, domainCalls, validateCalls } = buildService({
    draft: overCapDraft(),
    readyToCommit: false,
  });
  const error = await rejectionOf(service.commit(JWT, "s-1"));
  assert(
    error instanceof BadRequestException,
    `an over-cap draft is a bad request, got ${String(error)}`,
  );

  const message = messageOf(error);
  assert(message.includes("assets"), `the refusal names the array to shorten, got "${message}"`);
  assert(
    message.includes(String(MAX_ONBOARDING_ASSETS + 1)),
    `the refusal names the count it found, got "${message}"`,
  );
  assert(
    message.includes(String(MAX_ONBOARDING_ASSETS)),
    `the refusal names the cap it applied, got "${message}"`,
  );
  assert(
    !message.includes("Draft is not ready to commit"),
    `the count check answers, not the validation gate below it, got "${message}"`,
  );
  assert(
    validateCalls() === 0,
    `the count check runs before validate, which was called ${validateCalls()} time(s) — below it the check is dead code`,
  );
  assert(
    domainCalls.length === 0,
    `an over-cap draft buys no vocabulary round trips, got ${domainCalls.length}`,
  );
}

/**
 * `F4.103` — the count check sits **below** the two access gates, so an
 * over-cap draft outside the caller's scope is still answered by the scope
 * refusal.
 *
 * Placed above them, the count sentence would confirm to an out-of-scope caller
 * that the session exists and roughly how large its estate is.
 */
export async function assertOverCapDraftStillLosesToTheAccessGate(): Promise<void> {
  const { service, validateCalls } = buildService({
    draft: overCapDraft(),
    readyToCommit: false,
    canManage: false,
  });
  const error = await rejectionOf(service.commit(JWT, "s-1"));
  assert(
    error instanceof ForbiddenException,
    `an out-of-scope organization is refused before its draft is counted, got ${String(error)}`,
  );
  const message = messageOf(error);
  assert(
    message.includes("outside your access scope"),
    `the scope refusal is the answer, got "${message}"`,
  );
  assert(
    !message.includes("one onboarding session may commit"),
    `the count sentence must not reach a caller outside the scope, got "${message}"`,
  );
  assert(validateCalls() === 0, "nothing below the access gate runs");
}

/**
 * `F4.103` — the pre-commit plant-domain check costs one round trip per
 * *distinct* domain, not one per asset.
 *
 * `assertAssetDomain` is an uncached `SELECT … LIMIT 1`, so the loop this
 * replaces sent the identical query once per asset. Six assets over two domains
 * measured four calls before this change and measures two after it, and the
 * refusal still names the unknown code.
 */
export async function assertDomainCheckIsDeduplicated(): Promise<void> {
  const { service, domainCalls } = buildService({
    draft: {
      assets: assetsInDomains(["electrical", "electrical", "electrical", "bogus", "bogus", "bogus"]),
    },
    readyToCommit: true,
  });
  const error = await rejectionOf(service.commit(JWT, "s-1"));
  assert(
    error instanceof BadRequestException,
    `an unknown plant domain is a bad request, got ${String(error)}`,
  );
  assert(
    messageOf(error).includes("bogus"),
    `the refusal still names the code to repair, got "${messageOf(error)}"`,
  );
  assert(
    domainCalls.length === 2,
    `six assets over two domains cost two vocabulary reads, got ${domainCalls.length}: ${JSON.stringify(domainCalls)}`,
  );
  assert(
    JSON.stringify(domainCalls) === JSON.stringify(["electrical", "bogus"]),
    `each distinct domain is asked about once, got ${JSON.stringify(domainCalls)}`,
  );
}

/**
 * `F4.103` — de-duplication keeps first-appearance order, so the code the
 * operator is told to fix is the same one the per-asset loop named.
 *
 * A `Set` preserves insertion order and a sort would not; nothing else in this
 * file would go red if the list were sorted or reversed, and the operator would
 * be sent to repair the wrong cell.
 */
export async function assertDeduplicationKeepsTheFirstOffender(): Promise<void> {
  const { service, domainCalls } = buildService({
    draft: { assets: assetsInDomains(["electrical", "bogus-a", "electrical", "bogus-b"]) },
    readyToCommit: true,
  });
  const error = await rejectionOf(service.commit(JWT, "s-1"));
  const message = messageOf(error);
  assert(
    message.includes("bogus-a") && !message.includes("bogus-b"),
    `the first unknown domain in the draft's own order is the one reported, got "${message}"`,
  );
  assert(
    JSON.stringify(domainCalls) === JSON.stringify(["electrical", "bogus-a"]),
    `the check stops at the first unknown code and asks nothing twice, got ${JSON.stringify(domainCalls)}`,
  );
}

/**
 * `F4.103` — a stored draft holding the JSON value `null` reaches the count
 * check, and the `?? {}` there is what keeps it a 400 rather than a crash.
 *
 * `packages/db/src/schema/bms-schema.ts:547` is
 * `jsonb("draft").notNull().default({})`: `NOT NULL` rules out SQL NULL, and
 * says nothing at all about the JSON scalar `null`, which is a perfectly legal
 * jsonb value. It arrives here as `null` in spite of the `as OnboardingDraft`
 * cast, and without the `?? {}` the count check would read `.length` off it and
 * answer a `TypeError` — a 500 — where the answer has always been "the draft is
 * not ready". The `?? {}` was written with that reasoning and nothing measured
 * it; this is the case that does.
 */
export async function assertANullDraftIsStillTheValidationRefusal(): Promise<void> {
  const { service, validateCalls } = buildService({ draft: null, readyToCommit: false });
  const error = await rejectionOf(service.commit(JWT, "s-1"));
  assert(
    error instanceof BadRequestException,
    `a null draft is a bad request, not a crash, got ${String(error)}`,
  );
  const message = messageOf(error);
  assert(
    message === "Draft is not ready to commit",
    `an empty draft is answered by the validation gate, not the count check, got "${message}"`,
  );
  assert(
    validateCalls() === 1,
    `the count check passed a null draft through to validate, which ran ${validateCalls()} time(s)`,
  );
}
