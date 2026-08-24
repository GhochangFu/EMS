/**
 * `F4.16` / ADR 0043 — derives a real, non-owner role's connection string from
 * the owner's `DATABASE_URL`, so a developer sets one variable rather than
 * three. Passwords are the compose defaults; `pnpm --filter @bms/db roles`
 * must have run.
 *
 * Copied inline in `tenant-context.integration.test.ts`,
 * `access-control-rls.integration.test.ts` and `role-grants.integration.spec.ts`
 * before this file existed — left as-is there rather than touched for this.
 * New real-role suites should import this instead of adding a fourth copy.
 */
export function asRole(url: string, role: string, password: string): string {
  const parsed = new URL(url);
  parsed.username = role;
  parsed.password = password;
  return parsed.toString();
}
