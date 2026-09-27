import { render, screen } from "@testing-library/react";
import { expect } from "vitest";

import { KpiTile } from "./kpi-tile";

/**
 * `F4.164` U1 — `KpiTile`'s error branch is announced (`role="alert"`), and
 * the stale caption follows the amber ring rather than gating on
 * `status === "ready"` (plan D1): the ring already draws for any truthy
 * `stale`, and the caption explains the ring.
 */

const STALE_CAPTION = "Stale · no telemetry ~10s";

export function anErrorTileIsAnnouncedAsAnAlert(): void {
  render(<KpiTile label="PUE" status="error" value={null} />);

  const alert = screen.getByRole("alert");
  expect(alert).toHaveTextContent("Could not load");
}

export function aReadyTileWithAValueShowsNoAlert(): void {
  render(<KpiTile label="Total load" status="ready" value="12" />);

  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByText("12")).toBeInTheDocument();
}

export function aStaleLoadingTileShowsTheCaption(): void {
  render(<KpiTile label="PUE" status="loading" value={null} stale />);

  expect(screen.getByText(STALE_CAPTION)).toBeInTheDocument();
}

export function aStaleErrorTileShowsTheCaptionBesideTheAlert(): void {
  render(<KpiTile label="PUE" status="error" value={null} stale />);

  expect(screen.getByRole("alert")).toBeInTheDocument();
  expect(screen.getByText(STALE_CAPTION)).toBeInTheDocument();
}

export function aStaleReadyTileShowsTheCaption(): void {
  render(<KpiTile label="PUE" status="ready" value="1.42" stale />);

  expect(screen.getByText(STALE_CAPTION)).toBeInTheDocument();
}

export function aNonStaleReadyTileShowsNoCaption(): void {
  render(<KpiTile label="PUE" status="ready" value="1.42" stale={false} />);

  expect(screen.queryByText(STALE_CAPTION)).not.toBeInTheDocument();
  expect(screen.getByText("1.42")).toBeInTheDocument();
}
