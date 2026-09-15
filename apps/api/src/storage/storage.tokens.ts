/**
 * The DI token for the one `StorageClient` (ADR 0066 decision 3).
 * `StorageModule` provides it from the six `OBJECT_STORAGE_*` variables;
 * `AssetImagesService` (Unit 6) and `StorageHealthService` (Unit 5) inject
 * it. A symbol, like the queue and database tokens, so no string can alias
 * it by accident. Only `AppModule` imports `StorageModule` — the worker
 * has no storage config (decision 9), so this token is never bound there.
 */
export const STORAGE_CLIENT = Symbol("STORAGE_CLIENT");
