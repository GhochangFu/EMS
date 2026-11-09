import { describe, it } from "vitest";

import * as S from "./onboarding-session-lock.service.spec";

describe("F4.339 — the draft lock's early refusals", () => {
  it("refuses a reason that looks like a secret, before any read (review L2)", () => S.aReasonThatLooksLikeASecretIsRefused());
  it("refuses anyone but a global administrator first", () => S.aNonGlobalAdminIsRefusedFirst());
});
