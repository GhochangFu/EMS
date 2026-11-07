import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module";
import { CredentialCryptoService } from "../security/credential-crypto.service";
import { mqttPlaintextAllowlistProvider } from "../security/mqtt-plaintext-hosts";
import { DiscoveryJobService } from "./discovery-job.service";
import { DiscoveryJobStore } from "./discovery-job-store";
import {
  DISCOVERY_TRANSPORT,
  DISCOVERY_TRANSPORT_OPTIONS,
  mqttDiscoveryTransport,
  PRODUCTION_TRANSPORT_OPTIONS,
} from "./discovery-transport";

/**
 * `F3.24b` (ADR 0103 decision 1) — the discovery job's leaf module for the
 * worker. It imports `DatabaseModule` only and starts no loop, so
 * `WorkerModule` may import it (`tests/f4.24` `WORKER_LEAVES`). The two
 * transport tokens are bound to the production values here and nowhere else:
 * `mqtts` unless ADR 0114's allowlist says plain, always the host guard.
 *
 * Nest wiring, uncovered like `main.ts`.
 */
@Module({
  imports: [DatabaseModule],
  providers: [
    CredentialCryptoService,
    DiscoveryJobStore,
    DiscoveryJobService,
    { provide: DISCOVERY_TRANSPORT, useValue: mqttDiscoveryTransport },
    { provide: DISCOVERY_TRANSPORT_OPTIONS, useValue: PRODUCTION_TRANSPORT_OPTIONS },
    // F4.326 / ADR 0114 decision 4: the job's plain-MQTT allowlist. Throws on a
    // bad entry, so the worker refuses to boot.
    mqttPlaintextAllowlistProvider,
  ],
  exports: [DiscoveryJobService],
})
export class OnboardingDiscoveryModule {}
