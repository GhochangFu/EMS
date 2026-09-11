import { BINDING_QUERY, planEndpoints, type BindingRow } from "./bindings.js";
import { ENV_CONNECTION, makeOptions, row } from "./bindings.spec.js";

/**
 * `E8.4` / ADR 0062 decisions 3, 4 and 9 — the stored key version travels from
 * the query to the decryptor, and the plan says which credential each RTU will
 * actually use.
 *
 * **Apart from `bindings.spec.ts` only because §4.5 caps a file at 1000 lines**
 * — the fixtures are imported from it rather than copied, the way
 * `supervisor-buffer.spec.ts` imports `supervisor.spec.ts`'s. The plan's §9
 * named `bindings.spec.ts` for these rows and it does not fit.
 *
 * **One exported function per claim, each with its own `it()`.**
 * `runBindingsTests` is one `it()` holding many blocks, and `assert` throws — so
 * a claim appended to the end of it could only redden once every earlier block
 * passed. These are claims that have to redden on their own.
 *
 * Errors are matched on `err.name`, never `instanceof` — vitest can load two
 * module instances (`F4.108`).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** A non-MQTT row carrying a credential blob, so the ADR 0012 branch is reached. */
function modbusRow(overrides: Partial<BindingRow> = {}): BindingRow {
  return row({
    config_protocol: "modbus_tcp",
    connection_config: { host: "10.0.0.5", port: 502, device: { unitId: 1 } },
    credentials_ciphertext: Buffer.from("cipher"),
    credentials_iv: Buffer.from("iv"),
    key_version: 2,
    ...overrides,
  });
}

/** An error whose `name` is set without importing the class — `F4.108`. */
function namedError(name: string, message: string): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

/**
 * Decision 3: the version travels with the ciphertext, so the query has to
 * select it. Nothing else in either spec can see the column's absence — the row
 * fixtures supply `key_version` themselves, and only the integration spec runs
 * the SQL.
 */
export function runBindingQuerySelectsKeyVersionTests(): void {
  const sql = BINDING_QUERY.replace(/\s+/g, " ");
  assert(
    sql.includes("c.key_version"),
    "the binding query must select rtu_connection_configs.key_version — without it every " +
      "stored version arrives as undefined and decryption is refused for the whole fleet",
  );
}

/**
 * The stored version reaches the ADR 0012 decryptor as its third argument.
 *
 * `7` rather than `1` or `2`: the column defaults to 1 and the current key
 * version defaults to 1, so neither of those values can distinguish "read from
 * the row" from "pinned in the code".
 */
export function runNonMqttDecryptorReceivesStoredVersionTests(): void {
  const seen: unknown[] = [];
  planEndpoints(
    [modbusRow({ key_version: 7 })],
    makeOptions({
      decryptCredentials: (_ciphertext, _iv, keyVersion) => {
        seen.push(keyVersion);
        return { username: "u", password: "p" };
      },
    }),
  );
  assert(seen.length === 1, `the decryptor must be called once, got ${seen.length}`);
  assert(seen[0] === 7, `the stored key version must reach the decryptor, got ${String(seen[0])}`);
}

/**
 * The same claim for the MQTT branch, where the version travels inside the row
 * handed to `resolveMqttConnection` rather than as an argument — `rtu-config.js`
 * takes one row, not four arguments, and that is the pilot's shape kept.
 */
export function runMqttResolverReceivesStoredVersionTests(): void {
  const seen: unknown[] = [];
  planEndpoints(
    [row({ connection_config: {}, key_version: 7 })],
    makeOptions({
      resolveMqttConnection: (configRow) => {
        seen.push(configRow?.key_version);
        return { ...ENV_CONNECTION, credentialSource: "env" };
      },
    }),
  );
  assert(seen.length === 1, `the resolver must be called once, got ${seen.length}`);
  assert(seen[0] === 7, `the stored key version must reach the resolver, got ${String(seen[0])}`);
}

/**
 * Decision 9: an RTU that *has* a config row and still connects with the
 * environment's credential is the fail-open case, and it is named rather than
 * disguised.
 *
 * **This is the positive control for the two absence functions below.** They
 * assert `warnings.length === 0`, which a build that never pushes a warning at
 * all satisfies; only this function can tell those two implementations apart.
 * Keep the three adjacent, and keep this one first.
 */
export function runEnvFallbackWarningTests(): void {
  const { warnings } = planEndpoints(
    [row({ connection_config: {}, key_version: 2 })],
    makeOptions({
      resolveMqttConnection: () => ({ ...ENV_CONNECTION, credentialSource: "env" }),
    }),
  );
  assert(warnings.length === 1, `one warning for one fallback, got ${JSON.stringify(warnings)}`);
  assert(warnings[0].reason === "credential-env-fallback", `wrong reason: ${warnings[0].reason}`);
  assert(warnings[0].rtuId === "rtu-uuid-1", `wrong rtuId: ${warnings[0].rtuId}`);
  assert(warnings[0].rtuCode === "RTU-1", `wrong rtuCode: ${String(warnings[0].rtuCode)}`);
}

/**
 * An absence check, and it proves nothing on its own: a build that never pushes
 * a warning passes this and the next one both. Its control is
 * `runEnvFallbackWarningTests` above.
 *
 * The row is identical to the warning row apart from `credentialSource`, so the
 * pair isolates that field as the trigger.
 */
export function runNoWarningWhenCredentialFromDbTests(): void {
  const { warnings } = planEndpoints(
    [row({ connection_config: {}, key_version: 2 })],
    makeOptions({
      resolveMqttConnection: () => ({ ...ENV_CONNECTION, credentialSource: "db" }),
    }),
  );
  assert(
    warnings.length === 0,
    `a credential read from the row is not a fallback: ${JSON.stringify(warnings)}`,
  );
}

/**
 * The second absence check, with the same positive control: an RTU with **no**
 * config row is the ordinary pilot case — all nine live PHE RTUs today, since
 * `rtu_connection_configs` still holds 0 rows — and warning about every one of
 * them would make the report noise rather than signal.
 */
export function runNoWarningWithoutConfigRowTests(): void {
  const { warnings } = planEndpoints([row()], makeOptions());
  assert(
    warnings.length === 0,
    `an RTU with no config row has nothing to fall back from: ${JSON.stringify(warnings)}`,
  );
}

/**
 * A version the loaded window cannot read is reported with a **constant**
 * detail, never the error message (AGENTS.md §9.6): a crypto message can carry
 * key material or ciphertext framing, and the skip report is read by an
 * operator and served on the health endpoint.
 */
export function runMqttVersionErrorDetailTests(): void {
  const { skipped } = planEndpoints(
    [row()],
    makeOptions({
      resolveMqttConnection: () => {
        throw namedError("CredentialKeyVersionError", "credential key version 9 is not loaded");
      },
    }),
  );
  assert(skipped.length === 1, `one skip, got ${JSON.stringify(skipped)}`);
  assert(skipped[0].reason === "credential-decrypt-failed", `wrong reason: ${skipped[0].reason}`);
  assert(
    skipped[0].detail === "key-version-not-loaded",
    `wrong detail: ${String(skipped[0].detail)}`,
  );
}

/**
 * The positive control for the MQTT detail: any other failure — a wrong-length
 * IV, a bad GCM tag, a truncated ciphertext — still carries **no** detail.
 *
 * Without this, setting the detail unconditionally would satisfy the function
 * above and lose the distinction it exists to draw. Measured: that is the
 * mutation this function reddens on and the one above does not.
 */
export function runMqttPlainErrorNoDetailTests(): void {
  const { skipped } = planEndpoints(
    [row()],
    makeOptions({
      resolveMqttConnection: () => {
        throw new Error("Unsupported state or unable to authenticate data");
      },
    }),
  );
  assert(skipped.length === 1, `one skip, got ${JSON.stringify(skipped)}`);
  assert(
    skipped[0].detail === undefined,
    `a cipher failure carries no detail, got ${String(skipped[0].detail)}`,
  );
}

/**
 * The same constant on the ADR 0012 branch — two `catch` blocks, one
 * vocabulary. Neither branch's pair gates the other: each is reached only by
 * its own protocol.
 */
export function runNonMqttVersionErrorDetailTests(): void {
  const { skipped } = planEndpoints(
    [modbusRow()],
    makeOptions({
      decryptCredentials: () => {
        throw namedError("CredentialKeyVersionError", "credential key version 9 is not loaded");
      },
    }),
  );
  assert(skipped.length === 1, `one skip, got ${JSON.stringify(skipped)}`);
  assert(skipped[0].reason === "credential-decrypt-failed", `wrong reason: ${skipped[0].reason}`);
  assert(
    skipped[0].detail === "key-version-not-loaded",
    `wrong detail: ${String(skipped[0].detail)}`,
  );
}

/** The positive control for the ADR 0012 branch's detail. */
export function runNonMqttPlainErrorNoDetailTests(): void {
  const { skipped } = planEndpoints(
    [modbusRow()],
    makeOptions({
      decryptCredentials: () => {
        throw new Error("Unsupported state or unable to authenticate data");
      },
    }),
  );
  assert(skipped.length === 1, `one skip, got ${JSON.stringify(skipped)}`);
  assert(
    skipped[0].detail === undefined,
    `a cipher failure carries no detail, got ${String(skipped[0].detail)}`,
  );
}
