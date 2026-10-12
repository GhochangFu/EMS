import type { UserGrantsService } from "../admin/users/user-grants.service";
import type { UsersService } from "../admin/users/users.service";

/**
 * `F3.86` PR 4 — the users services for a resolver spec that names no user
 * target: any call is a test error, so a spec that reaches one by mistake
 * fails loudly instead of resolving.
 */
const refuse = (): never => {
  throw new Error("F3.86: this spec names no user target");
};

export const NO_USERS = { requireManager: refuse, requireManageableTarget: refuse } as unknown as UsersService;
export const NO_GRANTS = { assertGrantAddable: refuse, assertGrantRemovable: refuse } as unknown as UserGrantsService;
