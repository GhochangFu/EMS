import { RequestMethod } from "@nestjs/common";
import type { GlobalPrefixOptions } from "@nestjs/common/interfaces";

/**
 * The API's global prefix and the routes it leaves unprefixed.
 *
 * Held here rather than inline in `main.ts` so a test can read the list the
 * process uses: `main.ts` runs `bootstrap()` on import, and no spec boots
 * through it. `F4.175`'s review found the gap this closes — `GET /health/ready`
 * was mounted at `/api/v1/health/ready` on `PORT`, because Nest matches an
 * exclude entry as a whole path (`health` excludes `/health` and not
 * `/health/ready`), while the worker, which sets no prefix, served
 * `/health/ready`. `global-prefix.test.ts` runs Nest's own matcher over this
 * list.
 *
 * The probes stay unprefixed so an orchestrator reads one path on both
 * processes: `PORT/health` and `WORKER_PORT/health`, and the same for `ready`.
 */
export const GLOBAL_PREFIX = "api/v1";

export const GLOBAL_PREFIX_OPTIONS: GlobalPrefixOptions = {
  exclude: [
    { path: "health", method: RequestMethod.GET },
    { path: "health/ready", method: RequestMethod.GET },
    { path: "metrics", method: RequestMethod.GET },
  ],
};
