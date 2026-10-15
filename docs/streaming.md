# Plot bounded live data

Vesora appends numeric 2D line and scatter data while retaining a fixed number of recent rows. Use it for telemetry, measurements and training curves. Each layer requires an explicit capacity. The renderer may combine several producer updates into one completed frame, while keeping every accepted row within the retained window.

In v0.9, [PRISM inspection](prism.md) adds explicit accepted/rendered waits, an independently frozen displayed frame and Python atomic `append_data_batch`. The default JavaScript/React wait stays `rendered`; use `{waitFor:'accepted'}` when acquisition must continue through frozen inspection. Experimental bounded 3D acquisition is isolated in `@vesora/core/labs`; it does not extend the stable 2D streaming API below.

## JavaScript

```js
import {figure, downloadHTML} from '@vesora/core';

const fig = figure({title: 'Live measurements'});
const signal = fig.plot([], [], {label: 'Signal'}).enableStreaming({maxPoints: 100_000});
fig.mount(document.querySelector('#chart'));
await signal.appendData({x: [0, 1, 2], y: [3, 2, 1]});
console.log(fig.getStreamingState(signal.id));
// {streamId, maxPoints, nextSequence, revision, retained, evicted}
downloadHTML(fig, 'retained-measurements.html');
```

`enableStreaming({maxPoints})` returns the layer. `maxPoints` is a positive safe integer no greater than 4,294,967,295; choose a realistic capacity for the device. Enabling streaming copies and owns the retained initial data. Caller mutations cannot rewrite an earlier frame.

`appendData` returns a promise. Validation happens before the transaction commits; invalid data rejects the promise and leaves all sources unchanged. A mounted chart resolves after a completed frame covers that append, which can also include later appends. An unmounted figure resolves after the data transaction. Await it in a producer loop to apply backpressure. At most 64 append promises may wait on one figure; further attempts reject with `STREAM_BACKPRESSURE` before accepting data. A timeout/abort on `ready()` cancels only that wait, not an accepted append.

A rendering failure can reject a promise after its data was accepted. Check the stream's `nextSequence` before retrying that batch: presentation errors do not roll back accepted rows. Source-budget and input-validation failures occur before commit; geometry-budget failures happen during rendering.

Supply **every existing channel** (`x`, `y`, and `color` if present), with equal lengths. Empty updates are no-ops. Typed arrays must match the channel dtype; ordinary arrays must be exactly representable in it. Ordinary arrays initially create Float64 sources. Numeric missing-value behavior remains the same as static plots. Shared-x line inspection additionally requires finite, strictly increasing x, including the boundary between batches. Time coordinates must be valid epoch milliseconds. Append order defines row order; Vesora does not sort data.

To commit several series together, use one transaction:

```js
const other = fig.plot([], [], {label: 'Other'}).enableStreaming({maxPoints: 100_000});
await fig.appendDataBatch([
  {layer: signal, data: {x: [3, 4], y: [0.9, 0.8]}},
  {layer: other, data: {x: [3, 4], y: [1.2, 1.1]}},
]);
```

One invalid layer rejects the entire batch. A layer cannot occur twice in a transaction. No consumer sees an accepted prefix of a rejected batch.

## Python

```python
import vesora as vs

fig = vs.figure(title="Live measurements")
signal = fig.plot([], [], label="Signal").enable_streaming(max_points=100_000)
fig.show(block=False)
for step in range(100):
    signal.append_data(x=[step], y=[1 / (step + 1)])
    vs.process_events()
fig.save_html("retained-measurements.html")
fig.savefig("retained-measurements.png", width=1000, height=600, scale=2)
fig.close()
```

`append_data` returns the layer after its synchronous Python transaction; it does not wait for browser presentation. Desktop calls and `process_events()` belong on the Qt main thread. Notebook widgets use their normal comm/event loop. Keep long-running notebook producers cooperative so that widget messages can be processed.

Each desktop connection and notebook view has an independent acknowledged transfer revision. An initial or recovery snapshot is followed by binary append messages. There is one in-flight transfer per view, an 8 MiB pending binary-delta budget, and at most 1024 pending update records to bound small-batch metadata. A slow or disconnected viewer is resynchronized from the latest retained snapshot instead of accumulating an unlimited history. Revision mismatch, reset or acknowledgement timeout also triggers resynchronization, including when no later append arrives. Desktop publishers coalesce outbound work into one scheduled drain. This transport is internal and independent of scene protocol versions.

## React

Set `streaming={{maxPoints: 100_000}}` on a numeric line/scatter `VesoraChart`, use `useRef<VesoraChartHandle<Row>>(null)`, and await `ref.current.appendRows(rows)`. Rows append atomically across all series. Keep the initial `data` reference stable between presentation-only rerenders. Replacing that reference resets the data and stream epoch. See the [React streaming API](../packages/react/README.md) and [runnable telemetry demo](../examples/react-saas/README.md).

## Reset, identity and exports

`layer.setData(...)` / `layer.set_data(...)` starts a new stream epoch at the same capacity. Pending JavaScript append waits reject with `STREAM_RESET`; the replacement data remains valid. `disableStreaming()` / `disable_streaming()` keeps the current retained data as a static layer. Disable before choosing a different capacity. Removing or closing the layer/figure releases its streaming state. Theme, style and viewport changes preserve the stream epoch and source revisions.

`streamId` identifies the epoch; `sequence` identifies a row within it, even after older rows are evicted. Event `index` continues to mean a position in the displayed retained buffer. Hover/x-hover events include stream identity for individual samples. Point-selection previews include `sequences` alongside `indices`; density selections identify the stream/revision and bounds rather than inventing a single sample. React maps interactions to the rows belonging to the completed frame.

PNG captures the accepted data and view at the export call. It renders that frozen state even if the producer continues. A view accepts at most eight pending PNG captures, including its active export; further calls reject with `EXPORT_BACKPRESSURE` before copying full source buffers. Await an export before submitting another, and close the figure to cancel pending captures. HTML contains a **static retained snapshot**, matching engine and source buffers; it excludes producer connections and runtime stream metadata. Scene protocols **1–6** remain supported, with no protocol 7 introduced for streaming. Evicted rows are not available in either export. Persist the complete history in the application when required.

## Resource and recovery controls

```js
const monitored = figure({runtime: {
  maxCacheBytes: 32 * 1024 * 1024,
  maxSourceBytes: 64 * 1024 * 1024,
  maxGeometryBytes: 32 * 1024 * 1024,
  workerStartupTimeoutMs: 5000,
  workerStallTimeoutMs: 15000,
}});
await monitored.ready({timeoutMs: 10_000, signal: new AbortController().signal});
console.log(monitored.diagnostics());
monitored.close();
```

`ready()` fences the revision visible to the call, so continuous later appends cannot postpone it forever. Abort and timeout reject the wait. Workers fall back to cooperative main-thread planning when unavailable, stalled or out of sync. WebGL context restoration rebuilds resources on the same figure; no WebGL2 implementation still means no renderer.

Diagnostics report canonical source bytes, cache bytes, estimated geometry/GPU bytes, worker copies/transfer bytes, queued queries, `pendingExports`, completed frame revisions/timings and retained stream counts. `transferredBytes` measures cumulative worker traffic, not retained allocation. These are component-level counters, **not total process or GPU memory**. Source and geometry limits are opt-in; the query cache defaults to 32 MiB. Source bytes exclude frozen exports, frame copies, worker copies and application-held references. A failed geometry budget leaves the last completed frame available and reports an error.

Only numeric 2D line/scatter streaming is supported. Bands, histograms, bars, boxplots, categorical/3D layers and dynamic linked-selection membership remain outside this release. Static versions of those features remain available. Streaming layers must be disabled before joining a selection link.

## Run the examples and measurements

- `npm run demo`, then open `/examples/web/streaming.html`: three synthetic curves, pause, reset, PNG and HTML.
- `npm run demo:react`, then open `/?demo=streaming`: the same three-curve scenario in React.
- `python examples/python_streaming.py`: the same producer in a Qt window.
- `npm run benchmark:streaming`: three 100,000-row windows, batches of 100 at a requested 20 Hz for 60 seconds.
- `node scripts/benchmark-v08.mjs soak`: the same case for 30 minutes. `VESORA_SOAK_SECONDS` overrides duration; `VESORA_SOFTWARE_GPU=0` requests the normal GPU path.

The web and React demos pause their producer when you start a drag, zoom, tap/click inspection or keyboard sample inspection. This keeps the retained window available while you explore it. **Resume** restores automatic axes and follows incoming data again. Applications own this producer pause/resume behavior. The web demo also preserves its figure and pause state when browser history restores a cached document, and displays startup failures above the chart.

The data is synthetic and illustrative. Inspect [the recorded measurements](benchmarks/v0.8.0.md) for the actual machine, duration, throughput and latency; examples are not performance guarantees.
