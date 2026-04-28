# ADR 0002: Redis-Backed Socket.IO Realtime
Date: 2026-04-28
Status: accepted

## Context

The prototype API uses in-process Socket.IO gateways. That works for a
single API process but does not fan out events to clients connected to a
different API process. Phase 1 Sprint B prepares the pilot stack for
more than one API process without introducing a full message broker yet.

## Decision

Add Redis 7 to Docker Compose and wire the Socket.IO Redis adapter into
the NestJS API when `REDIS_URL` is configured. Native WSL development may
omit `REDIS_URL`; the API then falls back to the existing in-process
Socket.IO adapter.

Compose will include a `realtime-smoke` profile that starts a second API
process on a separate host port. A smoke script connects a WebSocket
client to the second process, acknowledges an alarm through the first
process, and expects the alarm event to arrive through Redis fan-out.

## Consequences

The pilot-like compose stack now runs Redis by default for `core` and
`pilot`. Redis is approved only for Socket.IO fan-out in Sprint B; cache,
queues, BullMQ workers, and other Redis usages remain out of scope until
their own promotions.

## Alternatives Considered

- **Stay in-process:** rejected because it cannot prove multi-process
  websocket fan-out.
- **Introduce EMQX/MQTT now:** rejected because protocol ingestion is
  Phase 2, not Phase 1 Sprint B.
