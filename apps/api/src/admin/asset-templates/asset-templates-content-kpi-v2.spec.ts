import { templateContentSchema } from "./asset-templates-content.schema";

/**
 * `templateKpiSchema` under `bms-calc-v2` — ADR 0055 decision 2 and the two
 * `F2.9` rulings that decided what it means.
 *
 * **Q3.** The owner overruled the plan's recommendation to keep KPIs at `v1`:
 * `templateKpiSchema.dialect` widens to every member of `CALC_DIALECTS`,
 * because that is what decision 2 literally says. Note what the ruling
 * accepts along with it — a stored `v2` KPI is admitted by the schema while
 * nothing evaluates it, since KPI evaluation is read-time and from local
 * values (ADR 0037 §"Not in this ADR"). These cases are about what the schema
 * stores, never about a number anybody computes.
 *
 * **Q3b.** `pointKeys` keeps its meaning: it lists the **local** point keys the
 * expression references. A key that appears solely inside an aggregate
 * (`sum({kw} @site)`) or a qualified reference (`{TX_01.kwh}`) is exempt from
 * **both** directions of the cross-check, because the asset it resolves
 * against is not known until evaluation time.
 *
 * **This file exists to prove the exemption is a narrowing and not a hole.**
 * The case that carries that weight is `SITE_RATIO_BAD`: were the rule
 * implemented as "skip the pointKeys check under `v2`", it would be accepted.
 * Mutate the schema that way and it must go red.
 *
 * Separate from `asset-templates-content.schema.spec.ts` only because that file
 * sits against the §4.5 1000-line cap.
 */
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Why a payload was refused, so a failing assertion says what the author is
 * told rather than only that they were told. Empty when it was accepted. */
function whyRefused(content: unknown): string {
  const result = templateContentSchema.safeParse(content);
  return result.success ? "" : result.error.issues.map((issue) => issue.message).join(" | ");
}

function accepts(content: unknown, message: string): void {
  assert(
    templateContentSchema.safeParse(content).success,
    `${message} — refused with: ${whyRefused(content)}`,
  );
}

function rejects(content: unknown, message: string): void {
  assert(templateContentSchema.safeParse(content).success === false, message);
}

/** The ADR's headline example, as a KPI. Every reference is cross-asset, so it
 * has no local point keys at all. */
const CROSS_ONLY = {
  code: "SITE_RATIO",
  name: "Site IT load ratio",
  pointKeys: [] as string[],
  expression: "sum({kw} @site) / sum({kw} @group('IT_LOAD'))",
  dialect: "bms-calc-v2",
};

export function runTemplateKpiV2Tests(): void {
  accepts(
    { kpis: [CROSS_ONLY] },
    "a v2 KPI whose every reference is cross-asset must parse with an empty pointKeys",
  );

  // The anti-vacuity case. `kw` appears twice in the expression and in no LOCAL
  // reference, so the reverse direction of the cross-check must still refuse a
  // KPI that declares it.
  rejects(
    { kpis: [{ ...CROSS_ONLY, code: "SITE_RATIO_BAD", pointKeys: ["kw"] }] },
    "a v2 KPI declaring a pointKey that appears only inside an aggregate must fail — the " +
      "cross-asset exemption narrows the check to local refs, it does not disable it",
  );

  accepts(
    {
      kpis: [
        {
          ...CROSS_ONLY,
          code: "SITE_RATIO_MIXED",
          pointKeys: ["kw"],
          expression: "sum({kw} @site) + {kw}",
        },
      ],
    },
    "a v2 KPI mixing a local ref and an aggregate over the same key must parse — the local " +
      "occurrence is what pointKeys covers",
  );

  // The forward direction, unchanged: a local ref missing from pointKeys is
  // still `unknown_reference`, under `v2` exactly as under `v1`.
  rejects(
    {
      kpis: [
        {
          ...CROSS_ONLY,
          code: "SITE_RATIO_UNDECLARED",
          pointKeys: [],
          expression: "sum({kw} @site) + {kw}",
        },
      ],
    },
    "a v2 KPI whose LOCAL ref is absent from pointKeys must fail — the forward direction of " +
      "the cross-check is untouched by the exemption",
  );

  // `dialect` is a gate, not a label: the same expression under `v1` is still
  // refused at the `@`, and the message must not echo the expression.
  const asV1 = { kpis: [{ ...CROSS_ONLY, code: "SITE_RATIO_V1", dialect: "bms-calc-v1" }] };
  rejects(asV1, "the v2 aggregate syntax must still be refused when the KPI declares bms-calc-v1");
  assert(
    !whyRefused(asV1).includes("IT_LOAD"),
    `the refusal must not echo the expression, got: ${whyRefused(asV1)}`,
  );

  // A KPI that references nothing at all is still refused — the rule the
  // `.min(1)` array bound used to carry, moved into the refinement so it can
  // see that a cross-asset reference counts as a reference.
  rejects(
    { kpis: [{ ...CROSS_ONLY, code: "SITE_RATIO_EMPTY", expression: "2 + 2" }] },
    "a v2 KPI with no pointKeys and no reference of any kind must fail",
  );
  rejects(
    {
      kpis: [
        {
          ...CROSS_ONLY,
          code: "V1_EMPTY",
          dialect: "bms-calc-v1",
          expression: "2 + 2",
        },
      ],
    },
    "a v1 KPI with an empty pointKeys must still fail — unchanged by the v2 widening",
  );
  rejects(
    {
      kpis: [
        {
          ...CROSS_ONLY,
          code: "UNVALIDATED_EMPTY",
          dialect: "unvalidated",
          expression: "anything at all",
        },
      ],
    },
    "an unvalidated KPI with an empty pointKeys must still fail — it is never parsed, so " +
      "pointKeys is the only record of what it reads",
  );
}
