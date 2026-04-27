import { Logger } from "@nestjs/common";
import {
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayInit,
} from "@nestjs/websockets";
import type { AlarmListItem } from "@bms/shared";
import { Server } from "socket.io";

@WebSocketGateway({
  namespace: "/ws/alarms",
  cors: {
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
    credentials: true,
  },
})
export class AlarmsGateway implements OnGatewayInit {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(AlarmsGateway.name);

  afterInit(): void {
    this.logger.log("WebSocket namespace /ws/alarms ready");
  }

  broadcastCreated(alarm: AlarmListItem): void {
    this.server.emit("alarm", { type: "created", alarm });
  }

  broadcastAcknowledged(alarm: AlarmListItem): void {
    this.server.emit("alarm", { type: "acknowledged", alarm });
  }
}
