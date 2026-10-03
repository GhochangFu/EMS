import { Injectable } from "@nestjs/common";

/** The part of a Socket.IO socket the registry reads and calls. */
export type RegisteredSocket = {
  data: { userId?: unknown };
  disconnect(close?: boolean): unknown;
};

/** The part of a Socket.IO namespace the registry walks. */
export type RegisteredNamespace = {
  sockets: Map<string, RegisteredSocket> | { values(): Iterable<RegisteredSocket> };
};

/**
 * `F3.78` / ADR 0089 decision 8 — closes a deactivated user's open sockets.
 *
 * Each gateway registers its namespace in `afterInit`, and stores the
 * resolved `bms.users.id` on `client.data.userId` in `handleConnection`
 * before any other `await` (so a NOTIFY that lands during scope resolution
 * still finds the socket). `UserDisabledListenerService` calls
 * `disconnectUser` for every `bms_user_disabled` notification; each API
 * process runs one listener, so the sockets of every process close.
 */
@Injectable()
export class SocketRegistry {
  private readonly namespaces = new Set<RegisteredNamespace>();

  register(namespace: RegisteredNamespace): void {
    this.namespaces.add(namespace);
  }

  /** Disconnects every registered socket whose `data.userId` is `userId`; returns how many. */
  disconnectUser(userId: string): number {
    let closed = 0;
    for (const namespace of this.namespaces) {
      for (const socket of [...namespace.sockets.values()]) {
        if (socket.data?.userId === userId) {
          socket.disconnect(true);
          closed += 1;
        }
      }
    }
    return closed;
  }

  /**
   * Every distinct `data.userId` held by a registered socket — the input to
   * the listener's catch-up on connect (`user-disabled-notify.ts`). A socket
   * whose handshake has not stored a string id carries no user to read.
   */
  connectedUserIds(): string[] {
    const ids = new Set<string>();
    for (const namespace of this.namespaces) {
      for (const socket of namespace.sockets.values()) {
        const userId = socket.data?.userId;
        if (typeof userId === "string") {
          ids.add(userId);
        }
      }
    }
    return [...ids];
  }
}
