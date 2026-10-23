# C1 observation contract: implementation specification

Date: 2026-10-23. Status: implemented in the development tree for the next release, with JS/Python fixtures and browser integration checks. Not included in the fixed RC6 archives. See the [usage guide](../observation.md).

## Decision source and scope

The accepted product direction is the shared engine with equally important research/engineering and frontend/SaaS experiences. The task order is existing RC evidence, observation model, performance, then Studio/Embed. The parent strategy is [the v1 strategy](v1-strategy-2026-10-23.tr.md), especially C1 and M1. C1 asks for versioned semantics, units, source/transform/representation metadata, JS/Python/import-export fixtures, invalid-reference rejection, and legacy protocol compatibility.

The API names, schema shape, protocol number, bounds, invalidation rules, and first vertical slice below describe the current implementation. They remain subject to review before the next stable release. The user's later instruction explicitly authorized product implementation without waiting for the long soak or human sessions. Existing fixed RC archives and their manifests were not regenerated as part of C1.

C1 delivers metadata and a portable capture record through the existing self-contained HTML route. It does not implement the larger O1 product: a general capsule file format, cryptographic verification, executable transform replay, history recording, annotations on captures, or PDF/SVG output. Units are declarations in C1; dimensional checking and conversion belong to S1. The term representation record means a description of an actual completed render, not a new mathematical error certificate.

## Current implementation constraints

- `types.ts` supports scene protocols 1-8. `Figure.applySnapshot` validates a complete candidate registry before replacing the current figure.
- `DataDescriptor` contains id, dtype, shape, version and byte length. `DataRegistry.set`/`describeData` reconstruct descriptors. Adding arbitrary descriptor fields would require changes to all copy/update/worker paths.
- `SnapshotStore.capture` owns or shares immutable sources behind a bounded lease; `FigureView.captureExport` captures accepted or displayed data. `view.ts` has completed-frame representation information in `infos`.
- `FigureSpec.inspection` is existing protocol-7 metadata. Its imported baseline deliberately survives view/style changes, but becomes invalid when source identity changes. C1 must not redefine that contract.
- HTML has `formatVersion: 1`, a snapshot, source bytes and capture metadata. Python and JS use the same bundled viewer. There is no reason to change the outer file envelope for an optional scene feature.
- Python captures scene and bytes under its figure lock. A Python Figure currently has no single authoritative numeric accepted revision: desktop and notebook transports own local revisions. Numeric JS frame/revision counters cannot be presented as universal cross-host identities.

Source entry points: [types](../../packages/core/src/types.ts), [figure](../../packages/core/src/figure.ts), [view](../../packages/core/src/view.ts), [snapshot ownership](../../packages/core/src/snapshot-store.ts), [JS HTML](../../packages/core/src/html-export.ts), [Python figure](../../python/vesora/figure.py), [Python HTML](../../python/vesora/html.py).

## First vertical slice

1. A Python or JS caller declares the meaning of numeric layer channels.
2. The declaration is validated, cloned and carried through ordinary scene snapshots and host transport.
3. The caller requests an observation-bearing HTML export. The export binds the declarations to the exact snapshot/source versions it contains.
4. The bundled viewer imports that scene and can expose the observation record through the core API. A fixture proves that Python-produced HTML and JS-produced HTML preserve the same semantics and numeric values.
5. A browser displayed export can also describe the completed representation and retained stream window. An accepted export explicitly says that no rendered representation was evaluated for that capture.

The shared viewer now exposes the validated declarations and imported record in its read-only metadata section. Studio/Embed and React presentation props use that same displayed snapshot; React introduces no independent metadata state.

## Wire schema

Add `OBSERVATION_PROTOCOL_VERSION = 8`. Store semantics in `FigureSpec`, keyed by existing source IDs, to keep binary descriptors and worker data packets unchanged.

```ts
type MetadataScalar = string | number | boolean | null;

interface ExternalTransformDescription {
  execution: 'external';
  name: string;
  version?: string;
  parameters?: Record<string, MetadataScalar>;
}

interface SourceSemantics {
  name?: string;
  quantity?: string;
  unit?: string;
  dimension?: string;
  origin?: {
    datasetId: string;
    field?: string;
    reference?: string;
  };
  transforms?: ExternalTransformDescription[];
}

interface FigureSemantics {
  schemaVersion: 1;
  sources: Record<string, SourceSemantics>;
}

interface ObservationRecord {
  schemaVersion: 1;
  source: 'accepted' | 'displayed';
  capturedAt: string;
  sourceVersions: Array<{id: string; version: number}>;
  streams: Array<{
    layerId: string;
    streamId: string;
    revision: number;
    sequenceStart: number;
    sequenceEndExclusive: number;
  }>;
  representation:
    | {status: 'not-evaluated'}
    | {
        status: 'rendered';
        frameId: number;
        snapshotId?: string;
        layers: Array<RepresentationInfo & {layerId: string; panelId?: string}>;
      };
}

// Optional additions to FigureSpec:
// semantics?: FigureSemantics;
// observation?: ObservationRecord;
```

`sourceVersions` covers every embedded descriptor exactly once, including sources without a semantic declaration. There are no external-only numeric sources in C1. A source's semantic declaration resides at `figure.semantics.sources[id]`; it is not duplicated inside the record.

`unit` and `dimension` are opaque, bounded strings. `dimension: "temperature"` is descriptive and does not assert that a unit parser verified it. Missing declarations mean unknown, not dimensionless. Do not infer units from axis labels, or silently change axis labels when attaching semantics. Origin references are inert strings; import does not fetch them. Transform descriptions record user-supplied external processing and never invoke code. Flat finite scalar parameters deliberately avoid executable expressions and an unbounded graph model.

`sequenceStart = nextSequence - retained`; `sequenceEndExclusive = nextSequence`. Copy stream identity from the same capture owner as the buffers. C1 does not preserve evicted samples. The recorded range is the embedded retained window, not complete acquisition history.

The record intentionally omits a global accepted/displayed numeric revision and a fake globally unique observation ID. Source IDs/versions are meaningful within the embedded snapshot. A portable content digest, revision namespaces and externally verifiable capsule identity are O1 decisions. Existing protocol-7 `inspection` can still carry its original frame and selection metadata.

## Proposed public API

```ts
const line = fig.plot(x, y);
line.setSemantics({
  x: {name: 'Elapsed time', quantity: 'time', unit: 's', dimension: 'time'},
  y: {
    name: 'Temperature', quantity: 'temperature', unit: 'K',
    dimension: 'temperature',
    origin: {datasetId: 'experiment-17', field: 'temperature'},
    transforms: [{execution: 'external', name: 'sensor-calibration', version: '2'}],
  },
});
const declarations = line.getSemantics(); // cloned channel-keyed map
line.setSemantics({y: null});              // remove this source declaration
const html = toHTML(fig, {source: 'displayed', observation: true});
const record = fig.getObservation();      // imported record clone, or undefined
```

```python
line = fig.plot(x, y)
line.set_semantics({
    "x": {"name": "Elapsed time", "quantity": "time", "unit": "s"},
    "y": {"name": "Temperature", "quantity": "temperature", "unit": "K",
          "origin": {"datasetId": "experiment-17", "field": "temperature"}},
})
document = fig.to_html(observation=True)
fig.save_html("measurement.html", observation=True)
```

Python wire dictionaries retain the shared schema keys, as existing presentation dictionaries do. Python method names use snake_case. Both setters patch by channel; each non-null channel value replaces that channel's entire declaration. Unknown layer channels fail; null deletes; omitted channels remain unchanged. Return the layer for chaining.

The initial Python API captures accepted state only, matching current `to_html`. It does not pretend that the Python facade knows one particular connected view's displayed frame. Displayed capture from a Python-backed figure remains available through its browser/shared viewer. A new Python viewer round trip for displayed capture is a separate follow-up, not silently substituted by accepted data.

`observation` defaults to false, preserving existing export payload behavior. Semantic declarations are part of the scene and are retained even when an observation record is not requested. `getObservation()` returns the record attached by import; regular live figures need not have a record. The export helper creates a record on its detached lease, not on the live figure. No new public lease type is needed in C1.

## Validation and atomicity

Use dedicated `observation.ts` and Python `observation.py` validators rather than broadening the existing statistical `semantics.ts` module.

Proposed bounds for review: 256 characters for name/quantity/unit/dimension/datasetId/field/transform name/version; 2048 for origin reference; 16 transforms per source; 32 parameter keys per transform; 64 characters per key; 1024 characters per string parameter. Numbers must be finite JSON numbers. Reject bool-as-number where integer fields are required in Python. Reject unknown schema versions, unknown object keys, non-plain metadata objects, functions, cyclic values and non-JSON parameters. Metadata keys and references must be treated as data using own-property checks; dangerous object keys must not alter prototypes.

Setters validate and clone every patch before changing any source declaration or protocol number. Getters return detached data. Failed patches leave scene, protocol, sources, accepted state and host publications unchanged. Bound total declarations by existing source count; bound representation records by existing layer count; do not allocate arrays based on unvalidated untrusted counts.

Import validation must establish:

- Semantics schema 1, source IDs all exist in the candidate registry, and every declaration has at least one supplied field.
- Observation schema 1 and parseable UTC capture time emitted in the existing ISO format.
- Exactly one `sourceVersions` entry per descriptor, with matching versions and no duplicates or dangling references.
- Stream layer/source references exist; sequences/revisions are nonnegative safe integers; the interval length matches the embedded streaming-compatible source row count. The interval is metadata, not restored live streaming state.
- Accepted records have `not-evaluated`. Rendered records require displayed capture, valid frame ID, existing panel/layer references and unique layer records. Counts are nonnegative safe integers, optional fields are validated, and method is bounded text.
- Do not apply a generic `rendered <= total` rule: surfaces count triangles while total can count source values. Preserve current count units and methods.
- Representation records describe visible completed layers, so hidden layers need not have a record. Preserve the same layer/panel attribution as `inspect()`.
- Incoming record provenance is a declaration to validate structurally, not a trusted proof that an external producer ran an algorithm. C1 has no cryptographic attestation.

All these checks run against the temporary registry/spec before `applySnapshot` commits. An invalid observation must not partially apply otherwise valid numeric sources.

## Capture ownership and mutation rules

**JS capture:** call the existing export capture transaction once; attach observation metadata to that owned snapshot; serialize buffers from the same lease; release in `finally`. Never collect `snapshot()`, `inspect()` and streaming state across asynchronous waits from the mutable live figure. For displayed captures, add a small internal capture-context method or lease extension in `FigureView` so `infos`, stream windows and frame identity are copied at the same synchronous capture boundary. Camera/slice changes during frozen inspection can schedule a new frame; representation must describe the committed frame that supplied the export, not a pending edit. This deserves a direct regression test before the API is considered complete.

**Accepted capture:** collect accepted source descriptors and stream windows; use `representation: {status: 'not-evaluated'}` even when a viewer happens to exist. A completed old frame cannot certify newly accepted data. This avoids forcing rendering or creating a browser merely to export from Python.

**Python capture:** collect scene, bytes, stream state and timestamp under the existing lock; build the record from those copies. Serialization may run after releasing the lock. No additional host or numeric dependency is needed.

**Declarations:** setData/appendData preserve user-declared channel meaning by API definition; they do not verify that a newly supplied array actually follows the described calibration or unit. Document that callers must replace declarations when the meaning changes. Data version records change on capture. Copy-on-write source-ID replacement must migrate the declaration to the replacement source; preserve the old declaration while any other channel still references the old source. Removing the last reference removes its declaration. Shared source IDs have shared semantics; conflicting patches to aliased channels in one call must reject atomically rather than depending on iteration order.

**Derived slices:** in the first slice, metadata inheritance is explicit, not inferred. A caller may set semantics on the slice's own source channels. Parent surface metadata changes must not silently rewrite independent declarations. Automatic slice lineage belongs to a later typed derivation model. Existing exact-slice numeric integrity remains mandatory.

**Imported observation:** the record describes the imported complete scene. Clear `figure.observation` when any supported operation changes data, semantics, view, layout, visibility, style, categories, statistics options, slices or selection. Retain `figure.semantics` according to the rules above. This strict rule avoids presenting an old representation as the current one. Add a separate baseline for observation metadata; do not reuse or broaden the looser protocol-7 imported-inspection baseline. Initial applySnapshot must preserve the imported record rather than invalidate it via its own `changed()` call. Failed mutations must not clear it. Ordinary live-source changes must not clear the record in an already captured frozen/owned scene.

On re-export with `observation: true`, create a fresh record for the new owned capture. On re-export with the default false, omit the old observation record from the new capture if it no longer describes that capture; do not manufacture a newly captured observation from historical fields. The simplest policy is to strip `figure.observation` in ordinary export unless explicitly requested, while retaining semantics and existing protocol-7 inspection behavior. This policy needs documentation and a fixture.

## Compatibility

- Existing protocol 1-7 fixtures and exports retain their current schema and numbering unless new semantics/observation is present.
- Attaching semantics or a record promotes to 8. Removing the last field does not downgrade the protocol, matching existing monotonic promotion.
- New reader accepts 1-8. Semantics/observation fields on a declared protocol below 8 are rejected, even if otherwise structurally valid.
- Old readers reject protocol 8; they must not silently drop scientific meaning. Backward compatible here means new readers preserve old scenes, not old readers understand new scene features.
- Keep HTML `formatVersion: 1` and transport versions 2/3. The bundled runtime must understand the scene protocol; old host/runtime mismatch should yield an explicit unsupported protocol error.
- Keep `DataDescriptor`, binary encoding, worker sources and the protocol-7 inspection shape unchanged.
- Update supported protocol lists in future package manifests and verifiers, while leaving fixed RC6 manifests/evidence intact. Existing checks asserting protocol 7 for unchanged PRISM fixtures remain valid.

## File ownership and implementation sequence

| Step | Files | Result |
| --- | --- | --- |
| 1 | New `packages/core/src/observation.ts`; `types.ts`, `index.ts`; new Python `observation.py` | Shared schema/types, bounded pure validators; no renderer dependency |
| 2 | `figure.ts`, Python `figure.py` | Channel setters/getters, protocol 8 promotion, declaration lifecycle, import validation and separate record invalidation |
| 3 | `view.ts`, `html-export.ts`, Python `html.py` and `figure.py` | Opt-in capture record at one ownership boundary; completed vs not-evaluated representation |
| 4 | `standalone.ts` plus source parity fixture | Offline imports retain semantics/record and fail invalid payloads without executing metadata |
| 5 | API/protocol docs; future package protocol-list scripts | Explain scope, export choice, legacy support and the C1/O1 boundary |

No worker/planner optimization, viewer redesign, new package dependency or source hash work is bundled into these steps. New tests are justified by cross-host contracts and stale-observation failure modes, not merely setter/getter implementation details.

## Acceptance fixtures and tests

| Test group | Concrete fixture/assertion |
| --- | --- |
| Cross-language semantics | Identical Float32 temperature/time sources with Unicode text, units, origin and external calibration. Python and JS produce equivalent canonical semantics, source descriptors and decoded bytes after generated IDs are mapped. JSON key order is not a semantic comparison. |
| Legacy | Existing 1-7 examples still load; no metadata/default exports retain previous shape. Version 8 is accepted; version 7 carrying new fields and unknown semantics schema fail. |
| Atomic bad references | Unknown source, layer or panel; duplicate/missing/mismatched sourceVersions; unknown channel; invalid parameter; conflicting aliased-channel patch. Before/after snapshot and bytes match on failure. |
| Ownership | Mutate the caller's input dictionaries and getter results; append/update after capture starts. Previously exported declarations and bytes remain unchanged. |
| Displayed vs accepted | Render revision A, freeze, append B and evict A from live storage. Displayed export contains A's bytes, source versions, sequence window and completed representation; accepted export contains B's retained window and `not-evaluated`. |
| Frozen pending edit | Change inspection camera/slice while a frame is pending, request export, then let frame finish. Record and bytes follow the same documented capture frame, with no mix of pending spec and old `infos`. |
| Python independence | Headless accepted export with no Qt/Jupyter host imports offline with the same semantics. No rendered frame or universal revision is invented. |
| Lifecycle | setData/append preserve declared meaning; source-ID replacement/membership changes preserve only appropriate entries; remove/close cleans current declarations and leases; overflow/failure leaks no new snapshot reservation. |
| Imported record invalidation | Successful data/view/semantic/selection/style edit clears the imported record; failed edit retains it; first import retains it; frozen owner survives live edits. Existing protocol-7 inspection behavior stays unchanged. |
| Representation meaning | Sparse scatter, dense scatter, reduced line, histogram with excluded values, and surface with omitted triangles retain current kind/method/count meanings. Density exact count is not relabeled as every point drawn. |
| HTML safety | Literal `</script>`, ampersands, Unicode separators and markup in source/transform metadata reopen as plain data. Unknown fields and executable/function parameters reject. Origin reference causes no request. |
| Offline round trip | Python HTML and JS displayed HTML open with network disabled, core `getObservation()` exposes the expected record, and numeric source values/selection semantics remain intact. Re-export policy is checked explicitly. |

Suggested files: `tests/unit/observation.test.ts`, `tests/python/test_observation.py`, `tests/browser/observation.spec.mjs`, plus a small versioned fixture under `tests/fixtures/observation-v1/` consumed by both languages. Extend `scripts/parity.mjs` rather than introducing a second unrelated parity harness. Run focused tests first, then existing snapshot/HTML/protocol/streaming suites and typecheck/build. Do not mix performance measurements with RC soak processes.

Completion means one working Python-to-offline-to-JS and one frozen-streaming-to-offline path with matched data/semantics, safe invalidation, explicit representation scope and legacy compatibility. A TypeScript interface alone does not complete C1; this slice also does not complete O1 or substantiate academic novelty.
