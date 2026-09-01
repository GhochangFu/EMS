import { customType } from "drizzle-orm/pg-core";

/**
 * `bytea`, shared by every schema module that stores ciphertext.
 *
 * Drizzle's `pg-core` ships no `bytea` column, so this declares one. It lived
 * as a module-private `const` in `bms-schema.ts` until that file was split, and
 * it is here rather than duplicated because two modules now need it:
 * `rtu_connection_configs.credentials_ciphertext` (ADR 0012) stayed in the core
 * file and `notification_channels.secret_ciphertext` moved to
 * `alarms-schema.ts`. Two copies of a custom type are two things that can drift
 * apart while both compile.
 */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});
