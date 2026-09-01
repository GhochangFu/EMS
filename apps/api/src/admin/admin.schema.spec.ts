import { activeFilterSchema } from "./admin.schema";
import { createOrganizationBodySchema } from "./organizations/organizations.schema";
import { createAssetPointBodySchema } from "./asset-points/asset-points.schema";
import { createPointKeyBodySchema } from "./point-keys/point-keys.schema";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Lightweight schema checks for master-data admin DTOs. */
export function runAdminSchemaTests(): void {
  assert(activeFilterSchema.parse("all") === "all", "active filter all");
  assert(activeFilterSchema.parse("true") === "true", "active filter true");

  const org = createOrganizationBodySchema.parse({
    code: "DEMO",
    name: "Demo Org",
  });
  assert(org.code === "DEMO", "organization code parsed");

  const point = createAssetPointBodySchema.parse({
    assetId: "00000000-0000-4000-8000-000000000001",
    pointKey: "kw",
    sourceDataKey: "total_kw",
  });
  assert(point.pointKey === "kw", "asset point key parsed");

  // `F3.39`: no `organizationId` — the catalog is fleet-wide since `0057`.
  const catalogKey = createPointKeyBodySchema.parse({
    code: "kw",
    name: "Active Power",
    domain: "electrical",
  });
  assert(catalogKey.code === "kw", "point key catalog code parsed");

  // The body is `.strict()` (ADR 0029), so a client that keeps sending the old
  // field is told rather than silently ignored. This is the half of the
  // contract change a `z.infer` type cannot express.
  assert(
    createPointKeyBodySchema.safeParse({
      organizationId: "00000000-0000-4000-8000-000000000001",
      code: "kw",
      name: "Active Power",
    }).success === false,
    "createPointKeyBodySchema must reject a body that still carries organizationId",
  );
}
