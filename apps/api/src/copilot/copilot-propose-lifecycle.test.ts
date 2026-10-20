import { describe, it } from "vitest";

import {
  anArchiveOfADraftStoresNothing,
  anEditOfAPublishedTemplateStoresNothing,
  anInstantiateOfADraftAssetTemplateStoresNothing,
  aPublishOfAPublishedDashboardTemplateStoresNothing,
  aTemplateTargetWithoutAStatusIsRefused,
  theStatusCheckRunsAfterTheTargetCheck,
  theStatusCheckRunsBeforeTheContentMerge,
} from "./copilot-propose-lifecycle.spec";

describe("F4.246 — a template proposal refuses a status the route would refuse", () => {
  it("refuses an edit of a published asset template", () => anEditOfAPublishedTemplateStoresNothing());
  it("refuses a publish of a published dashboard template", () => aPublishOfAPublishedDashboardTemplateStoresNothing());
  it("refuses an archive of a draft asset template", () => anArchiveOfADraftStoresNothing());
  it("refuses an instantiate of a draft asset template with the route's two sentences", () =>
    anInstantiateOfADraftAssetTemplateStoresNothing());
  it("fails closed on a template target without a status", () => aTemplateTargetWithoutAStatusIsRefused());
  it("answers the target refusal first for a row outside the allowed set", () => theStatusCheckRunsAfterTheTargetCheck());
  it("answers the lifecycle refusal before the stored-content merge", () => theStatusCheckRunsBeforeTheContentMerge());
});
