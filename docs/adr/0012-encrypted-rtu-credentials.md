# ADR 0012 — Encrypted RTU connection credentials

## Status

Accepted

## Context

ADR 0007 stored MQTT credentials in environment variables only. Per-RTU onboarding
requires protocol-specific connection config and secrets stored per gateway.

## Decision

1. Add `bms.rtu_connection_configs` (1:1 with `rtus`) for non-secret `config` JSONB
   and AES-256-GCM encrypted credential blobs (`credentials_ciphertext`, `credentials_iv`,
   `key_version`).
2. Encryption key from `CREDENTIAL_ENCRYPTION_KEY` (32-byte base64) in API and ingest.
3. API responses never return decrypted secrets; clients see masked placeholders.
4. Decrypt only in ingest runtime (MQTT MVP) and during commit persistence.
5. Onboarding session drafts store pending credentials encrypted in session JSON.

## Consequences

- Key rotation requires `key_version` support in a future sprint.
- Non-MQTT protocols persist config only until adapter sprints land.
