import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module";
import { CredentialCryptoService } from "../security/credential-crypto.service";
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
 * always `mqtts`, always the host guard.
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
  ],
  exports: [DiscoveryJobService],
})
export class OnboardingDiscoveryModule {}
