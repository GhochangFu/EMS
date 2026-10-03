import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const composePath = join(repoRoot, "docker-compose.yml");

/**
 * `F3.78` — Keycloak's dev-file database sits on a named volume.
 *
 * The mount is the whole data directory, not `data/h2`: the image has no `h2`
 * directory, so a volume mounted there is root-owned and Keycloak (uid 1000)
 * fails to open its database (proved on a scratch container, 2026-10-03).
 *
 * Users the API creates live only in Keycloak's H2 store. On the container's
 * writable layer a `compose up -d` that recreates the service loses every one
 * of them while `bms.users` rows keep pointing at subjects that no longer
 * exist. Nothing at run time tells a named volume from the writable layer, so
 * the committed file is held here, statically (CI never runs `docker compose`).
 * Only the running stack proves the mount is there (build loop step 6).
 */
const DATA_DIR = "/opt/keycloak/data";
const IMPORT_MOUNT = "./infra/keycloak:/opt/keycloak/data/import:ro";
const VOLUME = "bms-keycloak-data";

function withoutComments(yaml: string): string {
  return yaml
    .split("\n")
    .map((line) => line.replace(/\s+#.*$/, "").replace(/^\s*#.*$/, ""))
    .join("\n");
}

function keycloakBlock(compose: string): string {
  const start = /^ {2}keycloak:\s*$/m.exec(compose);
  expect(start, "docker-compose.yml must declare a `keycloak` service").not.toBeNull();
  const after = compose.slice(start?.index ?? 0);
  const next = /\n {2}[A-Za-z_][\w-]*:\s*$/m.exec(after.slice(1));
  return next === null ? after : after.slice(0, next.index + 1);
}

describe("F3.78 — Keycloak's data directory (H2 database) sits on a named volume", () => {
  const compose = withoutComments(readFileSync(composePath, "utf8"));

  it("mounts the named volume at the data directory on the keycloak service", () => {
    expect(keycloakBlock(compose)).toMatch(new RegExp(`^\\s*-\\s*${VOLUME}:${DATA_DIR}\\s*$`, "m"));
  });

  it("keeps the realm import bind, listed after the data volume so it lies on top of it", () => {
    const block = keycloakBlock(compose);
    const data = block.indexOf(`${VOLUME}:${DATA_DIR}`);
    const imp = block.indexOf(IMPORT_MOUNT);
    expect(data).toBeGreaterThanOrEqual(0);
    expect(imp).toBeGreaterThan(data);
  });

  it("declares the volume at the top level, so compose creates and keeps it", () => {
    const topLevel = /^volumes:\s*$/m.exec(compose);
    expect(topLevel, "docker-compose.yml must have a top-level `volumes:` block").not.toBeNull();
    expect(compose.slice(topLevel?.index ?? 0)).toMatch(new RegExp(`^ {2}${VOLUME}:\\s*$`, "m"));
  });
});
