import { z } from "zod";

/**
 * The edge gateway's configuration file (`E7.2`, ADR 0123 decision 3, plan
 * T5.1 and C11).
 *
 * `EDGE_CONFIG_FILE` names one JSON file on the box: a list of endpoints, each
 * `{ protocol, config, credentials?, devices: [{ deviceKey, device,
 * sourceKeys? }] }`. This schema checks the file's **shape** only. The edge
 * host (`apps/ingest/src/host/edge-config.ts`) then runs each endpoint's
 * `config` and each device's `device` through the adapter's own
 * `configSchema` and `deviceSchema`, so the adapter, not this file, decides
 * what a valid MQTT broker or device is.
 *
 * **No secret is ever in the file.** `credentials` maps a credential key the
 * adapter reads (`username`, `password`) to the **name** of an environment
 * variable on the box, `EDGE_CRED_<NAME>`; the host resolves the value at
 * start-up and never prints it. A value that is not such a name is refused
 * here, so a password pasted into the file stops the box rather than being
 * read as a variable name.
 *
 * `.strict()` throughout, unlike the uplink wire: this file is written by
 * hand, and a misspelt key (`sourceKey` for `sourceKeys`) silently ignored is
 * a device that never reports. Re-exported from `./ingest`, never `index.ts`
 * (the shared barrel is at the AGENTS.md §4.5 cap).
 */

/** The only shape a credential reference may take: an environment variable name. */
export const EDGE_CREDENTIAL_ENV_PATTERN = /^EDGE_CRED_[A-Z0-9_]+$/;

/** A credential key as an adapter reads it from `AdapterContext.credentials`. */
export const EDGE_CREDENTIAL_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

const credentialKey = z.string().regex(EDGE_CREDENTIAL_KEY_PATTERN);

export const edgeDeviceEntrySchema = z
  .object({
    /** How the device names itself on the wire, and its `bms.rtus.rtu_code` in the cloud. */
    deviceKey: z.string().min(1).max(64),
    /** The adapter's per-device slice, checked by its `deviceSchema`. */
    device: z.unknown(),
    /** The device's source keys; an adapter may scope its read set to them. */
    sourceKeys: z.array(z.string().min(1).max(128)).optional(),
  })
  .strict();

export const edgeEndpointEntrySchema = z
  .object({
    /** An ingest protocol; the host names one with no adapter. */
    protocol: z.string().min(1).max(32),
    /** The adapter's connection slice, checked by its `configSchema`. */
    config: z.record(z.string(), z.unknown()),
    /** `credential key → EDGE_CRED_<NAME>`, names only. */
    credentials: z.record(credentialKey, z.string().regex(EDGE_CREDENTIAL_ENV_PATTERN)).optional(),
    devices: z.array(edgeDeviceEntrySchema).min(1),
  })
  .strict();

export const edgeConfigFileSchema = z
  .object({
    endpoints: z.array(edgeEndpointEntrySchema).min(1),
  })
  .strict();

export type EdgeDeviceEntry = z.infer<typeof edgeDeviceEntrySchema>;
export type EdgeEndpointEntry = z.infer<typeof edgeEndpointEntrySchema>;
export type EdgeConfigFile = z.infer<typeof edgeConfigFileSchema>;

/** `EDGE_BUFFER_MAX_AGE_MS` default: 72 h, a weekend (ADR 0123 decision 7). */
export const EDGE_DEFAULT_BUFFER_MAX_AGE_MS = 72 * 3_600_000;
/** `EDGE_BUFFER_MAX_AGE_MS` hard ceiling: 6 d, under the 7-day compression line. */
export const EDGE_MAX_BUFFER_MAX_AGE_MS = 6 * 86_400_000;
/** `EDGE_BUFFER_MAX_BYTES` default: 1 GiB. */
export const EDGE_DEFAULT_BUFFER_MAX_BYTES = 1_073_741_824;
/** `EDGE_REPLAY_MAX_SAMPLES_PER_S` default (decision 9). */
export const EDGE_DEFAULT_REPLAY_MAX_SAMPLES_PER_S = 500;
/**
 * `EDGE_REPLAY_MAX_SAMPLES_PER_S` floor (plan C3): a full 500-sample backlog
 * batch then waits at most 10 s for the throttle, inside the edge
 * supervisor's write timeout.
 */
export const EDGE_MIN_REPLAY_MAX_SAMPLES_PER_S = 50;
