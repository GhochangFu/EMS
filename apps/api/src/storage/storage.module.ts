import { Global, Inject, Injectable, Logger, Module, type OnModuleInit } from "@nestjs/common";

import { createAwsS3Ops } from "./aws-s3-ops";
import { createStorageClient, ensureBucket, type StorageClient } from "./storage-client";
import { readStorageConfig } from "./storage-config";
import { StorageHealthService } from "./storage-health.service";
import { STORAGE_CLIENT } from "./storage.tokens";

/**
 * The one `StorageModule` (ADR 0066 decisions 3, 9), imported by
 * `AppModule` **only** — never `WorkerModule`: no job reads an object, so
 * the worker gets no storage config and `tests/f4.24-worker-imports-no-api-loop.test.ts`
 * keeps this directory out of the worker's closure.
 *
 * `@Global()` like `QueueModule`, so `HealthModule` (which declares no
 * `imports`) can inject the health reader and `AssetsModule` can inject
 * `STORAGE_CLIENT` without importing this module. The client is built once
 * from the six `OBJECT_STORAGE_*` variables: without an endpoint the
 * factory returns the `unconfigured` variant after one warn (decision 3) —
 * the API still boots, the asset image routes answer 503. A malformed
 * configuration throws `StorageConfigError` in the factory and the process
 * refuses to boot, like a malformed `REDIS_URL`; the value never appears
 * in the message.
 *
 * `StorageBootstrap` is decision 9's "the API creates the bucket at module
 * init when it is missing" — no init container, no `mc` script. A throw
 * from `ensureBucket` (anything but a lost `CreateBucket` race) refuses
 * the boot: a set endpoint is a claim that the store is reachable.
 *
 * `StorageHealthService` is provided and exported here, and
 * `HealthController` injects it `@Optional()` — so the same controller
 * serves both processes and only the API's body carries a `storage` key
 * (Q-A). The service itself imports only the token, the pure reader and
 * types, because `health.controller.ts` is in the worker's import closure;
 * importing it from **this** file would drag `aws-s3-ops` and the SDK in
 * behind it.
 *
 * Nest wiring, uncovered like `main.ts`; the config reader and the client
 * are specced in `storage-config.spec.ts` and `storage-client.spec.ts`.
 */
@Injectable()
export class StorageBootstrap implements OnModuleInit {
  private readonly logger = new Logger(StorageBootstrap.name);

  constructor(@Inject(STORAGE_CLIENT) private readonly client: StorageClient) {}

  async onModuleInit(): Promise<void> {
    if (this.client.kind === "unconfigured") {
      return;
    }
    await ensureBucket(this.client);
    this.logger.log(`object storage bucket "${this.client.bucket}" ensured (ADR 0066 decision 9)`);
  }
}

@Global()
@Module({
  providers: [
    {
      provide: STORAGE_CLIENT,
      useFactory: (): StorageClient =>
        createStorageClient(readStorageConfig(process.env), {
          createOps: createAwsS3Ops,
          logger: new Logger("StorageModule"),
        }),
    },
    StorageBootstrap,
    StorageHealthService,
  ],
  exports: [STORAGE_CLIENT, StorageHealthService],
})
export class StorageModule {}
