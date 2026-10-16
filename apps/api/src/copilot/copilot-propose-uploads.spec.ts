import { expect } from "vitest";

import type { ResolvedIdentity } from "../auth/identity-resolver";
import { bodyHash } from "./body-hash";
import { PROPOSE_ROLE_ERROR } from "./copilot-propose-tools";
import { proposeHarness } from "./copilot-propose-tools.spec";
import { VALID_SVG } from "./copilot-upload-prepare.spec";

/**
 * `F3.87` PR 6b (ADR 0099 Amendment 3 A3) — the propose tool over the real
 * `mimicSymbol.upload` entry (the fixture-entry cases live in
 * `copilot-propose-tools.spec.ts`). Vitest entry point: the sibling `.test.ts`.
 */

const ORG_X = "00000000-0000-4000-8000-0000000000aa";
const USER = "11111111-1111-4111-8111-111111111111";
const LIBRARY = "66666666-6666-4666-8666-666666666666";

/**
 * `F3.87` PR 6b — the real `mimicSymbol.upload` entry: the model's body is
 * the text fields plus `svg`; the stored body is the prepared one (the route's
 * text fields, the file's name and SHA-256, the text under `svgText`), on the
 * library path, and the hash leaves `svgText` out.
 */
export async function theRealUploadEntryStoresThePreparedBody(): Promise<void> {
  const h = proposeHarness({ target: { organizationId: ORG_X, organizationName: "Org X", targetName: "Plant" } });
  const result = await h.tools.dispatch(
    "propose_mimicSymbol_upload",
    { id: LIBRARY, body: { name: "pump-x", label: "Pump X", group: "water", svg: { kind: "text", text: VALID_SVG } } },
    h.ctx(),
  );
  expect(result.ok).toBe(true);
  const stored = h.stored[0];
  expect(stored?.path).toBe(`/api/v1/mimic-symbol-libraries/${LIBRARY}/symbols`);
  expect(stored?.body).toEqual({
    name: "pump-x",
    label: "Pump X",
    group: "water",
    filename: "pump-x.svg",
    fileSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    svgText: VALID_SVG,
  });
  const { svgText: _text, ...hashed } = stored?.body as Record<string, unknown>;
  expect(stored?.bodyHash).toBe(bodyHash(hashed));
  expect(stored?.summary).toBe('Upload the symbol "Pump X" (pump-x) to the library "Plant".');
}

/** A location admin is refused the real library entries by the role guard (`offeredTo`). */
export async function aLocationAdminIsRefusedTheRealUploadEntry(): Promise<void> {
  const h = proposeHarness();
  const result = await h.tools.dispatch(
    "propose_mimicSymbol_upload",
    { id: LIBRARY, body: { name: "pump-x", label: "Pump X", svg: { kind: "text", text: VALID_SVG } } },
    h.ctx({ identity: { id: USER, role: "location_admin", organizationId: ORG_X } as ResolvedIdentity }),
  );
  expect(result).toEqual({ ok: false, error: PROPOSE_ROLE_ERROR });
  expect(h.stored).toEqual([]);
}
