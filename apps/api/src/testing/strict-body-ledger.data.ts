/**
 * `E7.1f` — the strictness ledger's DATA half: the reasons, and the decision recorded for every
 * request-body object node.
 *
 * **Split out of `strict-body-ledger.spec.ts` by `F3.35` Stage B, and the reason is mechanical
 * rather than editorial.** That file sat at 999 lines. `table` is the fifth `widgetType`, so its
 * write arm and its config are two new object nodes, and ADR 0029 Amendment 3 ruling 1 requires
 * a recorded decision for each — four lines, which put the file at 1004 and over the AGENTS.md
 * §4.5 1000-line cap that `tests/repo-invariants.test.ts` enforces.
 *
 * **The data moved and the assertions stayed**, rather than the reverse. `strict-body-ledger.spec.ts`
 * keeps the walker and the four checks, which are what ADR 0014 means by a `.spec`; this file is
 * a lookup table that grows by one entry per new object node and would otherwise push that file
 * over the cap again on the next widget type, the next endpoint, and the one after.
 *
 * Nothing here changed in the move except its location — the entries, their reasons and their
 * order are as they were.
 */

/**
 * One node's recorded decision.
 *
 * The asymmetry is the point. `strict: true` carries a `why` drawn from a small
 * closed set, because the reasons repeat and repeating them in prose 73 times
 * would hide the one that does not fit. `strict: false` carries free prose,
 * because a node left open is always open for its own reason and there is no
 * set to draw from.
 */
export type LedgerEntry =
  | { readonly strict: true; readonly why: string }
  | { readonly strict: false; readonly because: string };

/**
 * **The finding this audit produced — and the exception that corrected it.**
 *
 * `E7.1f` asked whether an unknown key is a caller error *per node*. For 66 of
 * the 73 the answer is yes, and that is a property of the codebase rather than
 * a shortcut: **every schema that needs open-ended data already has a
 * `z.record` for it** — `meta` on locations, assets, RTUs, organizations and
 * template drafts; `config` on an RTU and a notification channel;
 * `credentials`; `sourceDataKeyVars`; `dashboards`. `.strict()` does not close
 * any of those, so a caller with a legitimate key always has somewhere to put
 * it.
 *
 * **The remaining seven are the onboarding draft subtree, and they stay open.**
 * The first version of this ledger recorded them as strict on the strength of
 * that same reasoning, and it was wrong — not because the `z.record` argument
 * failed, but because "is this a caller error?" assumes there is one caller.
 * Those seven objects validate three producers (see `THREE_PRODUCERS`), and
 * strictness broke two of them. The question the audit should ask first is
 * **how many producers share this schema object**, and only then whether an
 * unknown key is an error for each of them.
 *
 * That is why the `strict: false` branch is in the type and asserted. It was
 * written expecting some future schema to need it; the need was already here.
 */
const CALLER_ERROR =
  "Every field this endpoint accepts is named in the schema, and open-ended data has a " +
  "`z.record` home that `.strict()` does not close. A key outside that set is a caller " +
  "error — today it is dropped and answered 200, which reads as 'accepted'.";

const CREDENTIAL =
  "Carries credential material (§9.6, ADR 0022/ADR 0012). An unknown key silently dropped " +
  "on a credential write is the case with the least excuse for being quiet.";

/**
 * The one place the audit came out the other way — see `onboarding.schema.ts`
 * for the full reasoning, which is deliberately in the source beside the
 * schema rather than only here.
 *
 * **This entry exists because the first version of this ledger was wrong.**
 * It recorded these seven nodes as strict, justified by an `apps/web`
 * round-trip. Two independent reviews found the justification was the wrong
 * question: these schema objects validate **three** producers, and only one is
 * an HTTP caller. Making them strict deadlocked the ADR 0022 onboarding commit
 * (the stored draft carries `_secrets`) and silently discarded the LLM's draft
 * patch on any invented key. Both were live regressions, and neither was
 * visible to `pnpm test` — `_secrets` is only written when
 * `CREDENTIAL_ENCRYPTION_KEY` is set, which CI does not set.
 */
const THREE_PRODUCERS =
  "NOT strict, deliberately. These objects validate three producers, not one: the PATCH " +
  "body, the STORED draft re-parsed by OnboardingValidateService (it carries a top-level " +
  "`_secrets` once any RTU credential is set, so strict deadlocks readyToCommit forever), " +
  "and the model's `draftPatch` in onboarding-chat.service.ts, where the result is " +
  "`.data ?? {}` so one invented key would discard the operator's whole turn while the " +
  "assistant still reports success. The wrapper `patchDraftBodySchema` IS strict and " +
  "declares only `draft`, so nothing rides alongside. What is given up: a key nested " +
  "inside `draft` is still dropped with a 200. Closing that needs one schema per producer.";

const ALREADY =
  "Strict before E7.1f, for a reason recorded beside the schema. Listed so the audit is " +
  "complete rather than only the nodes this item changed.";

const WIDGET_CONFIG =
  "F3.1a (ADR 0047). The shared config schema, tightened with `.strict()` at this write " +
  "boundary. The shared export stays tolerant because §4.8 requires a RESPONSE contract to " +
  "survive a field the server has added; an authoring body has the opposite obligation, and " +
  "one schema serves both because strictness is composed here rather than forked.";

const DASHBOARD_WIDGET_WRITE_CONFIG =
  "F3.1b (ADR 0047). Same composition as WIDGET_CONFIG above, at the live-dashboard write " +
  "boundary rather than the template-authoring one: the shared config schema imported from " +
  "@bms/shared, tightened with `.strict()` here (and, for the gauge arm, restated one level " +
  "so its `thresholds[]` items are strict too — `.strict()` does not descend). The shared " +
  "export stays tolerant per §4.8's response-survives-a-new-field rule; this write body has " +
  "the opposite obligation.";

const DASHBOARD_WIDGET_ARM =
  "F3.1b (ADR 0047). A live dashboard widget is authored by hand — through F3.1d eventually, " +
  "and through this API directly today — so an unknown key is an author's typo and must be " +
  "refused rather than silently dropped. Each of the four arms is strict, and cardinality " +
  "(ADR 0047 Amendment 2) is enforced on the `points` field, not by this node's own strictness.";

const DASHBOARD_CATALOG_BINDING =
  "F3.35 (ADR 0048 decision 4). DASHBOARD_WIDGET_ARM's reason, plus: a dropped sibling of " +
  "`params` is a parameter stored misspelled. `params` is validated per catalog entry and no " +
  "entry may declare a uuid (`tests/f3.35-metric-catalog-containment.test.ts`).";
const HEALTH_SECTION =
  "E1.3 (ADR 0050 decision 7). The `health` tier `E1.7` rejected, reopened as its consumer " +
  "landed. Strict at the authoring boundary for the reason the whole section exists: the " +
  "roll-up reads `weights` and `bands` by name, so a key it does not read is not a harmless " +
  "extra — it is an author believing they configured something. A misspelled `band` would " +
  "otherwise be stored, returned, and silently ignored by every score it was meant to change.";

const STRICT = (why: string): LedgerEntry => ({ strict: true, why });

/**
 * Every object node reachable from a registered **body** schema, with the
 * decision recorded for each. Keys are `WalkedNode.label`.
 *
 * Derived schemas appear separately even though one edit decides several:
 * `.partial()`, `.extend()` and `.omit()` all preserve `unknownKeys`, so
 * `createAssetBodySchema.partial()` is strict the moment its base is. They are
 * listed rather than collapsed because a reader auditing `updateRtuBodySchema`
 * must find it here, not deduce it.
 */
export const STRICTNESS_LEDGER: Record<string, LedgerEntry> = {
  alarmAckBodySchema: STRICT(CALLER_ERROR),
  alarmEnrichmentUpsertBodySchema: STRICT(ALREADY),
  assetPointCalcOverrideBodySchema: STRICT(
    "A PUT states the whole override and every field is required-but-nullable, where `null` " +
      "means inherit (ADR 0039 decisions 6-7). A key outside the five columns is a caller " +
      "error by construction: there is no sixth thing to override.",
  ),
  chatBodySchema: STRICT(CALLER_ERROR),
  closeWorkOrderBodySchema: STRICT(CALLER_ERROR),
  convertMaintenanceBodySchema: STRICT(CALLER_ERROR),
  createAssetBodySchema: STRICT(CALLER_ERROR),
  createAssetPointBodySchema: STRICT(CALLER_ERROR),
  createAssetTemplateBodySchema: STRICT(CALLER_ERROR),
  "createAssetTemplateBodySchema/content": STRICT(ALREADY),
  "createAssetTemplateBodySchema/content/alarms[]": STRICT(ALREADY),
  "createAssetTemplateBodySchema/content/alarms[]/philosophy": STRICT(ALREADY),
  "createAssetTemplateBodySchema/content/dashboards{}": STRICT(ALREADY),
  "createAssetTemplateBodySchema/content/dashboards{}/widgets[]|0": STRICT(
      "F3.1a (ADR 0047). A template dashboard widget is authored by hand, so an unknown key is " +
      "an author's typo and must be refused rather than silently dropped. The four arms are " +
      "strict here, and each `config` is the SHARED schema tightened at this boundary — " +
      "`radialGaugeConfigObjectSchema.strict()` and the exported `gaugeRangeIsOrdered` " +
      "predicate for the gauge, whose shared export is a ZodEffects with no `.strict()`. The " +
      "shared contracts stay tolerant because §4.8 requires a RESPONSE to survive a field the " +
      "server adds; strictness belongs on the write side, which is this one.",
    ),
  "createAssetTemplateBodySchema/content/dashboards{}/widgets[]|0/config": STRICT(WIDGET_CONFIG),
  "createAssetTemplateBodySchema/content/dashboards{}/widgets[]|0/config/thresholds[]": STRICT(WIDGET_CONFIG),
  "createAssetTemplateBodySchema/content/dashboards{}/widgets[]|1": STRICT(
      "F3.1a (ADR 0047). A template dashboard widget is authored by hand, so an unknown key is " +
      "an author's typo and must be refused rather than silently dropped. The four arms are " +
      "strict here, and each `config` is the SHARED schema tightened at this boundary — " +
      "`radialGaugeConfigObjectSchema.strict()` and the exported `gaugeRangeIsOrdered` " +
      "predicate for the gauge, whose shared export is a ZodEffects with no `.strict()`. The " +
      "shared contracts stay tolerant because §4.8 requires a RESPONSE to survive a field the " +
      "server adds; strictness belongs on the write side, which is this one.",
    ),
  "createAssetTemplateBodySchema/content/dashboards{}/widgets[]|1/config": STRICT(WIDGET_CONFIG),
  "createAssetTemplateBodySchema/content/dashboards{}/widgets[]|2": STRICT(
      "F3.1a (ADR 0047). A template dashboard widget is authored by hand, so an unknown key is " +
      "an author's typo and must be refused rather than silently dropped. The four arms are " +
      "strict here, and each `config` is the SHARED schema tightened at this boundary — " +
      "`radialGaugeConfigObjectSchema.strict()` and the exported `gaugeRangeIsOrdered` " +
      "predicate for the gauge, whose shared export is a ZodEffects with no `.strict()`. The " +
      "shared contracts stay tolerant because §4.8 requires a RESPONSE to survive a field the " +
      "server adds; strictness belongs on the write side, which is this one.",
    ),
  "createAssetTemplateBodySchema/content/dashboards{}/widgets[]|2/config": STRICT(WIDGET_CONFIG),
  "createAssetTemplateBodySchema/content/dashboards{}/widgets[]|3": STRICT(
      "F3.1a (ADR 0047). A template dashboard widget is authored by hand, so an unknown key is " +
      "an author's typo and must be refused rather than silently dropped. The four arms are " +
      "strict here, and each `config` is the SHARED schema tightened at this boundary — " +
      "`radialGaugeConfigObjectSchema.strict()` and the exported `gaugeRangeIsOrdered` " +
      "predicate for the gauge, whose shared export is a ZodEffects with no `.strict()`. The " +
      "shared contracts stay tolerant because §4.8 requires a RESPONSE to survive a field the " +
      "server adds; strictness belongs on the write side, which is this one.",
    ),
  "createAssetTemplateBodySchema/content/dashboards{}/widgets[]|3/config": STRICT(WIDGET_CONFIG),
  "createAssetTemplateBodySchema/content/health": STRICT(HEALTH_SECTION),
  "createAssetTemplateBodySchema/content/health/bands[]": STRICT(HEALTH_SECTION),
  "createAssetTemplateBodySchema/content/kpis[]": STRICT(ALREADY),
  "createAssetTemplateBodySchema/content/maintenance[]": STRICT(ALREADY),
  "createAssetTemplateBodySchema/points[]": STRICT(CALLER_ERROR),
  createDashboardBodySchema: STRICT(CALLER_ERROR),
  createLocationBodySchema: STRICT(CALLER_ERROR),
  createMaintenanceScheduleBodySchema: STRICT(CALLER_ERROR),
  createNotificationChannelBodySchema: STRICT(CALLER_ERROR),
  createOrganizationBodySchema: STRICT(CALLER_ERROR),
  createPointKeyBodySchema: STRICT(CALLER_ERROR),
  createRtuBodySchema: STRICT(CALLER_ERROR),
  createSessionBodySchema: STRICT(CALLER_ERROR),
  createWorkOrderBodySchema: STRICT(CALLER_ERROR),
  instantiateAssetsBodySchema: STRICT(CALLER_ERROR),
  "instantiateAssetsBodySchema/assets[]": STRICT(CALLER_ERROR),
  loginBodySchema: STRICT(CREDENTIAL),
  manualReadingsBodySchema: STRICT(ALREADY),
  "manualReadingsBodySchema/rows[]": STRICT(ALREADY),
  migrateAssetsBodySchema: STRICT(CALLER_ERROR),
  patchDraftBodySchema: STRICT(CALLER_ERROR),
  "patchDraftBodySchema/draft": { strict: false, because: THREE_PRODUCERS },
  "patchDraftBodySchema/draft/assetPoints[]": { strict: false, because: THREE_PRODUCERS },
  "patchDraftBodySchema/draft/assets[]": { strict: false, because: THREE_PRODUCERS },
  "patchDraftBodySchema/draft/location": { strict: false, because: THREE_PRODUCERS },
  "patchDraftBodySchema/draft/onboardingMeta": { strict: false, because: THREE_PRODUCERS },
  "patchDraftBodySchema/draft/pointKeys[]": { strict: false, because: THREE_PRODUCERS },
  "patchDraftBodySchema/draft/rtus[]": { strict: false, because: THREE_PRODUCERS },
  putDashboardWidgetsBodySchema: STRICT(CALLER_ERROR),
  "putDashboardWidgetsBodySchema/widgets[]|0": STRICT(DASHBOARD_WIDGET_ARM),
  "putDashboardWidgetsBodySchema/widgets[]|0/config": STRICT(DASHBOARD_WIDGET_WRITE_CONFIG),
  "putDashboardWidgetsBodySchema/widgets[]|0/config/thresholds[]": STRICT(DASHBOARD_WIDGET_WRITE_CONFIG),
  "putDashboardWidgetsBodySchema/widgets[]|0/points[]": STRICT(CALLER_ERROR),
  "putDashboardWidgetsBodySchema/widgets[]|0/sources[]": STRICT(DASHBOARD_CATALOG_BINDING),
  "putDashboardWidgetsBodySchema/widgets[]|1": STRICT(DASHBOARD_WIDGET_ARM),
  "putDashboardWidgetsBodySchema/widgets[]|1/config": STRICT(DASHBOARD_WIDGET_WRITE_CONFIG),
  "putDashboardWidgetsBodySchema/widgets[]|2": STRICT(DASHBOARD_WIDGET_ARM),
  "putDashboardWidgetsBodySchema/widgets[]|2/config": STRICT(DASHBOARD_WIDGET_WRITE_CONFIG),
  "putDashboardWidgetsBodySchema/widgets[]|3": STRICT(DASHBOARD_WIDGET_ARM),
  "putDashboardWidgetsBodySchema/widgets[]|3/config": STRICT(DASHBOARD_WIDGET_WRITE_CONFIG),
  // Arm 4 is `table` (`F3.35` Stage B, ADR 0048 decision 5). Same ruling as the four arms
  // above and for the same reason — a widget arm and its config are both authoring shapes,
  // where an unknown key is an author's typo rather than a field a newer client added.
  "putDashboardWidgetsBodySchema/widgets[]|4": STRICT(DASHBOARD_WIDGET_ARM),
  "putDashboardWidgetsBodySchema/widgets[]|4/config": STRICT(DASHBOARD_WIDGET_WRITE_CONFIG),
  reorderWorkOrdersBodySchema: STRICT(CALLER_ERROR),
  "reorderWorkOrdersBodySchema/items[]": STRICT(CALLER_ERROR),
  ruleDraftBodySchema: STRICT(CALLER_ERROR),
  "ruleDraftBodySchema/action": STRICT(CALLER_ERROR),
  "ruleDraftBodySchema/condition|0": STRICT(CALLER_ERROR),
  "ruleDraftBodySchema/condition|1": STRICT(CALLER_ERROR),
  ruleLifecycleBodySchema: STRICT(CALLER_ERROR),
  rulePreviewBodySchema: STRICT(CALLER_ERROR),
  "rulePreviewBodySchema/action": STRICT(CALLER_ERROR),
  "rulePreviewBodySchema/condition|0": STRICT(CALLER_ERROR),
  "rulePreviewBodySchema/condition|1": STRICT(CALLER_ERROR),
  ruleToggleBodySchema: STRICT(CALLER_ERROR),
  ruleUpdateBodySchema: STRICT(CALLER_ERROR),
  "ruleUpdateBodySchema/action": STRICT(CALLER_ERROR),
  "ruleUpdateBodySchema/condition|0": STRICT(CALLER_ERROR),
  "ruleUpdateBodySchema/condition|1": STRICT(CALLER_ERROR),
  setAssetGroupMemberRoleBodySchema: STRICT(
    "The body has exactly one field, so there is no second thing to set and an unknown key " +
      "is a caller error by construction. The mistake it catches is silent rather than " +
      'noisy: `{"role":null,"roleCode":"chiller"}` from a caller who meant to SET `chiller` ' +
      "would have `roleCode` stripped, CLEAR the role instead, and answer 200 — a " +
      "destructive read of an additive intent (`F3.37`, ADR 0049 decision 5).",
  ),
  setCredentialsBodySchema: STRICT(ALREADY),
  setRuleNotificationsBodySchema: STRICT(CALLER_ERROR),
  updateAssetBodySchema: STRICT(CALLER_ERROR),
  updateAssetPointBodySchema: STRICT(CALLER_ERROR),
  updateAssetTemplateBodySchema: STRICT(CALLER_ERROR),
  updateDashboardBodySchema: STRICT(CALLER_ERROR),
  "updateAssetTemplateBodySchema/content": STRICT(ALREADY),
  "updateAssetTemplateBodySchema/content/alarms[]": STRICT(ALREADY),
  "updateAssetTemplateBodySchema/content/alarms[]/philosophy": STRICT(ALREADY),
  "updateAssetTemplateBodySchema/content/dashboards{}": STRICT(ALREADY),
  "updateAssetTemplateBodySchema/content/dashboards{}/widgets[]|0": STRICT(
      "F3.1a (ADR 0047). A template dashboard widget is authored by hand, so an unknown key is " +
      "an author's typo and must be refused rather than silently dropped. The four arms are " +
      "strict here, and each `config` is the SHARED schema tightened at this boundary — " +
      "`radialGaugeConfigObjectSchema.strict()` and the exported `gaugeRangeIsOrdered` " +
      "predicate for the gauge, whose shared export is a ZodEffects with no `.strict()`. The " +
      "shared contracts stay tolerant because §4.8 requires a RESPONSE to survive a field the " +
      "server adds; strictness belongs on the write side, which is this one.",
    ),
  "updateAssetTemplateBodySchema/content/dashboards{}/widgets[]|0/config": STRICT(WIDGET_CONFIG),
  "updateAssetTemplateBodySchema/content/dashboards{}/widgets[]|0/config/thresholds[]": STRICT(WIDGET_CONFIG),
  "updateAssetTemplateBodySchema/content/dashboards{}/widgets[]|1": STRICT(
      "F3.1a (ADR 0047). A template dashboard widget is authored by hand, so an unknown key is " +
      "an author's typo and must be refused rather than silently dropped. The four arms are " +
      "strict here, and each `config` is the SHARED schema tightened at this boundary — " +
      "`radialGaugeConfigObjectSchema.strict()` and the exported `gaugeRangeIsOrdered` " +
      "predicate for the gauge, whose shared export is a ZodEffects with no `.strict()`. The " +
      "shared contracts stay tolerant because §4.8 requires a RESPONSE to survive a field the " +
      "server adds; strictness belongs on the write side, which is this one.",
    ),
  "updateAssetTemplateBodySchema/content/dashboards{}/widgets[]|1/config": STRICT(WIDGET_CONFIG),
  "updateAssetTemplateBodySchema/content/dashboards{}/widgets[]|2": STRICT(
      "F3.1a (ADR 0047). A template dashboard widget is authored by hand, so an unknown key is " +
      "an author's typo and must be refused rather than silently dropped. The four arms are " +
      "strict here, and each `config` is the SHARED schema tightened at this boundary — " +
      "`radialGaugeConfigObjectSchema.strict()` and the exported `gaugeRangeIsOrdered` " +
      "predicate for the gauge, whose shared export is a ZodEffects with no `.strict()`. The " +
      "shared contracts stay tolerant because §4.8 requires a RESPONSE to survive a field the " +
      "server adds; strictness belongs on the write side, which is this one.",
    ),
  "updateAssetTemplateBodySchema/content/dashboards{}/widgets[]|2/config": STRICT(WIDGET_CONFIG),
  "updateAssetTemplateBodySchema/content/dashboards{}/widgets[]|3": STRICT(
      "F3.1a (ADR 0047). A template dashboard widget is authored by hand, so an unknown key is " +
      "an author's typo and must be refused rather than silently dropped. The four arms are " +
      "strict here, and each `config` is the SHARED schema tightened at this boundary — " +
      "`radialGaugeConfigObjectSchema.strict()` and the exported `gaugeRangeIsOrdered` " +
      "predicate for the gauge, whose shared export is a ZodEffects with no `.strict()`. The " +
      "shared contracts stay tolerant because §4.8 requires a RESPONSE to survive a field the " +
      "server adds; strictness belongs on the write side, which is this one.",
    ),
  "updateAssetTemplateBodySchema/content/dashboards{}/widgets[]|3/config": STRICT(WIDGET_CONFIG),
  "updateAssetTemplateBodySchema/content/health": STRICT(HEALTH_SECTION),
  "updateAssetTemplateBodySchema/content/health/bands[]": STRICT(HEALTH_SECTION),
  "updateAssetTemplateBodySchema/content/kpis[]": STRICT(ALREADY),
  "updateAssetTemplateBodySchema/content/maintenance[]": STRICT(ALREADY),
  "updateAssetTemplateBodySchema/points[]": STRICT(CALLER_ERROR),
  updateLocationBodySchema: STRICT(CALLER_ERROR),
  updateMaintenanceScheduleBodySchema: STRICT(CALLER_ERROR),
  updateNotificationChannelBodySchema: STRICT(
    "The node E7.1f was raised for. `PATCH {\"name\":\"x\",\"organizationId\":\"<other>\"}` " +
      "answered 200 with the tenancy unchanged. Containment was never in doubt — " +
      "`ChannelsService.update` reads the organization from `loadExistingForWrite(id)` and " +
      "never from the body — but a caller that is not apps/web reads 200 as 'the move " +
      "succeeded'. Note the gap was only ever the mixed body: `{\"organizationId\":\"…\"}` " +
      "alone already 400d, because the non-empty `.refine()` runs after stripping.",
  ),
  updateOrganizationBodySchema: STRICT(CALLER_ERROR),
  updatePointKeyBodySchema: STRICT(CALLER_ERROR),
  updateRtuBodySchema: STRICT(CALLER_ERROR),
  updateWorkOrderStatusBodySchema: STRICT(CALLER_ERROR),
};
