import { ServiceUnavailableException } from "@nestjs/common";

import type { StorageClient } from "../storage/storage-client";

/**
 * ADR 0066 decision 3 — the 503 every asset-image route answers before it
 * touches a pool when object storage is unconfigured. The message names the
 * variable, never a value. Shared by the read service (`F3.3`) and the write
 * service (`F3.4`) so the sentence exists once.
 */
export function requireStorageConfigured(client: StorageClient): void {
  if (client.kind === "unconfigured") {
    throw new ServiceUnavailableException(
      "Object storage is not configured: OBJECT_STORAGE_ENDPOINT is unset (ADR 0066 decision 3)",
    );
  }
}
