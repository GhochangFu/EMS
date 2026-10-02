// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  accentsTheDescriptorCore,
  drawsNoImgElement,
  navigatesToTheReturnPath,
  navigatesToTheRootWithoutAReturnPath,
  showsNoBannerForARefusedPath,
  showsNoBannerWithoutAReturnPath,
  showsTheBannerInOidcMode,
  showsTheSessionEndedBanner,
  readsNoTrinetra,
  readsTheCardHeading,
  readsTheCardSentence,
  readsTheFooterVersion,
  readsTheHeroHeadline,
  readsTheRolePills,
  showsTheWordmark,
} from "./login-page.spec";
import { useAuthStore } from "../stores/auth-store";

/**
 * `F3.33` U4 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014); the jsdom
 * docblock is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("F3.33 the login page reads IONSiTE NEXUS", () => {
  it("L1 shows the wordmark as a named image", () => {
    showsTheWordmark();
  });

  it("L2 reads the hero headline", () => {
    readsTheHeroHeadline();
  });

  it("L2b accents Building, Energy, Water & Utility in the headline", () => {
    accentsTheDescriptorCore();
  });

  it("L3 reads the card heading", () => {
    readsTheCardHeading();
  });

  it("L4 reads the card sentence", () => {
    readsTheCardSentence();
  });

  it("L5 reads the three role pills in order", () => {
    readsTheRolePills();
  });

  it("L6 reads the footer version line", () => {
    readsTheFooterVersion();
  });

  it("L7 draws no img element", () => {
    drawsNoImgElement();
  });

  it("L8 reads no TRINETRA", () => {
    readsNoTrinetra();
  });
});

describe("F3.77 the login page after a wall session ends", () => {
  afterEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    useAuthStore.getState().clearSession();
  });

  it("L9 shows the session-ended banner while a return path is stored", () => {
    showsTheSessionEndedBanner();
  });

  it("L10 shows the banner in OIDC mode too", () => {
    showsTheBannerInOidcMode();
  });

  it("L11 shows no banner without a return path", () => {
    showsNoBannerWithoutAReturnPath();
  });

  it("L12 shows no banner for a refused stored path", () => {
    showsNoBannerForARefusedPath();
  });

  it("L13 a sign-in lands on the stored return path with replace", async () => {
    await navigatesToTheReturnPath();
  });

  it("L14 a sign-in with no return path lands on / with replace", async () => {
    await navigatesToTheRootWithoutAReturnPath();
  });
});
