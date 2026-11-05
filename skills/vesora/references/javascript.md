# JavaScript / TypeScript

```js
import {figure, toHTMLAsync} from '@vesora/core/runtime';
import {mountViewer} from '@vesora/core/viewer';

const fig = figure({title: 'Request latency', height: 420});
const layer = fig.ecdf([12, 14, 14, 28, 90], {label: 'Latency'});
layer.setSemantics({samples: {quantity: 'duration', unit: 'ms'}});
fig.setView({xLabel: 'Latency (ms)', yLabel: 'Fraction at or below'});
const viewer = mountViewer(fig, document.querySelector('#chart'), {mode: 'studio'});
await fig.ready();

// Invoke from the application's explicit export action.
const html = await toHTMLAsync(fig, {source: 'displayed', observation: true});
// Teardown when the app no longer needs this figure:
viewer.dispose();
fig.close();
```

Provide a real DOM container with a usable height. WebGL2 is required; React/Node server rendering is not a rendering host. Root `@vesora/core` supports synchronous `toHTML` at the cost of eager template loading. Import a viewer separately from the lightweight runtime.

For retained live line/scatter data: create the layer, call `enableStreaming({maxPoints})`, and await `appendData({x, y})`. To freeze inspection while continuing acquisition, use the documented accepted/rendered wait policy; frozen displayed data does not advance just because accepted ingestion does. Do not reconnect an offline export to a live producer implicitly.

Spectrogram's `appendRows(time, values, {waitFor: 'accepted'})` also returns a promise. Await it and explicitly choose accepted waits if ingestion should continue while the displayed observation is frozen. Its default rendered wait rejects while frozen; dropping the promise would hide that failure.

`scripts/example_js.mjs` exports `makeFigure()` for all ten families without mounting. Run it with Node to validate scene construction; mount the returned figure or open its HTML to validate drawing.
