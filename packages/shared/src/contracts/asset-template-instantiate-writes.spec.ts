import { instantiateAssetsBodySchema } from "./asset-template-instantiate-writes";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Zod contract for instantiation (`F2.2`, ADR 0015 §6 as amended 2026-08-05).
 *
 * The exclusive target is the amendment's whole point: ADR 0018 made
 * `assets.rtu_id` nullable, so the original RTU-only payload could not express
 * a gateway-less asset. Both-supplied is rejected rather than resolved by
 * precedence — the two disagree the moment an RTU moves between locations.
 */
export function runInstantiateSchemaTests(): void {
  const RTU_ID = "22222222-2222-4222-8222-222222222222";
  const LOCATION_ID = "33333333-3333-4333-8333-333333333333";
  const oneAsset = [{ code: "PLANTA-CH-01", name: "Chiller 01" }];

  // ---- the exclusive target ------------------------------------------------

  assert(
    instantiateAssetsBodySchema.safeParse({ rtuId: RTU_ID, assets: oneAsset }).success,
    "an rtuId-only payload must parse — that is the wired path",
  );
  assert(
    instantiateAssetsBodySchema.safeParse({ locationId: LOCATION_ID, assets: oneAsset }).success,
    "a locationId-only payload must parse — that is the gateway-less path ADR 0018 requires",
  );
  assert(
    !instantiateAssetsBodySchema.safeParse({
      rtuId: RTU_ID,
      locationId: LOCATION_ID,
      assets: oneAsset,
    }).success,
    "supplying both a target RTU and a target location must be rejected, not silently resolved",
  );
  assert(
    !instantiateAssetsBodySchema.safeParse({ assets: oneAsset }).success,
    "a payload with no target at all must be rejected",
  );

  // The message has to say which way to go — "invalid input" on an exclusive
  // pair leaves the caller guessing which field to drop.
  const neither = instantiateAssetsBodySchema.safeParse({ assets: oneAsset });
  assert(
    !neither.success &&
      /exactly one of rtuId .* or locationId/.test(neither.error.issues[0]?.message ?? ""),
    "the no-target error must name both fields and say exactly one is wanted",
  );

  // ---- batch-internal duplicate codes --------------------------------------

  // bms.assets.code is GLOBALLY unique, so a repeated code inside one batch
  // fails on the second insert and rolls back all of them. Caught here so the
  // caller is told which code collided rather than reading a constraint name.
  const duplicate = instantiateAssetsBodySchema.safeParse({
    rtuId: RTU_ID,
    assets: [
      { code: "PLANTA-CH-01", name: "Chiller 01" },
      { code: "PLANTA-CH-02", name: "Chiller 02" },
      { code: "PLANTA-CH-01", name: "Chiller 01 again" },
    ],
  });
  assert(!duplicate.success, "a batch repeating an asset code must be rejected");
  assert(
    !duplicate.success &&
      duplicate.error.issues.some((issue) => /PLANTA-CH-01/.test(issue.message)),
    "the duplicate-code error must name the colliding code",
  );
  assert(
    !duplicate.success &&
      duplicate.error.issues.some((issue) => issue.path.join(".") === "assets.2.code"),
    "the duplicate-code error must point at the second occurrence, not the first",
  );

  // ---- entry shape ---------------------------------------------------------

  const parsed = instantiateAssetsBodySchema.safeParse({ rtuId: RTU_ID, assets: oneAsset });
  assert(
    parsed.success && parsed.data.assets[0].siteName === undefined,
    "siteName must be optional — the service falls back to the target location's name",
  );
  assert(
    instantiateAssetsBodySchema.safeParse({
      rtuId: RTU_ID,
      assets: [{ code: "A", name: "A", sourceDataKeyVars: { unit: "01" } }],
    }).success,
    "sourceDataKeyVars must accept string values for pattern substitution",
  );
  assert(
    !instantiateAssetsBodySchema.safeParse({
      rtuId: RTU_ID,
      assets: [{ code: "A", name: "A", sourceDataKeyVars: { unit: 1 } }],
    }).success,
    "sourceDataKeyVars must reject non-string values — they are substituted into a varchar",
  );
  assert(
    !instantiateAssetsBodySchema.safeParse({ rtuId: RTU_ID, assets: [] }).success,
    "an empty batch must be rejected rather than succeeding with nothing done",
  );
  assert(
    !instantiateAssetsBodySchema.safeParse({ rtuId: "not-a-uuid", assets: oneAsset }).success,
    "the target id must be a uuid",
  );
}

/**
 * `F4.254` PR 1 — the root `.transform` narrows the exclusive pair into a
 * discriminated `target` and drops the two raw fields. The copilot catalog
 * stores and hashes the RAW body, never this output (plan §3.1).
 */
export function runInstantiateTransformTests(): void {
  const RTU_ID = "22222222-2222-4222-8222-222222222222";
  const LOCATION_ID = "33333333-3333-4333-8333-333333333333";
  const assets = [{ code: "A-1", name: "A" }];

  const rtu = instantiateAssetsBodySchema.parse({ rtuId: RTU_ID, assets });
  assert(
    JSON.stringify(rtu) === JSON.stringify({ target: { kind: "rtu", rtuId: RTU_ID }, assets }),
    "an rtuId body must transform to { target: { kind: rtu, rtuId }, assets }",
  );
  const location = instantiateAssetsBodySchema.parse({ locationId: LOCATION_ID, assets });
  assert(
    JSON.stringify(location) ===
      JSON.stringify({ target: { kind: "location", locationId: LOCATION_ID }, assets }),
    "a locationId body must transform to { target: { kind: location, locationId }, assets }",
  );
  assert(
    !("rtuId" in rtu) && !("locationId" in location),
    "the transformed output must not carry the raw rtuId / locationId keys",
  );
}
