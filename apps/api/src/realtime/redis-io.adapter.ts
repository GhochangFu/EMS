import { Logger } from "@nestjs/common";
import { IoAdapter } from "@nestjs/platform-socket.io";
import type { INestApplicationContext } from "@nestjs/common";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import type { Server, ServerOptions } from "socket.io";

const logger = new Logger("RedisIoAdapter");

class RedisIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly redisAdapter: ReturnType<typeof createAdapter>,
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;
    server.adapter(this.redisAdapter);
    return server;
  }
}

/** Creates a Socket.IO adapter, using Redis fan-out when REDIS_URL is configured. */
export async function createSocketIoAdapter(
  app: INestApplicationContext,
): Promise<IoAdapter> {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    logger.warn("REDIS_URL missing; using in-process Socket.IO adapter");
    return new IoAdapter(app);
  }

  const pubClient = createClient({ url: redisUrl });
  const subClient = pubClient.duplicate();

  pubClient.on("error", (err: Error) => {
    logger.error(`Redis pub client error: ${err.message}`);
  });
  subClient.on("error", (err: Error) => {
    logger.error(`Redis sub client error: ${err.message}`);
  });

  await Promise.all([pubClient.connect(), subClient.connect()]);
  logger.log(`Socket.IO Redis adapter connected to ${redisUrl}`);

  return new RedisIoAdapter(app, createAdapter(pubClient, subClient));
}
