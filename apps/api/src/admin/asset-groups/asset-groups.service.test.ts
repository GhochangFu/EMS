import { describe, it } from "vitest";

import * as spec from "./asset-groups.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.78 — asset group write routes (ADR 0089 decision 7, plan U8)", () => {
  it("the PATCH schema refuses code", () => {
    spec.assertUpdateSchemaRefusesCode();
  });

  it("both asset-group controllers carry JwtAuthGuard", () => {
    spec.assertBothControllersCarryJwtAuthGuard();
  });

  it("create refuses a location outside the caller's scope and writes nothing", async () => {
    await spec.assertCreateRefusesAnotherSitesLocation();
  });

  it("update refuses another site's group and writes nothing", async () => {
    await spec.assertUpdateRefusesAnotherSitesGroup();
  });

  it("addMember refuses another site's group and writes nothing", async () => {
    await spec.assertAddMemberRefusesAnotherSitesGroup();
  });

  it("removeMember refuses another site's membership and writes nothing", async () => {
    await spec.assertRemoveMemberRefusesAnotherSitesMember();
  });

  it("create with an unknown key is a 400 and writes nothing (F4.189)", async () => {
    await spec.assertCreateWithAnUnknownKeyIs400AndWritesNothing();
  });

  it("addMember with an unknown key is a 400 and writes nothing (F4.189)", async () => {
    await spec.assertAddMemberWithAnUnknownKeyIs400AndWritesNothing();
  });
});
