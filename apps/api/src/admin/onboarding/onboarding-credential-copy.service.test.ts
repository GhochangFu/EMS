import { afterEach, beforeEach, describe, it } from "vitest";

import * as S from "./onboarding-credential-copy.service.spec";

const KEY_ENV = "CREDENTIAL_ENCRYPTION_KEY";

describe("F4.339 — the credential copy's early refusals", () => {
  let previous: string | undefined;
  beforeEach(() => {
    previous = process.env[KEY_ENV];
    process.env[KEY_ENV] = S.TEST_KEY;
  });
  afterEach(() => {
    if (previous === undefined) delete process.env[KEY_ENV];
    else process.env[KEY_ENV] = previous;
  });

  it("answers 503 with no key loaded", () => {
    delete process.env[KEY_ENV];
    return S.noKeyIsA503();
  });
  it("answers 409 for a source with no stored credential", () => S.aSourceWithNoCredentialIsA409());
  it("answers 409 for a key version this API cannot read (R7)", () => S.anUnreadableKeyVersionIsA409());
  it("answers 409 for a target on another broker", () => S.aTargetOnAnotherBrokerIsA409());
});
