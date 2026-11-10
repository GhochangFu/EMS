// Type-only: the edge must not load `bindings.ts` or `normaliser.ts` at run
// time (ADR 0123 decision 2; `tests/e7.2-edge-entry-point.test.ts` walks the
// runtime import graph from `edge-main.ts` and skips `import type`).
import type { IngestAdapterFactory } from "../adapter/types.js";
import type { EndpointPlan } from "./bindings.js";
import type { EdgeEndpoint } from "./edge-config.js";
import type { PointIndex } from "./normaliser.js";

/**
 * The edge's endpoint plan (`E7.2`, ADR 0123 decision 3, plan T5.2).
 *
 * The cloud builds its plans from database rows (`planEndpoints`); the edge
 * builds the same `EndpointPlan` from the validated configuration file, so the
 * supervisor and the adapters run unchanged. Two differences, both by design:
 *
 * - **The point index is empty.** The edge holds no point mapping: samples
 *   leave un-normalised, as they sit in an `F1.10` segment, and the cloud
 *   resolves them (decision 3).
 * - **`rtuId` and `rtuCode` are the `deviceKey`.** The edge has no RTU ids;
 *   the `deviceKey` is the RTU's fleet-wide `rtu_code` in the cloud (plan
 *   M12), so health lines read the same on both ends.
 *
 * Devices are grouped by the adapter's own `endpointKey`, exactly as the cloud
 * groups them: one MQTT broker connection serves every device on it, and a
 * connection-per-device protocol gets one plan per device. Two file endpoints
 * that resolve to the same key are refused — they would be two connections
 * with one disk-buffer directory and one health line.
 */

const EMPTY_INDEX: PointIndex = new Map();

/** A plan and the factory that serves it, so the entry point looks nothing up again. */
export type EdgeEndpointPlan = {
  readonly factory: IngestAdapterFactory;
  readonly plan: EndpointPlan;
};

export function planEdgeEndpoints(
  endpoints: readonly EdgeEndpoint[],
): readonly EdgeEndpointPlan[] {
  const plans = new Map<
    string,
    {
      factory: IngestAdapterFactory;
      plan: EndpointPlan & { bindings: EndpointPlan["bindings"][number][] };
    }
  >();
  const owner = new Map<string, number>();
  endpoints.forEach((endpoint, e) => {
    for (const device of endpoint.devices) {
      const endpointKey = endpoint.factory.endpointKey(
        endpoint.config,
        device.deviceKey,
      );
      const key = `${endpoint.protocol}\u0000${endpointKey}`;
      const first = owner.get(key);
      if (first !== undefined && first !== e) {
        throw new Error(
          `EDGE_CONFIG_FILE refused: endpoints[${first}] and endpoints[${e}] are the same ${endpoint.protocol} endpoint; list their devices under one`,
        );
      }
      owner.set(key, e);
      let entry = plans.get(key);
      if (entry === undefined) {
        entry = {
          factory: endpoint.factory,
          plan: {
            protocol: endpoint.protocol,
            endpointKey,
            config: endpoint.config,
            credentials: endpoint.credentials,
            bindings: [],
            pointIndex: EMPTY_INDEX,
            // Only the cloud's reload registry reads this; the edge plan never changes while running.
            decoderFingerprint: "",
          },
        };
        plans.set(key, entry);
      }
      entry.plan.bindings.push({
        rtuId: device.deviceKey,
        rtuCode: device.deviceKey,
        deviceKey: device.deviceKey,
        device: device.device,
        sourceKeys: device.sourceKeys,
      });
    }
  });
  return [...plans.values()];
}
