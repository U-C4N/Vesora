# Observation metadata and Studio/Embed

Implemented in the `0.9.0-rc.8` review candidate. The fixed `0.9.0-rc.6` archives do not contain these additions. See the [candidate notes](releases/v0.9.0-rc.8.md) for publication status and the [wire contract](plans/observation-contract-v1.md) for validation bounds and compatibility rules.

## Declare the meaning of a channel

JavaScript and Python use the same JSON schema. Declarations describe existing values; they do not convert units, download references, or execute transforms.

```ts
import {figure, toHTML} from '@vesora/core';

const fig = figure({title: 'Temperature'});
const signal = fig.plot([0, 1, 2], [273.25, 274.5, 275.75]);
signal.setSemantics({
  x: {quantity: 'time', unit: 's'},
  y: {
    quantity: 'temperature', unit: 'K', dimension: 'temperature',
    origin: {datasetId: 'experiment-17', field: 'temperature'},
    transforms: [{execution: 'external', name: 'sensor-calibration',
      version: '2', parameters: {gain: 1.25}}],
  },
});
const declaration = signal.getSemantics(); // Detached channel declarations.
const html = toHTML(fig, {observation: true}); // No renderer required.
```

```python
import vesora as vs

fig = vs.figure(title="Temperature")
signal = fig.plot([0, 1, 2], [273.25, 274.5, 275.75])
signal.set_semantics({
    "x": {"quantity": "time", "unit": "s"},
    "y": {"quantity": "temperature", "unit": "K"},
})
declaration = signal.get_semantics()
fig.save_html("temperature.html", observation=True)
```

A patch replaces each supplied channel's declaration. Omitted channels keep their declarations; `null` / `None` removes one. Unknown channels, conflicting declarations for aliased sources, executable values and invalid metadata fail before mutation. Copy-on-write source replacements carry declarations to the new source; removal cleans a declaration only after its last reference is gone. Derived slices require explicit declarations.

Snapshots store declarations in `figure.semantics.sources`, keyed by source ID. Metadata promotes the scene to protocol 8; legacy protocols 1–7 still import. Numeric buffers, HTML `formatVersion: 1`, and transport protocols 2/3 are unchanged.

## Capture accepted data or the displayed frame

```ts
fig.mount(document.getElementById('plot')!);
await fig.ready();
fig.freezeInspection();
const displayedHTML = toHTML(fig, {source: 'displayed', observation: true});
const acceptedHTML = toHTML(fig, {source: 'accepted', observation: true});
```

| Capture | Data and metadata | Representation record |
| --- | --- | --- |
| `accepted` (default) | Latest accepted scene and retained source values | `not-evaluated` |
| `displayed` | Last completed frame, including its frozen scene and retained stream window | `rendered`, with frame ID, optional snapshot ID and per-layer representation |

Scene, bytes, source versions, stream intervals and representation are captured synchronously from the same owned state. A pending private view edit does not appear in a displayed export before its frame commits. Stream intervals are half-open: `[sequenceStart, sequenceEndExclusive)`. They describe retained data; reopening HTML does not reconnect a producer or restore a live stream.

Python exports accepted captures under the figure lock. It does not invent a JavaScript frame ID or a cross-host revision. JavaScript's `applySnapshot()` validates an imported record atomically; `getObservation()` returns a detached copy. Successful changes to the captured scene invalidate the imported record; failed changes leave it intact. Frozen edits invalidate only that frozen scene's record. Existing protocol-7 inspection restoration keeps its original, separate lifecycle.

Observation export is opt-in. Ordinary re-export removes an imported record from the exported copy; `observation: true` creates a fresh record. Declarations remain in both cases. The record is descriptive evidence, not a cryptographic signature, executable pipeline, unit-conversion system or numerical error certificate.

## Use one viewer in two contexts

```ts
import {mountViewer} from '@vesora/core/viewer';

const viewer = mountViewer(fig, container, {
  mode: 'embed',
  chrome: {toolbar: true, inspector: false, status: true, help: false},
  themeTokens: {accent: '#79b7ff'},
  exportSource: 'displayed',
  observation: true,
});
viewer.updateOptions({mode: 'studio', chrome: {inspector: true}});
// Switching chrome keeps the mounted figure, camera and frozen capture.
viewer.dispose(); // The application still owns fig.
```

Mount the viewer on an unmounted figure. Studio is the default and shows the full sidebar; Embed starts with the sidebar and help hidden. `chrome` explicitly overrides those defaults. The existing `inspector` option controls the sample inspector disclosure, whereas `chrome.inspector` controls the whole sidebar. Layout follows the viewer container's width, including a 320 px card inside a wide page. Controls and styles are scoped to the viewer.

The sidebar shows actual channel declarations and imported observation details, using the displayed scene while frozen. Export options choose accepted/displayed data and whether HTML includes an observation. PNG exports an image and carries no observation record.

`themeTokens` changes viewer colors only: `background`, `panel`, `text`, `muted`, `border`, `control`, `accent`, `error`. Plot themes still use the figure's theme API. Import viewers can use `preserveTheme: true` to retain captured plot styling.

```tsx
import {VesoraViewer} from '@vesora/react/viewer';

<VesoraViewer figure={fig} mode="embed" chrome={{inspector: false}}
  themeTokens={{accent: '#79b7ff'}} exportSource="displayed" observation />
```

React updates mode/chrome/tokens/export defaults without remounting or closing the borrowed figure. Run `npm run demo:react` and open `?demo=workbench` for the working Studio and independent 320 px Embed example.

## Repeated scatter queries

The planner can reuse an exact 64×64 spatial grid for repeated queries of the same source versions. The first query scans normally. A later query may build an index; narrow warm queries visit candidate cells and still apply the original coordinate predicates, density aggregation and point budget. Point results retain source order. No sampling is introduced.

Worker-owned sources and immutable fallback chunks are eligible. Mutable caller arrays stay on the scan path. Tiny sources, an index larger than its budget, unrepresentable bounds and broad queries fall back to scanning. Source replacement, release and worker recovery invalidate the relevant cache. The index has a separate 8 MiB limit per worker/fallback cache, in addition to result and line-index budgets, and retains no source arrays.

`fig.diagnostics().scatterIndex` exposes worker/fallback builds, candidate rows, warm queries and index bytes. The index has a cold build cost; it is not an across-the-board latency guarantee. Reproduce the focused CPU measurements with:

```sh
node scripts/benchmark-scatter-index.mjs
node scripts/benchmark-html-encoding.mjs
```

These measure planner/encoding CPU work, not end-to-end frame latency or GPU speed. HTML encoding uses bulk byte copies on little-endian hosts while preserving chunk boundaries and exact binary output.
