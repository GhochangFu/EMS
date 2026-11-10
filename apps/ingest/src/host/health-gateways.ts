/**
 * The health body's gateway lines (`E7.2`, ADR 0123 decision 12, plan C12).
 *
 * One line per edge gateway on the cloud host, from the gateway snapshot the
 * receiver authenticates against. **Never part of the verdict**: a gateway is
 * a box at a site, and its uplink being down is that site's state, not this
 * host's — the edge keeps its backlog on its own disk. So the header's
 * `ok`/`degraded` is computed before these lines and ignores them.
 *
 * Out of `health-server.ts` because §4.5 caps a file at 1000 lines and the
 * existing spec is near it; the server only appends what this renders.
 */

/** What the health body may show of one gateway. No hash, no token field. */
export type GatewayHealth = {
  readonly id: string;
  readonly code: string;
  readonly organizationCode: string;
  readonly status: "active" | "revoked";
  /** The organization's ADR 0115 switch. */
  readonly ingestEnabled: boolean;
  /** Active RTUs assigned to the gateway — the cloud dials none of them. */
  readonly rtus: number;
  readonly lastSeenAt: Date | null;
  readonly reportedBacklog: number | null;
  readonly clockState: "synced" | "unsynced" | null;
  readonly dirtyFrom: Date | null;
  readonly dirtyTo: Date | null;
};

/**
 * Renders the gateway lines. `encode` is the health body's identifier encoder
 * (`token` in `health-server.ts`), passed in so this module needs no import
 * back into the server: a gateway `code` is admin-entered, so it is input.
 *
 * A **revoked gateway that still has RTUs assigned** gets a second line,
 * `revoked-gateway`: the cloud plan dials no RTU an edge serves (decision 6)
 * and the revoked box is refused, so those RTUs are silent until they are
 * unassigned or the box is replaced. It is a line, not a verdict change —
 * security review L2 of PR 2.
 */
export function renderGatewayLines(
  gateways: readonly GatewayHealth[],
  encode: (value: string) => string,
): string[] {
  const lines: string[] = [];
  for (const gateway of gateways) {
    const dirty =
      gateway.dirtyFrom === null || gateway.dirtyTo === null
        ? "none"
        : `${gateway.dirtyFrom.toISOString()}..${gateway.dirtyTo.toISOString()}`;
    lines.push(
      `gateway id=${encode(gateway.id)} code=${encode(gateway.code)} org=${encode(gateway.organizationCode)} ` +
        `status=${gateway.status} ingest=${gateway.ingestEnabled ? "on" : "off"} rtus=${gateway.rtus} ` +
        `lastSeen=${gateway.lastSeenAt?.toISOString() ?? "never"} ` +
        `backlog=${gateway.reportedBacklog ?? "unknown"} clock=${gateway.clockState ?? "unknown"} ` +
        `dirty=${dirty}`,
    );
  }
  for (const gateway of gateways) {
    if (gateway.status === "revoked" && gateway.rtus > 0) {
      lines.push(
        `revoked-gateway id=${encode(gateway.id)} code=${encode(gateway.code)} rtus=${gateway.rtus} ` +
          "note=assigned-rtus-are-silent",
      );
    }
  }
  return lines;
}
