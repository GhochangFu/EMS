import type { StorageHealth } from "@bms/shared";
import { Inject, Injectable } from "@nestjs/common";

import type { StorageClient } from "./storage-client";
import { readStorageHealth, STORAGE_HEALTH_TIMEOUT_MS } from "./storage-health";
import { STORAGE_CLIENT } from "./storage.tokens";

/**
 * The injectable face of `storage-health.ts` (ADR 0066 decisions 3, 9):
 * `HealthController` calls `read()` on the API process and gets the
 * `storage` section. Everything decided is in `readStorageHealth`, which is
 * pure and specced; this class only binds the client's own `HeadBucket` and
 * the real timeout.
 *
 * **This file imports `./storage.tokens`, `./storage-health` and types, and
 * nothing else — never `./storage.module`, never `./aws-s3-ops`, never
 * `@aws-sdk`.** `health.controller.ts` injects it, and that controller is in
 * the worker's import closure
 * (`tests/f4.24-worker-imports-no-api-loop.test.ts` `WORKER_LEAVES`), so
 * anything this file imports the worker process loads at start-up. The
 * worker has no storage config (decision 9) and must not pull the SDK in
 * behind a service it never resolves.
 *
 * The bucket is never logged or thrown from here; the head read's failure
 * collapses to `reachable: false` inside `readStorageHealth`.
 *
 * Nest wiring, uncovered like `main.ts`; `storage-health.spec.ts` is the gate.
 */
@Injectable()
export class StorageHealthService {
  constructor(@Inject(STORAGE_CLIENT) private readonly client: StorageClient) {}

  read(): Promise<StorageHealth> {
    const client = this.client;
    return readStorageHealth(client, {
      headBucket: () =>
        client.kind === "configured"
          ? client.ops.headBucket(client.bucket)
          : Promise.resolve("missing"),
      timeoutMs: STORAGE_HEALTH_TIMEOUT_MS,
    });
  }
}
