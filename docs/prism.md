# Explore a live signal without losing the inspected frame

PRISM is the v0.9 scientific and telemetry workflow: a bounded live window, an independently frozen inspection snapshot, mixed 2D/3D panels and an optional Obsidian viewer. This checkout identifies itself as `0.9.0-rc.4` and remains under development. The [release checklist](releases/v0.9.0.md) distinguishes implemented behavior from publication gates that still require evidence.

WebGL2 is required. Existing `figure`, `VesoraChart`, scene protocols 1–6 and accepted-state exports remain available. New 3D layouts, 3D lines, surface presentation and slice relationships use scene protocol 7. Enabling streaming or freezing a view does not by itself promote a scene to protocol 7.

## Open the workbench

From the repository root, run:

```sh
npm run build
npm run demo:react
```

Open the local URL printed by Vite and add `?demo=workbench`. The three synthetic signals keep arriving while **Freeze view** holds the displayed samples. **Return to live** displays the newest retained window. The older `?demo=streaming` example still demonstrates an application-owned producer pause.

## Borrow a figure in the shared viewer

The following browser example expects an existing `<div id="chart"></div>`:

```js
import {figure} from '@vesora/core';
import {mountViewer} from '@vesora/core/viewer';

const fig = figure({title: 'Measurements', height: 440});
const signal = fig.plot([0, 1, 2], [3, 2, 1], {label: 'Signal'})
  .enableStreaming({maxPoints: 100_000});
fig.setHoverMode('x');
const viewer = mountViewer(fig, document.querySelector('#chart'), {
  theme: 'dark',
});
await fig.ready();
await signal.appendData({x: [3, 4], y: [0.9, 0.8]}, {waitFor: 'accepted'});

// When removing this UI:
viewer.dispose(); // unmounts; keeps the application's figure and data
fig.close();     // call when the application also finishes with the figure
```

`mountViewer` rejects a figure that already has a mounted view. It owns its DOM, listeners and attachment; the caller owns the figure. Its CSS is scoped to the viewer root and its controls use local event handlers. It does not restyle the surrounding page or install global shortcuts.

Grid panels stack in row-major order when the available plotting area becomes narrow. Panel IDs and the application's scene layout stay intact. Displayed PNG/HTML exports capture the rearranged layout. Set `responsivePanels: false` to retain fixed-grid scrolling. Direct `Figure.mount` keeps its previous layout behavior unless given `{responsivePanels: true}`.

The viewer supplies dark/light chrome, layer visibility, an inspector, diagnostics, freeze/resume, displayed-frame PNG/HTML exports, 3D camera presets and existing surface-slice controls. The inspector starts collapsed and opens when an observation is selected; expand it to use camera and slice controls, or pass `inspector: true` to open it initially. Technical frame and memory counters stay in Diagnostics. Scientific figures can freeze inspection even without a streaming layer. `preserveTheme: true` applies the selected theme to the chrome while keeping the scene's custom colors. `live: false` hides inspection freeze/resume controls for offline or legacy hosts. `exportHTML: false` omits the HTML action.

Clicking an observation keeps its full values, source index or surface cell/triangle, interpolation status and frame/source versions in the inspector after pointer leave. A displayed offline capture restores the selected observation with its capture time and source frame, so the reader can verify the recorded measurement.

For React, import `VesoraViewer` from `@vesora/react/viewer` and supply an application-owned `Figure`:

```tsx
import type {Figure} from '@vesora/core';
import {VesoraViewer} from '@vesora/react/viewer';

export function MeasurementPanel({figure}: {figure: Figure}) {
  return <VesoraViewer figure={figure} theme="dark" height={440} />;
}
```

Unmounting the React component disposes its viewer without closing the figure. Keep the figure reference stable between renders. Create and close producers in the application's lifecycle; the viewer does not take ownership of a timer, WebSocket or kernel task.

## Separate data acceptance from rendering

JavaScript `Layer.appendData`, `Figure.appendDataBatch` and React `appendRows` accept `{waitFor: 'accepted' | 'rendered'}`. The default remains `rendered`.

| Wait mode | Resolves when | During frozen inspection |
| --- | --- | --- |
| `accepted` | The validated transaction has committed to retained storage | Continues accepting bounded data |
| `rendered` | A completed frame covers the accepted update | Rejects with `PRESENTATION_FROZEN`; use accepted mode for a continuing producer |

Do not retry a batch blindly after a presentation failure: data can already have been accepted. Calling rendered mode when already frozen rejects before changing data with `accepted: false`. A presentation failure after acceptance includes `accepted: true`, its revision and sequence ranges; use these with the stream counters to determine whether it committed. Invalid transactions leave all series unchanged. A reset starts a new stream epoch. `ready({target: 'displayed'})` waits for the inspection view; ordinary `ready()` targets live rendering.

```js
await fig.ready();
const frozen = fig.freezeInspection();
await signal.appendData({x: [5, 6], y: [0.7, 0.6]}, {waitFor: 'accepted'});
console.log(frozen.snapshotId, fig.getInspectionState());
await fig.resumeLive();
```

This example continues the earlier figure before disposal. Frozen inspection owns an immutable snapshot with a separate camera/view. Its retained sample identities remain inspectable after the producer evicts those samples from live storage. `getDisplayedStreamingState(layerId)` describes the displayed window; `getStreamingState(layerId)` describes the live retained window.

`getInspectionState()` reports `mode`, accepted/displayed revisions, frame ID, optional snapshot ID/time, snapshot bytes/budget and displayed stream windows. `framepending`, `frame` and `inspectionchange` events let adapters retain application row references for the rendering and displayed windows. The React adapter uses these events to map callbacks by stream epoch and sequence, including frozen rows.

The inspection snapshot is bounded by `runtime.maxSnapshotBytes`. This budget is separate from live source, worker, geometry and application-owned memory. Releasing or resuming inspection releases its snapshot lease; references retained by application code remain the application's responsibility.

## Export the intended data

```js
import {toHTML} from '@vesora/core';

const shownPNG = await fig.savefig({source: 'displayed', width: 1200, height: 700});
const shownHTML = toHTML(fig, {source: 'displayed'});
const newestHTML = toHTML(fig, {source: 'accepted'});
```

The figure APIs and React `VesoraChart` export handles default to accepted-state export for compatibility. Pass `{source: 'displayed'}` to either React export method to capture inspection. Shared viewer buttons explicitly export the displayed frame. HTML embeds a static scene, retained source data and matching runtime. It does not reconnect the producer or restore evicted history. Protocol-7 files use the shared viewer with live controls suppressed; older scene protocols retain the existing offline viewer.

Python `to_html` / `save_html` and `savefig` / `savefig_async` continue exporting canonical accepted state. Python producers accept data independently of browser drawing. Frozen inspection in a connected Python host is controlled by its viewer; use that viewer's export buttons to capture the displayed frozen frame. Do not assume Python has a matching `freeze_inspection()` facade method.

## Pair a surface with an exact row or column

```js
import {subplots} from '@vesora/core';

const fig = subplots({rows: 1, cols: 2, kinds: [['3d', '2d']], height: 440});
const surface = fig.panel(0, 0).surface(
  [0, 1, 2], [0, 1, 2],
  [[0, 1, 0], [1, 2, 1], [0, 1, 0]],
  {label: 'Amplitude', shading: 'smooth', wireframe: true},
);
const section = fig.panel(0, 1).slice(surface, {axis: 'y', index: 1, label: 'Y row'});
section.setIndex(2);
fig.setCameraPreset('isometric');
```

Slices select exact grid rows or columns, not interpolated clipping planes. The viewer offers `isometric`, `xy`, `xz` and `yz` camera presets. **Equal axes** preserves unit proportions; **Fit data** restores data bounds while keeping camera angles; **Focus selection** frames the last clicked 3D sample and explains when no sample has been selected. Applications can also call `setEqualAspect`, `fitToData` and `focusSelection({x, y, z})` on a figure or 3D panel.

While frozen, camera and slice controls modify the inspection snapshot through `setInspectionView` / `setInspectionSlice`; they do not rewrite the live producer scene. Layer visibility and the theme button are disabled until returning to live. A programmatic viewer theme update changes its chrome immediately and defers its scene theme until live mode resumes.

### Use height and color for different measurements

```js
const measured = fig.panel(0, 0).surface(
  [0, 1], [0, 1], [[1, 2], [3, 4]],
  {values: [[280, 285], [290, 295]], colorDomain: [270, 310],
   colorbarLabel: 'Temperature / K', shading: 'unlit'},
);
measured.setData({color: [[281, 286], [291, 296]]}); // height stays unchanged
```

Creation uses `values`; JavaScript data updates use the `color` channel. Python accepts `surface(..., values=...)` and `layer.set_data(values=...)`. Both channels must have the same grid shape. Omitting `values` retains z-based coloring. An independent color channel defaults to the neutral colorbar label `value`; use `colorbarLabel` to specify its quantity and unit. An explicit empty label hides it. Height-colored surfaces retain the z-axis label, and density retains `count / bin`. `unlit` is the default for reading scalar colors; smooth lighting and wireframe are opt-in presentation choices. Nonfinite z or scalar values omit affected triangles instead of drawing an invented measurement.

`axis: 'x'` fixes a column and produces a y–z profile; `axis: 'y'` fixes a row and produces an x–z profile. Remove all dependent slices before removing the source or changing its topology. Replacing z values with the same shape refreshes the derived profiles in one transaction.

Python multi-series producers use synchronous atomic acceptance:

```python
fig.append_data_batch([
    (temperature, {"x": timestamps, "y": temperatures}),
    (pressure, {"x": timestamps, "y": pressures}),
])
```

Each layer must already have streaming enabled. A malformed final item rejects the whole batch before any source changes; drawing acknowledgement remains a separate transport event.

## Respond to capabilities and failures

Worker startup/progress failures can use cooperative planning. A WebGL2 initialization failure has no alternative rendering backend; the viewer displays the failure. GPU context restoration, stale transport recovery and snapshot-budget errors must remain distinguishable from valid empty data. A legacy Python transport cannot enable frozen inspection; transport v3 negotiates that capability.

The viewer's diagnostics are component counters, not a measurement of total process or driver memory. No generic FPS, point-count or speedup claim follows from these features. See the release checklist for required hardware and soak evidence.

Dense streaming lines can reuse immutable chunk min/max indexes when x is strictly increasing, both axes are linear/time, and every sample is within the viewport. The result preserves the existing first/min/max/last sample identities, including ties after normalization. Clipped views, missing values, unsupported scales and insufficient index budget use the ordinary planner.

`diagnostics().lineIndex` reports the fallback and worker caches separately: index storage (including an estimated 192 bytes per cache entry), retained source backing bytes, builds and hits. Each cache has an 8 MiB accounted limit including those indexes and retained backing buffers; source removal and disposal release it. Retained backing bytes can overlap the live source or snapshot counters, so these figures must not be added together as unique process memory. Worker counters describe the most recently reported worker state.

## Keep Labs separate

General mesh/volume rendering, arbitrary clipping planes, automatic confidence intervals, automatic adaptive 3D level of detail and unrestricted 3D streaming are excluded from this stable release scope. The Labs manual sampling helper does not implement automatic adaptive level of detail. Experimental work must be explicitly labeled, isolated from default imports and retain its own schema/runtime requirements. A Labs label does not permit incorrect sample identity, corrupted exports or leaks into the stable viewer.

Load the experiments explicitly from `@vesora/core/labs`. They are not enabled by `mountViewer` or the ordinary core entry point:

```js
import {createTrajectory, createRollingSurface, createABPins} from '@vesora/core/labs';

const path = createTrajectory(fig.panel(0, 0), {maxPoints: 10_000});
await path.append({x: [1, 0, -1], y: [0, 1, 0], z: [0, 1, 2]}, {waitFor: 'accepted'});
// sequenceAt(index, sourceVersion) maps a displayed trajectory sample to acquisition order.

const rolling = createRollingSurface({x: [0, 1], y: [0, 1], z: [[1, 2], [3, 4]], maxRows: 128});
await rolling.appendRows({y: [3], z: [[5, 6]]}, {waitFor: 'accepted'});
// rolling.figure owns the linked surface/heatmap; the missing y=2 row is not filled.

await fig.ready();
const pins = createABPins(fig);
const a = pins.pin('A', 'displayed');
const aHTML = a.toHTML();
const aPNG = await a.exportPNG();
// Capture B later using pins.pin('B', 'displayed'); replacement must fit before A/B is released.
pins.close();
path.close();
rolling.close();
```

These examples assume `fig` has a mounted, completed 3D panel. Trajectory sequence is acquisition order and does not require increasing spatial x. A/B has exactly two slots and shares the figure's snapshot source budget; insufficient budget preserves the previous pins. Rolling surfaces own their figure, fixed columns and a bounded row window. Experimental streaming captures reopen as ordinary static scenes, with no live connection or session history.
