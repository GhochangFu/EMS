import { Injectable } from "@nestjs/common";
import { EventEmitter } from "node:events";

import type { TelemetryReading } from "@bms/shared";

/** In-process bus from Postgres `LISTEN` to the Socket.IO gateway. */
@Injectable()
export class TelemetryBroadcastHub extends EventEmitter {
  emitReadings(readings: TelemetryReading[]): void {
    this.emit("readings", readings);
  }
}
