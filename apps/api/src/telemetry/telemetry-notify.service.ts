import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { Client } from "pg";
import type { TelemetryReading } from "@bms/shared";

import { TelemetryBroadcastHub } from "./telemetry-broadcast.hub";

@Injectable()
export class TelemetryNotifyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelemetryNotifyService.name);
  private client: Client | null = null;

  constructor(private readonly hub: TelemetryBroadcastHub) {}

  async onModuleInit(): Promise<void> {
    const url = process.env.DATABASE_URL;
    if (!url) {
      this.logger.warn("DATABASE_URL missing; telemetry NOTIFY listener disabled");
      return;
    }
    this.client = new Client({ connectionString: url });
    try {
      await this.client.connect();
      await this.client.query("LISTEN bms_telemetry");
      this.client.on("notification", (msg) => {
        try {
          const payload = JSON.parse(msg.payload ?? "{}") as {
            readings?: unknown;
          };
          if (Array.isArray(payload.readings)) {
            this.hub.emitReadings(payload.readings as TelemetryReading[]);
          }
        } catch {
          this.logger.warn("Failed to parse bms_telemetry payload");
        }
      });
      this.logger.log("Listening on bms_telemetry");
    } catch (err) {
      this.logger.error({ err }, "Could not subscribe to bms_telemetry");
      this.client = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.end();
      this.client = null;
    }
  }
}
