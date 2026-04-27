import { Logger } from "@nestjs/common";
import {
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayInit,
} from "@nestjs/websockets";
import type { TelemetryReading } from "@bms/shared";
import { Server } from "socket.io";

import { TelemetryBroadcastHub } from "./telemetry-broadcast.hub";

@WebSocketGateway({
  namespace: "/ws/telemetry",
  cors: {
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
    credentials: true,
  },
})
export class TelemetryGateway implements OnGatewayInit {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(TelemetryGateway.name);

  constructor(private readonly hub: TelemetryBroadcastHub) {}

  afterInit(): void {
    this.hub.on("readings", (readings: TelemetryReading[]) => {
      this.server.emit("telemetry", { readings });
    });
    this.logger.log("WebSocket namespace /ws/telemetry ready");
  }
}
