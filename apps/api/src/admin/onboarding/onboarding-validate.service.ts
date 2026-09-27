import { Injectable } from "@nestjs/common";

import type {
  OnboardingDraft,
  OnboardingFieldError,
  OnboardingPhase,
} from "@bms/shared";

import {
  draftAssetPointSchema,
  draftAssetSchema,
  draftLocationSchema,
  draftPointKeySchema,
  draftRtuSchema,
  onboardingDraftSchema,
} from "./onboarding.schema";

export type ValidateResult = {
  valid: boolean;
  errors: OnboardingFieldError[];
  readyToCommit: boolean;
  suggestedPhase: OnboardingPhase;
};

/** Validates onboarding draft business rules. */
@Injectable()
export class OnboardingValidateService {
  /**
   * Runs schema and cross-field validation on a draft.
   *
   * `F4.162` (ADR 0077 Amendment 1, plan D9, owner ruling OQ3):
   * `activeLocationTypeCodes` is the active `bms.location_types` codes, read by
   * the caller. Required, with no default: an optional parameter is invisible
   * at an adapter, and `tsc` then names every caller. A stored type that is not
   * in it counts as missing, so a type retired after it was stored is reported
   * here, and `readyToCommit` agrees with the commit's 400.
   */
  validate(draft: unknown, activeLocationTypeCodes: readonly string[]): ValidateResult {
    const errors: OnboardingFieldError[] = [];
    const parsed = onboardingDraftSchema.safeParse(draft);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({
          path: issue.path.join("."),
          message: issue.message,
        });
      }
      return {
        valid: false,
        errors,
        readyToCommit: false,
        suggestedPhase: this.inferPhase(draft, activeLocationTypeCodes),
      };
    }

    const d = parsed.data as OnboardingDraft;
    this.validateCrossField(d, errors, activeLocationTypeCodes);
    const phase = this.inferPhase(d, activeLocationTypeCodes);
    const readyToCommit = errors.length === 0 && phase === "review";
    return {
      valid: errors.length === 0,
      errors,
      readyToCommit,
      suggestedPhase: phase,
    };
  }

  private validateCrossField(
    d: OnboardingDraft,
    errors: OnboardingFieldError[],
    activeLocationTypeCodes: readonly string[],
  ): void {
    if (d.location) {
      const loc = draftLocationSchema.safeParse(d.location);
      if (!loc.success) {
        for (const issue of loc.error.issues) {
          errors.push({ path: `location.${issue.path.join(".")}`, message: issue.message });
        }
      }
      // F4.157 / ADR 0077 decision 7 (owner ruling OQ2): `type` is optional in
      // the draft so the chat can store the name in one turn and ask for the
      // type in the next. It is not optional at commit.
      if (!d.location.type) {
        errors.push({ path: "location.type", message: "Location type is required" });
      } else if (!activeLocationTypeCodes.includes(d.location.type)) {
        // F4.162 (D9): the stored value is operator text and is not echoed; the
        // codes are what the operator can pick from.
        errors.push({
          path: "location.type",
          message: `Location type is not an active code; use one of: ${activeLocationTypeCodes.join(", ")}`,
        });
      }
    }

    const rtuCount = d.rtus?.length ?? 0;
    if (d.rtus) {
      d.rtus.forEach((rtu, i) => {
        const r = draftRtuSchema.safeParse(rtu);
        if (!r.success) {
          for (const issue of r.error.issues) {
            errors.push({ path: `rtus.${i}.${issue.path.join(".")}`, message: issue.message });
          }
        }
        if (rtu.protocol === "mqtt" && rtu.ingestEnabled && !rtu.credentialsSet) {
          errors.push({
            path: `rtus.${i}.credentialsSet`,
            message: "MQTT ingest requires credentials",
          });
        }
        if (rtu.protocol === "mqtt" && !rtu.config.topic && !rtu.config.mqttTopic) {
          const topic = rtu.config.topic ?? rtu.config.mqttTopic;
          if (!topic) {
            errors.push({
              path: `rtus.${i}.config.topic`,
              message: "MQTT topic is required",
            });
          }
        }
      });
    }

    if (d.assets) {
      d.assets.forEach((asset, i) => {
        const a = draftAssetSchema.safeParse(asset);
        if (!a.success) {
          for (const issue of a.error.issues) {
            errors.push({ path: `assets.${i}.${issue.path.join(".")}`, message: issue.message });
          }
        } else if (asset.rtuIndex >= rtuCount) {
          errors.push({
            path: `assets.${i}.rtuIndex`,
            message: "rtuIndex out of range",
          });
        }
      });
    }

    if (d.pointKeys) {
      d.pointKeys.forEach((pk, i) => {
        const p = draftPointKeySchema.safeParse(pk);
        if (!p.success) {
          for (const issue of p.error.issues) {
            errors.push({ path: `pointKeys.${i}.${issue.path.join(".")}`, message: issue.message });
          }
        }
      });
    }

    if (d.assetPoints) {
      const assetCount = d.assets?.length ?? 0;
      d.assetPoints.forEach((ap, i) => {
        const p = draftAssetPointSchema.safeParse(ap);
        if (!p.success) {
          for (const issue of p.error.issues) {
            errors.push({ path: `assetPoints.${i}.${issue.path.join(".")}`, message: issue.message });
          }
        } else if (ap.assetIndex >= assetCount) {
          errors.push({
            path: `assetPoints.${i}.assetIndex`,
            message: "assetIndex out of range",
          });
        }
      });
    }

    if (!d.location) {
      errors.push({ path: "location", message: "Location is required before commit" });
    }
    if (!d.rtus || d.rtus.length === 0) {
      errors.push({ path: "rtus", message: "At least one RTU is required before commit" });
    }
    if (!d.assets || d.assets.length === 0) {
      errors.push({ path: "assets", message: "At least one asset is required before commit" });
    }
  }

  /**
   * Infers the current onboarding phase from draft completeness.
   *
   * `F4.162` (D9): a type that is not in `activeLocationTypeCodes` keeps the
   * phase at `location`, as a missing one does, so the chat asks for it again.
   */
  inferPhase(draft: unknown, activeLocationTypeCodes: readonly string[]): OnboardingPhase {
    const d =
      typeof draft === "object" && draft !== null ? (draft as OnboardingDraft) : {};
    if (!d.location?.name) {
      return "location";
    }
    // F4.157: a location with no type stays here, so the chat asks for it.
    if (
      !d.location.code ||
      !d.location.type ||
      !activeLocationTypeCodes.includes(d.location.type) ||
      d.location.latitude === undefined
    ) {
      return "location";
    }
    if (!d.rtus || d.rtus.length === 0 || !d.rtus.every((r) => r.protocol && r.code)) {
      return "rtu";
    }
    if (d.rtus.some((rtu) => this.rtuNeedsMqttSetup(rtu))) {
      return "rtu";
    }
    if (!d.pointKeys || d.pointKeys.length === 0) {
      if (!d.onboardingMeta?.useExistingPointKeys) {
        return "point_keys";
      }
    }
    if (!d.assets || d.assets.length === 0) {
      return "assets";
    }
    if (!d.assetPoints || d.assetPoints.length === 0) {
      return "mappings";
    }
    return "review";
  }

  private rtuNeedsMqttSetup(rtu: NonNullable<OnboardingDraft["rtus"]>[number]): boolean {
    if (rtu.protocol !== "mqtt" || !rtu.ingestEnabled) {
      return false;
    }
    if (!rtu.credentialsSet) {
      return true;
    }
    const topic = String(rtu.config?.topic ?? rtu.config?.mqttTopic ?? "").trim();
    return !topic || topic === "-";
  }
}
