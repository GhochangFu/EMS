import {
  PROVENANCE_CLASS,
  PROVENANCE_MARKER,
  PROVENANCE_TITLE,
  isLiveProvenance,
  provenanceMarker,
  type ValueProvenance,
} from "./value-provenance";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const ALL: ValueProvenance[] = [
  "measured",
  "derived",
  "nameplate",
  "configuration",
  "simulated",
];

/** Unit checks for value provenance (ADR 0028). */
export function runValueProvenanceTests(): void {
  // Telemetry-backed kinds are the ones ADR 0027's staleness gate can reach.
  assert(isLiveProvenance("measured"), "measured is live");
  assert(isLiveProvenance("derived"), "derived is live");

  // The three static kinds are precisely the ones the gate cannot reach, which
  // is why they must carry a marker instead.
  assert(!isLiveProvenance("nameplate"), "nameplate is not live");
  assert(!isLiveProvenance("configuration"), "configuration is not live");
  assert(!isLiveProvenance("simulated"), "simulated is not live");

  // A live kind renders no marker at all rather than an empty element — the
  // component branches on null, so an empty string would emit a stray span.
  assert(provenanceMarker("measured") === null, "measured has no marker");
  assert(provenanceMarker("derived") === null, "derived has no marker");

  // Every static kind must produce a non-empty, distinct marker. Two kinds
  // sharing a marker would make the annotation useless.
  const markers = new Set<string>();
  for (const kind of ALL) {
    if (isLiveProvenance(kind)) {
      continue;
    }
    const marker = provenanceMarker(kind);
    assert(marker !== null && marker.length > 0, `${kind} has a marker`);
    assert(!markers.has(marker as string), `${kind} marker is distinct`);
    markers.add(marker as string);
  }

  // Each lookup is a Record over the union, so a new kind is a compile error
  // rather than a silent fall-through. This asserts the runtime side of that:
  // no kind may be missing a title, and every static kind needs a class.
  for (const kind of ALL) {
    assert(PROVENANCE_TITLE[kind].length > 0, `${kind} has a title`);
    assert(
      PROVENANCE_TITLE[kind].toLowerCase().includes("reading"),
      `${kind} title says whether it is a reading`,
    );
    assert(typeof PROVENANCE_MARKER[kind] === "string", `${kind} has a marker entry`);
    if (!isLiveProvenance(kind)) {
      assert(PROVENANCE_CLASS[kind].length > 0, `${kind} has a style token`);
    }
  }

  // The static kinds must be visually distinguishable from each other, not just
  // from live values: nameplate and setpoint mean different things to an
  // operator deciding whether something is adjustable.
  const classes = ALL.filter((kind) => !isLiveProvenance(kind)).map(
    (kind) => PROVENANCE_CLASS[kind],
  );
  assert(new Set(classes).size === classes.length, "static kinds are styled distinctly");
}
