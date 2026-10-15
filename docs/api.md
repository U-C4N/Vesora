# API and usage

Python uses `snake_case`; JavaScript uses `camelCase`. Both APIs send the same scene and data model to the shared TypeScript engine. Each panel contains either 2D or 3D layers. In v0.9, `subplots({rows, cols, kinds})` creates mixed figures with fixed cell types; shared axes are rejected for mixed layouts. The [PRISM guide](prism.md) covers surface scalar colors, exact slices, true `plot3d`, scientific camera controls, frozen inspection, atomic Python batches and the shared viewer. Existing protocols 1–6, interval bands and numeric 2D streaming remain available.

## Append live data

| Operation | Python | JavaScript |
| --- | --- | --- |
| Enable bounded history | `layer.enable_streaming(max_points=100_000)` | `layer.enableStreaming({maxPoints: 100_000})` |
| Append complete channels | `layer.append_data(x=x, y=y)` | `await layer.appendData({x, y})` |
| Stop appending, keep retained data | `layer.disable_streaming()` | `layer.disableStreaming()` |
| Replace data and reset epoch | `layer.set_data(x=x, y=y)` | `layer.setData({x, y})` |

Capacity is mandatory. Numeric 2D lines/scatters are supported; bands, categories, statistical/3D layers and linked-selection members cannot stream. JavaScript also exposes atomic multi-series `fig.appendDataBatch([{layer, data}, ...])`, `fig.getStreamingState(layer.id)`, `fig.diagnostics()` and `fig.ready({signal, timeoutMs})`. React exposes `streaming={{maxPoints}}` and `appendRows(rows)` on its typed ref. Python append is synchronous data acceptance; JavaScript/React append promises wait for a covering rendered frame when mounted. Read [the complete streaming contracts](streaming.md) before integrating a producer.

## Themes, dates and number formats

Themes apply to WebGL backgrounds, Canvas axes/labels/tooltips, viewer controls and exports. Choose `light`, `dark`, or partial tokens: `background`, `foreground`, `muted`, `grid`, `axis`, `tooltipBackground`, `tooltipForeground`, `selection`, `error`, `fontFamily`, `fontSize` and `palette`. Explicit layer colors override the theme palette. The default remains light.

Optional `titleFontSize`, `labelFontSize`, `tickFontSize` and `legendFontSize` override individual text roles, in logical CSS pixels. Each font-size token accepts finite numbers from 8 through 32. Omitted role tokens retain the existing `fontSize`-based appearance and are not added to legacy snapshots. Tick density and plot margins adapt to measured text; increasing text sizes may reduce the number of labels drawn. Python uses the same camelCase token names inside its theme dictionary.

```typescript
import { figure } from '@vesora/core';

const fig = figure({ theme: 'dark', title: 'Revenue' });
fig.plot([Date.UTC(2026, 9, 1), Date.UTC(2026, 9, 2)], [4200, 5100], { label: 'Revenue' });
fig.setView({ xScale: 'time' });
fig.setAxisFormat('x', { kind: 'date', locale: 'en-US', timeZone: 'UTC' });
fig.setAxisFormat('y', { kind: 'currency', currency: 'USD', locale: 'en-US' });
fig.mount(document.getElementById('chart')!);
```

```python
import vesora as vs

fig = vs.figure(theme="dark", title="Revenue")
fig.plot([1790812800000, 1790899200000], [4200, 5100], label="Revenue")
fig.set_axes(xscale="time")
fig.set_axis_format("x", {"kind": "date", "locale": "en-US", "timeZone": "UTC"})
fig.set_axis_format("y", {"kind": "currency", "currency": "USD", "locale": "en-US"})
fig.save_html("revenue.html")
```

Time coordinates are numeric UTC epoch milliseconds; locale and timezone affect labels, not observation identity or geometry. Calendar ticks use UTC boundaries and adapt to the visible interval. Use `kind: 'number' | 'percent' | 'currency' | 'date'`; percentage values are fractions, and currency requires a three-letter code. Optional `options` contains supported JSON-safe Intl settings. Date formatting defaults to `en-US` and `UTC`; explicit Intl date options override automatic tick formatting. Time axes are for numeric 2D data; existing statistical and categorical restrictions remain enforced.

Use `setTheme(...)` / `set_theme(...)` to change a theme. Panel handles also provide axis formatting. Base theme/time/format features promote snapshots to protocol 5; role font sizes require protocol 6. The current reader accepts protocols 1–7. Invalid options fail before changing the current valid scene. Declarative formats survive offline HTML, while application callbacks remain in the host.

JavaScript `fig.on(...)` callbacks use `FigureEventMap`. Hover includes original source indices when a point is identifiable, plus local/client pointer positions; `null` clears a previous hover. Click carries the same hit information. Density hover identifies a bin rather than an individual record. Consumer callback exceptions are reported to the console and isolated from rendering and readiness. The returned unsubscribe function removes the subscription.

## Create a figure

| Operation | Python | JavaScript |
| --- | --- | --- |
| Figure | `vs.figure(title="Experiment")` | `figure({title: 'Experiment'})` |
| 2D grid | `vs.subplots(2, 1, sharex=True)` | `subplots({rows: 2, cols: 1, shareX: true})` |
| Panel | `fig.panel(0, 0)` | `fig.panel(0, 0)` |
| Line | `fig.plot(x, y)` | `fig.plot(x, y)` |
| Interval band | `fig.fill_between(x, lower, upper)` | `fig.fillBetween(x, lower, upper)` |
| Scatter | `fig.scatter(x, y)` | `fig.scatter(x, y)` |
| Heatmap | `fig.heatmap(x, y, z)` | `fig.heatmap(x, y, z)` |
| Surface | `fig.surface(x, y, z)` | `fig.surface(x, y, z)` |
| 3D scatter | `fig.scatter3d(x, y, z)` | `fig.scatter3d(x, y, z)` |
| Histogram | `fig.hist(samples, bins=20)` | `fig.hist(samples, {bins: 20})` |
| Vertical/horizontal bars | `fig.bar(labels, values)` / `fig.barh(labels, values)` | `fig.bar(labels, values)` / `fig.barh(labels, values)` |
| Boxplot | `fig.boxplot(groups, labels=names)` | `fig.boxplot(groups, {labels: names})` |
| Display | `fig.show()` | `fig.mount(element)` |
| PNG export | `fig.savefig("figure.png")` | `await fig.savefig()` → `Blob` |
| Shared-x inspection | `fig.set_hover_mode("x")` | `fig.setHoverMode('x')` |
| Interactive HTML | `fig.save_html("figure.html")` | `downloadHTML(fig, "figure.html")` |
| HTML string | `fig.to_html()` | `toHTML(fig)` |
| Close | `fig.close()` | `fig.close()` |

Plotting methods called on a figure return a layer. Python convenience functions such as `vs.plot` add layers to the current figure. JavaScript's top-level `plot` and `scatter` functions create and return a new figure. Use an explicit `figure()` when combining multiple layers.

Point coordinates are one-dimensional arrays of equal length. Grid x/y coordinates must be finite, strictly increasing, one-dimensional arrays. Grid z values follow `z[yIndex][xIndex]` order: Python accepts nested lists, and JavaScript accepts nested row arrays or a flat typed array in row-major order. The Python API does not require NumPy.

```python
import math
import vesora as vs

x = [-3 + i * 6 / 80 for i in range(81)]
z = [[math.sin(a*a + b*b) / (1 + a*a + b*b)
      for a in x] for b in x]
fig = vs.figure(title="Damped radial wave")
fig.surface(x, x, z, colormap="viridis")
fig.show()
```

## Show an interval around a curve

Use `fill_between(x, lower, upper, **style)` / `fillBetween(x, lower, upper, style)` on a `Figure` or `Panel`. Python also provides `vs.fill_between`. Supply the bounds you want to show; the engine does not calculate a confidence interval or infer statistical meaning.

```python
import vesora as vs

x, y = [0, 1, 2, 3], [3.2, 1.8, 1.0, 0.7]
fig = vs.figure(title="Synthetic interval")
band = fig.fill_between(x, [2.8, 1.5, .8, .5], [3.6, 2.1, 1.2, .9], color="#3569c8")
fig.plot(x, y, color="#3569c8", label="Model A")
fig.set_axes(yscale="log")
band.set_data(lower=[2.7, 1.4, .7, .4])
fig.save_html("interval.html")
```

All three channels must be numeric one-dimensional arrays of equal length. `x` must be finite and strictly increasing; empty and one-sample arrays are accepted. Wherever both bounds are finite, `lower <= upper` is required. A nonfinite bound creates a gap. Nonpositive values on logarithmic axes also create gaps. Bands support a 2D x axis of `linear`, `log` or `time`, and a y axis of `linear` or `log`; categorical axes, time y axes and y date formats are unsupported.

Band styles are deliberately limited to `color`, `opacity` and `label`; opacity defaults to `0.18`. Labels appear in the core legend. Band data and style updates are atomic. Update named channels with `band.set_data(lower=new_lower)` / `band.setData({lower: newLower})`, or replace all three channels positionally in Python. Displayed bands preserve both bounds and missing-data breaks while clipping to the viewport; they do not provide point hover or rectangle selection. Put a line over a band for sample inspection.

## Compare series at the same cursor x

Enable `fig.set_hover_mode("x")` / `fig.setHoverMode('x')`; use `"nearest"` to restore the existing point-hover mode. Shared-x inspection applies to visible 2D numeric/time line layers in the active panel. Every participating line needs finite, strictly increasing x coordinates. Invalid mode changes, data updates or attempts to show an ineligible line fail without changing the previous scene.

The guide follows the cursor x. Each visible line reports its nearest **original source sample within the same valid run**, with that sample's actual x and y. This is not interpolation, does not extrapolate beyond a run, and does not bridge missing or logarithmically invalid data. Hidden series are excluded; a line without a valid sample at that cursor position has no core event item. The tooltip can therefore show different sample x values for irregularly sampled series.

JavaScript subscribes with `fig.on('xhover', event => { /* use event or null */ })`. `XHoverEvent` contains `cursorX`, `pointerPosition`, optional `panelId` and `items`; each item has `layerId`, `index`, `x` and `y`. Moving away or clearing inspection emits `null`. Touch can pin inspection, and the focused chart supports Left/Right and Home/End keys. Hover remains local to the viewer: Python configures and serializes the mode, but the Python hosts do not forward per-pointer `hover` or `xhover` callbacks. Transient guides/tooltips are omitted from PNG and HTML state.

## Compare data in panels

`subplots` returns a `Figure`, not a tuple. Both `rows` and `cols` are required positive integers. Select a panel with zero-based `fig.panel(row, col)`. Each panel supports `plot`, `scatter`, `heatmap`, axis settings, a title, and annotations. Plotting returns the same mutable `Layer` handles used by a single-panel figure. Display, lifecycle, bookmarks, and export belong to the figure.

```python
import math
import vesora as vs

x = [i / 100 for i in range(1000)]
fig = vs.subplots(2, 1, sharex=True, title="Signal comparison", height=800)
top, bottom = fig.panel(0, 0), fig.panel(1, 0)
top.plot(x, [math.sin(t) for t in x], label="Signal")
bottom.plot(x, [0.1 * math.sin(15 * t) for t in x], label="Residual")
top.set_title("Signal")
bottom.set_title("Residual")
bottom.set_axes(xlabel="Time (s)", ylabel="Amplitude")
bottom.axhline(0, color="#64748b")
fig.bookmark("Overview")
bottom.set_axes(xlim=(2, 4))
fig.bookmark("Shared interval")
fig.restore_bookmark("Overview")
fig.save_html("comparison.html")
```

```javascript
import { subplots, downloadHTML } from '@vesora/core';

const x = Float64Array.from({length: 1000}, (_, i) => i / 100);
const fig = subplots({rows: 2, cols: 1, shareX: true, title: 'Signal comparison', height: 800});
const top = fig.panel(0, 0), bottom = fig.panel(1, 0);
top.plot(x, x.map(Math.sin), {label: 'Signal'});
bottom.plot(x, x.map(t => 0.1 * Math.sin(15 * t)), {label: 'Residual'});
top.setTitle('Signal');
bottom.setTitle('Residual').setView({xLabel: 'Time (s)', yLabel: 'Amplitude'});
bottom.axhline(0, {color: '#64748b'});
fig.bookmark('Overview');
bottom.setView({xDomain: [2, 4]});
fig.bookmark('Shared interval');
fig.restoreBookmark('Overview');
downloadHTML(fig, 'comparison.html');
```

| Setting | Default | Behavior |
| --- | --- | --- |
| `sharex` / `shareX` | `False` / `false` | `true` shares x scale and limits across every panel. |
| `sharey` / `shareY` | `False` / `false` | `true` shares y scale and limits across every panel. |
| `width`, `height` | `800`, `520` | Figure dimensions in CSS pixels; choose a taller figure for several rows. |
| Figure `title` | Empty | Title for the whole layout. |
| Panel `set_title` / `setTitle` | Empty | Title for one grid cell. |

Shared axes use the union of valid data extents from visible layers in the linked panels. Automatic padding is applied to the union. Explicit limits, scale changes, wheel zoom, and drag pan propagate to the shared axis; labels remain independent. Use `panel.set_axes(xlim=None)` or `panel.setView({xDomain: undefined})` to return the shared x axis to automatic limits. Invalid domains, including nonpositive log limits, reject the whole update.

Existing `fig.plot`, `fig.scatter`, `fig.heatmap`, `fig.set_axes` and `fig.setView` address the top-left panel. They still participate in configured sharing. `fig.set_title` / `fig.setTitle` changes the whole-figure title. `fig.panel(0, 0)` also works for an ordinary single-panel figure.

Grid shape and each cell's 2D/3D kind are fixed at creation. Mixed panels use protocol 7 and reject `shareX`/`shareY`; see [scientific panels and slices](prism.md#pair-a-surface-with-an-exact-row-or-column). Panel spans, nested layouts and dynamic insertion remain unavailable. One explicit selection link can highlight two numeric scatter layers and compare a count histogram in three distinct 2D panels; see [linked observations](#follow-observations-across-views).

Grid cells have a minimum size of 360 × 260 CSS pixels, plus space for a figure title. A smaller mount area scrolls without rearranging the grid. PNG export includes the complete drawing area, including portions outside the visible scroll area.

## Annotate a result

Figures and 2D panels offer `text(x, y, text)`, `axhline(y)`, and `axvline(x)`. Positions are data coordinates. Reference lines span the panel viewport, text is plain text, and annotations are clipped to the panel. They do not expand automatic axis limits. Finite coordinates that are invalid on a log axis are omitted while that scale is active.

```python
import vesora as vs

fig = vs.figure(title="Threshold")
fig.plot([0, 1, 2, 3], [1, 2, 4, 3])
threshold = fig.axhline(3, color="#b45309", width=2)
note = fig.text(1, 3.5, "Threshold", font_size=14)
threshold.update(y=3.2, opacity=0.7)
note.update(x=1.2, text="Updated threshold")
note.remove()
fig.save_html("threshold.html")
```

In JavaScript, use `fig.axhline(3, {color: '#b45309', width: 2})`, `fig.text(1, 3.5, 'Threshold', {fontSize: 14})`, and `annotation.update({y: 3.2, opacity: 0.7})`. `remove()` is the same in both languages. Options are flattened on `update`; do not pass a nested `style` object. Unspecified values are retained. Invalid updates leave the annotation unchanged; operations on a removed handle raise an error.

| Option | Python | JavaScript | Constraint |
| --- | --- | --- | --- |
| Color | `color` | `color` | A supported color string. |
| Reference-line width | `width` | `width` | Positive finite CSS-pixel width. |
| Opacity | `opacity` | `opacity` | Number from 0 to 1. |
| Text font size | `font_size` | `fontSize` | Positive finite CSS-pixel size. |
| Position / content | `x`, `y`, `text` | `x`, `y`, `text` | Use the coordinates required by the annotation kind; text content must be a string. |

`text` requires x and y; a horizontal line accepts y; a vertical line accepts x. Coordinates must be finite numbers. Error bars, arrows, mathematical text rendering and 3D annotations are not part of this API. Use an [interval-band layer](#show-an-interval-around-a-curve) to shade explicit lower/upper bounds.

Defaults are color `#475569`, line width `1`, opacity `1`, and font size `12`. Text uses the system sans-serif font, left alignment, and literal newline characters for multiple lines. Text is never interpreted as HTML or mathematical markup.

## Use NumPy optionally

Supported Python inputs include lists, tuples, `array.array`, and supported numeric buffers. When installed, NumPy `ndarray` inputs are accepted through the buffer protocol. This uses the same data adapter and visualization engine.

For an optional source installation, run `python -m pip install -e ".[numpy]"`. For a locally built wheel, run `python -m pip install "./dist/release-v0.9.0-rc.5/vesora-0.9.0rc5-py3-none-any.whl[numpy]"`. Float32/Float64 and supported integer buffers map to the shared data descriptors. NumPy grids must satisfy `z.shape == (len(y), len(x))`.

This example supplies Float32 buffers using the Python standard library:

```python
from array import array
import vesora as vs

fig = vs.figure(title="Float32 measurements")
fig.scatter(array("f", [1, 2, 3]), array("f", [3, 1, 2]))
fig.show()
```

## Update styles and data

Style options are `color`, `size`, `width`, `opacity`, `label`, `colormap`, `representation`, `colorDomain` (`color_domain` in Python) and `colorbarLabel` (`colorbar_label` in Python). Colormaps are `viridis` or `magma`. Scatter representation modes are `auto`, `points`, and `density`. Bands accept only the three styles documented above.

Use `fig.heatmap([[1, 2], [3, 4]], colorbar_label="Temperature (°C)")` or JavaScript `{colorbarLabel: 'Temperature (°C)'}` to name a scalar scale. Density retains its count-per-bin meaning even with a custom label: changing the label does not change the aggregation. Colors and numeric color domains keep their existing semantics.

```javascript
// After importing figure from @vesora/core and creating a #chart element:
const fig = figure({ title: 'Updated measurements' });
const layer = fig.scatter([1, 2, 3], [3, 1, 2], {
  color: '#218061', size: 6, label: 'Measurements',
});
fig.mount(document.querySelector('#chart'));
await fig.ready();
layer.setData({ y: new Float64Array([2, 3, 1]) });
layer.setStyle({ color: '#476dc2' });
await fig.ready();
console.log(fig.inspect());
```

JavaScript `setData({y: newValues})` and Python `set_data(y=new_values)` update only the supplied channels. Python also accepts `layer.set_data(x, y)` or `layer.set_data(x, y, z)` for 3D/grid data. When coordinate lengths change, all other channels and existing scalar colors must still match. Use these setters when changing data. `setVisible(false)` / `set_visible(False)` hides a layer; `remove()` releases the layer and its data references.

JavaScript `fig.setView({xScale: 'log', xDomain: [1, 1000], yLabel: 'Amplitude'})` and Python `fig.set_axes(xscale="log", xlim=(1, 1000), ylabel="Amplitude")` update the view. Logarithmic domain limits must be positive. All domains must be finite and strictly increasing. Nonpositive data on log axes is omitted and creates gaps in lines. NaN/infinite coordinates are omitted from scatter and break line segments.

## Interact with and inspect the view

In 2D, drag to pan, use the wheel to zoom, and Shift + drag to select a rectangle. In a grid, the pointer chooses the panel; shared axes propagate pan and zoom. Double-click resets that panel's axes to automatic limits and resets its shared axes across the group. In 3D, drag to orbit the camera and use the wheel to zoom. Hover and selection results refer to original source indices or aggregation cells.

```javascript
// Using the figure created above:
const unsubscribe = fig.on('selection', selection => console.log(selection));
fig.on('representation', info => console.log(info));
fig.on('error', error => console.error(error));
console.log(fig.inspect());
unsubscribe();
```

JavaScript's `fig.inspect()` returns `kind`, `total`, `visible`, `rendered`, `exact`, `method`, and `layerId` for each layer, with `panelId` for grid results. For density, `exact: true` means the counts are exact; it does not mean every point is drawn separately. After a view update, use `await fig.ready()` before reading the completed result. Python does not expose `fig.inspect()`; subscribe to the `representation` event or use the exported viewer's inspector.

JavaScript event names include `hover`, `xhover`, `click`, `selection`, `viewchange`, `representation`, and `error`. Python hosts forward low-frequency selection/view/representation/error events; the per-pointer `hover` and `xhover` events remain JavaScript-only. An unlinked point selection includes source `indices`, `count`, and `truncated`; at most 10,000 indices are returned. An unlinked density selection includes `bounds` and `count`. Grid hover/selection events identify the source panel. Without an explicit selection link, selection does not highlight or filter another panel. Heatmap colors represent z values; surface colors represent the independent `values` channel when supplied, otherwise z. A density colorbar represents the number of points per cell.

## Follow observations across views

Link exactly two numeric scatter layers and one count histogram in three distinct 2D panels of the same figure. Every coordinate and histogram channel must have the same row count and order. **Row ordinal is observation identity**; Vesora cannot infer alignment or perform joins. One figure supports one selection link.

```python
import vesora as vs

fig = vs.subplots(1, 3, width=1200, title="Inspect observations")
x, y, feature = [0, 1, 2, 3], [0.1, 0.2, 3, 0.1], [0.1, 0.2, 0.9, 0.3]
a = fig.panel(0, 0).scatter(x, y)
b = fig.panel(0, 1).scatter(feature, y)
h = fig.panel(0, 2).hist(y, bins=[0, 1, 2, 4])
link = fig.link_selection(scatter=[a, b], histogram=h)
fig.show()
# link.clear() clears the cohort; link.remove() permits data/options updates.
fig.save_html("observations.html")
```

```javascript
import { subplots } from '@vesora/core';

const fig = subplots({rows: 1, cols: 3, width: 1200, title: 'Inspect observations'});
const x = [0, 1, 2, 3], y = [.1, .2, 3, .1], feature = [.1, .2, .9, .3];
const a = fig.panel(0, 0).scatter(x, y);
const b = fig.panel(0, 1).scatter(feature, y);
const h = fig.panel(0, 2).hist(y, {bins: [0, 1, 2, 4]});
const link = fig.linkSelection({scatter: [a, b], histogram: h});
fig.mount(document.querySelector('#chart'));
// link.clear() clears the cohort; link.remove() permits data/options updates.
```

Shift + drag in either linked scatter creates an inclusive data-coordinate rectangle; a new rectangle replaces the cohort. Original finite x/y coordinates determine membership, independently of point/density display. The same row mask highlights both scatters and contributes to the selected histogram. A dense selected cohort may use count aggregation. Histogram selection does not create a cohort; linked lines, lasso, joins and selection set operations are outside v0.5.

The full histogram retains its original bins and counts. The selected overlay uses the same edges and **raw counts**. `density=True` or `cumulative=True` is rejected when linking. Zoom, pan, Reset view and view bookmarks preserve the cohort. Clear selection removes the active predicate; it does not select every row. An active rectangle matching zero rows is displayed as a zero cohort rather than a cleared selection.

The summary reports selected rows / total aligned rows and percentage. Target scatter invalid coordinates omit marks without changing membership. Selected histogram non-finite values and samples outside the configured range are excluded from its bins and reported separately. Thus histogram-included samples can be fewer than selected rows. Membership is complete even when the `selection` event's index preview is truncated at 10,000 entries. A linked event has `kind: "linked"`, `linkId`, `generation`, `sequence`, `layerId`, `active`, `count`, `total`, `fraction`, `indices`, `truncated` and, for an active predicate, `bounds`. Events are emitted after the complete current cohort has rendered.

JavaScript link creation and linked-scene import isolate member numeric buffers from caller-owned TypedArrays without changing descriptor versions or values; caller mutations do not alter the linked records. This isolation adds buffer copies. Linked layer source arrays and histogram options are immutable until `link.remove()`; attempted changes fail atomically. Styles and views may change. Removing a member layer removes its link. Re-link explicitly after replacing or reordering data. Protocol `4` scenes store the link and completed rectangle, not a viewport-specific list of drawn points. Existing protocol 1/2/3 scenes remain readable. An exported file recomputes the exact cohort from the embedded original sources and opens with the completed export-time selection. PNG includes the highlight, count comparison and cohort summary; view bookmarks continue to store views only.

See [the 200,000-row example](../examples/web/linked.html), [v0.5 limits](releases/v0.5.0.md) and [the pilot protocol](pilot-v0.5.md).

## Share an interactive figure

HTML export embeds the engine, worker, current scene, and original numeric data in one UTF-8 file. Open it directly in a WebGL2-capable browser with no server or internet connection. Creating HTML does not require `show()`, `mount()`, Qt initialization, or a graphics context. The Python installation still includes its normal desktop dependencies.

```python
import vesora as vs

fig = vs.figure(title="Measurements")
fig.scatter([1, 2, 3], [2, 4, 3], label="Samples")
fig.bookmark("Overview")
fig.set_axes(xlim=(1.5, 2.5), ylim=(3.5, 4.5))
fig.bookmark("Detail", note="Inspect the highest measurement.")
fig.restore_bookmark("Overview")
html = fig.to_html()
path = fig.save_html("measurements.html")
```

```javascript
import { figure, toHTML, downloadHTML } from '@vesora/core';

const fig = figure({ title: 'Measurements' });
fig.scatter([1, 2, 3], [2, 4, 3], { label: 'Samples' });
fig.bookmark('Overview');
fig.setView({ xDomain: [1.5, 2.5], yDomain: [3.5, 4.5] });
fig.bookmark('Detail', { note: 'Inspect the highest measurement.' });
fig.restoreBookmark('Overview');
const html = toHTML(fig);
downloadHTML(fig, 'measurements.html');
```

`save_html(path)` returns a `Path`; use an `.html` or `.htm` extension. `to_html()` and `toHTML(fig)` return a string. `downloadHTML` starts a browser download; its default filename is `figure.html`.

### Save and restore viewpoints

Bookmarks capture axis scales, labels and limits for **every panel**, or camera rotation/distance and pan for a single 3D view. They do not capture data copies, historical layer visibility/styles, panel titles, annotations, or selections. Every bookmark uses the latest dataset, annotations and layer visibility.

Names are trimmed and must be nonempty. Reusing a name replaces its view and note without changing the order. Notes are plain text and may be omitted. `restore_bookmark(name)` / `restoreBookmark(name)` replaces the full view, including returning to automatic axis limits. `remove_bookmark(name)` / `removeBookmark(name)` deletes it. Unknown names raise an error. Closed figures cannot be exported or bookmarked.

JavaScript can also restore a saved complete `ViewSpec` with `fig.restoreView(view)`. This replaces the view and clears transient interaction state; `setView` continues to update only supplied settings. `pan3d` is a pair of finite normalized screen offsets, defaulting to `[0, 0]`. In the viewer, Shift + drag pans a 3D scene; Python retains that interaction state for bookmarks and export.

For a grid, `restoreView` targets the main panel and propagates shared axes. JavaScript `const state = fig.captureViews()` and `fig.restoreViews(state)` capture and restore the full layout's views. A whole-layout state must contain every secondary panel, with consistent shared scales and domains; malformed states are rejected atomically. Normal `setView` calls do not emit `viewchange`; interaction and restore operations do.

The exported file opens at the export-time view, not the first bookmark. Its **Reset view** button and double-click restore the opening state of the complete layout. Clicking a bookmark restores all saved panel views; exploring manually clears the active bookmark indicator. Bookmarks are authored through the API, not edited in the exported viewer.

### Understand what is shared

The viewer's **Inspector** reports each visible layer separately, with units such as points, retained line samples, occupied density bins, cells, or triangles. Density's **All visible samples counted** means exact bin counts, not that every source point is drawn. Counts refresh after rendering each new view.

Full exported source arrays are embedded even when the screen shows a reduced representation. Large datasets produce larger files. Python callbacks, application code, gallery sliders, and live data connections are not serialized; computed data can be explored but Python calculations cannot be rerun from the file.

## Display Python figures on desktop or in a notebook

In a normal script, `fig.show()` opens a QtWebEngine window and waits until it closes. In an IPython notebook kernel, it selects the widget host. Choose a host explicitly with `host="desktop"` or `host="notebook"`. GUI calls must run on the main thread. `show(block=False)` requires an existing Qt event loop or regular calls to `vs.process_events()`.

For notebook support, install `python -m pip install -e ".[notebook]"` from source, then call `fig.show()`. The notebook adapter uses the same engine and binary data. Interactions require a running kernel and widget communication. Export a displayed widget with `await fig.savefig_async("plot.png")` without opening a Qt window; synchronous `savefig` uses the Qt host.

## Export PNG and release resources

Mount a JavaScript figure before exporting. `await fig.savefig()` waits for every panel, composites the WebGL and annotation canvases, and returns a PNG Blob of the whole layout. With no options, the mounted CSS dimensions and existing effective device pixel ratio (capped at 2) are retained. Python's `fig.savefig(path)` can export an undisplayed figure using Qt. A current render failure rejects export instead of returning an older image.

```python
# Uses the existing fig; 1000 × 600 logical pixels become a 2000 × 1200 PNG.
fig.savefig("figure.png", width=1000, height=600, scale=2)
# In a displayed notebook: await fig.savefig_async("figure.png", width=1000, height=600, scale=2)
```

```typescript
const png = await fig.savefig({width: 1000, height: 600, scale: 2});
```

`width` and `height` must be supplied together as safe integers of at least 200 × 180 logical pixels. `scale` is an independent positive finite raster multiplier. Omit the dimensions to use the mounted size; omit scale to use the effective viewer DPR. Explicitly set all three for predictable output dimensions. The renderer lays out and renders at the requested logical size, rather than resizing a screenshot. Pixel dimensions are rounded to integers and must be positive, fit the active GPU limits, and contain no more than 32,000,000 pixels. Invalid requests reject without altering the live figure. Exports retain data, view and serialized styling while excluding transient hover guides and tooltips.

React exposes the same `ExportPNGOptions` through `await chartRef.current.exportPNG({width, height, scale})`. Python sync/async calls retain their `timeout` option. Changing export dimensions or scale does not promote the scene protocol; bands, hover mode, new typography tokens and colorbar labels use protocol 6.

Requests on the same figure are serialized. Each captures a completed scene and owned source buffers before entering the export queue, so later data changes or resizes cannot mix into the image. Rendering uses a separate multisampled framebuffer in the existing WebGL context; the live viewport, camera and selection remain unchanged. Temporary resources are released on success and failure. Closing or unmounting the source before capture completes can reject the pending request with a disposal/context error.

`close()` releases GPU resources, workers, and event listeners. A closed figure cannot be reused. In Python, closing only the desktop window preserves the figure's data for later display or export. An explicit `fig.close()` releases that data too.


## Analyze distributions and categories

All statistical plotting methods are available on `Figure` and `Panel` and return a single `Layer`. Python convenience functions use the current figure, like `vs.plot`; JavaScript convenience functions return a new `Figure`, like `plot`. They do not return Matplotlib's counts/edges/artists tuple. Statistics are computed by the common TypeScript engine from original source arrays, not independently in Python.

The numerical conventions follow [Matplotlib's histogram normalization](https://matplotlib.org/stable/api/_as_gen/matplotlib.pyplot.hist.html), [NumPy's linear quantiles](https://numpy.org/doc/stable/reference/generated/numpy.quantile.html) and [Matplotlib's IQR whiskers](https://matplotlib.org/stable/api/_as_gen/matplotlib.pyplot.boxplot.html), without claiming full API compatibility.

```python
import vesora as vs

fig = vs.subplots(2, 2, width=1100, height=800)
hist = fig.panel(0, 0).hist([0, 1, 1, 2, 3], bins=[0, 1, 2, 4], density=True)
bars = fig.panel(0, 1)
bars.bar(["A", "B"], [3, 5], label="Before", color="#3569c8")
bars.bar(["A", "B"], [4, 6], label="After", color="#d36a55")
fig.panel(1, 0).boxplot([[1, 2, 3, 4, 20], [2, 3, 3, 4], []],
                        labels=["Trial", "Control", "Missing"])
fig.panel(1, 1).plot(["Small", "Medium", "Large"], [4, 7, 6])
hist.set_options(density=True, cumulative=True)
fig.bookmark("Overview")
fig.save_html("statistics.html")
```

### Histograms

`hist(samples, bins=10, range=None, density=False, cumulative=False, **style)` uses 10 equal-width bins by default. JavaScript supplies these options in an options object: `fig.hist(samples, {bins: 10, density: true})`.

- `bins` is a positive integer (maximum 1,000,000) or a finite, strictly increasing edge list (maximum 1,000,001 edges). Explicit edges and `range` cannot be combined. Automatic bin strategies and weights are not supported.
- Without `range`, finite source min/max determine edges. Empty/all-invalid samples use `[0,1]`; constant samples use the engine's extent expansion. Unrepresentable equal-width edges fail explicitly.
- Bins include the left edge and exclude the right edge, except the final bin includes both. Zooming does not change bins or statistics.
- `density=True` draws `count / (included_count * bin_width)`. `cumulative=True` accumulates counts from left to right; with density, the last nonempty CDF value is one. Empty included data yields zeros.
- NaN/infinity and finite samples outside the bin range are excluded from counts but remain in the raw exported sources. The inspector distinguishes omissions and range exclusions.

Use `layer.set_data(samples=new_samples)` / `layer.setData({samples: newSamples})`. Use `set_options(bins=..., range=None, ...)` / `setOptions({bins: ..., range: null, ...})` for calculation options. Automatic range updates with data; explicit edges stay fixed.

### Group or stack bars

`bar(x, values, bottom=0, bar_width=0.8, **style)` and `barh(y, values, left=0, bar_width=0.8, **style)` accept numeric positions or string categories. JavaScript uses `{bottom, barWidth}` or `{left, barWidth}`. Baselines can be finite scalars or equal-length arrays. Values must be numeric; non-finite values omit their bar without removing the category.

Call `panel.set_bar_mode("group" | "stack" | "overlay")` or `panel.setBarMode(...)`. Figure methods address the main panel. The default is `group`; this setting affects only bar layers, not histograms or boxes.

| Mode | Placement |
| --- | --- |
| `group` | Total `bar_width` is split by series in layer order. Missing categories and hidden layers retain their slots; removing a layer frees its slot. |
| `stack` | Positive and negative values accumulate independently from zero. Hidden layers do not contribute. User baselines must be zero. |
| `overlay` | Original positions/baselines, drawn in layer order. Different widths are allowed. |

Group/stack require matching widths. Vertical and horizontal bars cannot be mixed within a panel. Duplicate positions within one series are rejected instead of silently aggregated; numeric positions match exactly. Layout is panel-local even when axes are shared.

Update bar data with x/y channels and `bottom`/`left` (or canonical `base`), e.g. `layer.setData({x: ['A', 'B'], y: [4, 8], bottom: 0})`. If the row count changes, provide a matching baseline; omitted existing baseline arrays are not resized. `bar_width`/`barWidth` is a layout option, separate from stroke `width`. Orientation cannot be changed on an existing layer.

### Boxplots

`boxplot(groups, labels=None, whis=1.5, showfliers=True, orientation="vertical", box_width=0.6, **style)` accepts one numeric vector or a sequence of vectors of different lengths. An empty vector is one empty group. Group labels default to `"1"`, `"2"`, ... and must be unique. JavaScript uses `{labels, whis, showfliers, orientation, boxWidth}`.

Finite samples are sorted in a copy. Quartiles use linear interpolation at `(n-1)*p`; whiskers use the `Q1-whis*IQR` / `Q3+whis*IQR` fences. A fence with no observations falls back to its quartile boundary, as with a very small `whis` on a two-value sample. Empty groups keep their category but draw no box; singleton groups collapse to one value. Zero IQR does not automatically expand whiskers to min/max.

Outliers retain original group/sample indices for hover. `showfliers=False` only hides their marks; it does not change the summary. Hidden outliers do not expand automatic visual limits. Notches, bootstrap and percentile-whisker options are not supported.

Use `set_data(groups=..., labels=...)` / `setData({groups: ..., labels: ...})` to replace groups atomically. Without new labels, unchanged group counts keep their positions; changed group counts receive default labels. Each raw group retains its own dtype/buffer. Use `set_options(whis=..., showfliers=..., box_width=...)` / `setOptions(...)` for rendering/statistical options.

### Named coordinates without manual encoding

`plot` and `scatter` accept all-numeric or all-string x/y channels, including two categorical axes. Mixed numeric/string channels are rejected. Heatmap, 3D and scalar color arrays remain numeric. Category axes use linear ordinal geometry, not a logarithmic scale.

Call `set_categories("x", ["Small", "Medium", "Large"])` / `setCategories('x', [...])` **before adding data to the axis** to seed its order. Otherwise order is first occurrence. New categories append; updates, visibility changes, removal and bookmark restoration never renumber old categories. Shared axes use one map. Numeric `1` is not category `"1"`, and numeric and categorical layers cannot share the same axis. A line joins samples in their original input order, not sorted category order.

Numeric viewport limits and annotation coordinates refer to ordinal slots (0, 1, ...). Bookmarks store views, not category maps or historical data. Reordering/compacting populated axes is intentionally not supported. Long tick labels are shortened for display; full strings remain in data/hover/export.

### Inspect, interact and share

Histograms and boxplots require linear 2D axes. Bars permit linear or time positions with a linear value axis; bar widths use position units, including milliseconds. Statistical layers and categorical scenes use protocol 3 unless newer features promote them: links require protocol 4 and presentation/time require protocol 5. Existing scenes remain readable. Invalid data/options updates leave the previous valid scene intact.

Hover displays bar values/baselines, histogram bin edges/counts/displayed heights, or box quartiles/whiskers/outliers. Rectangle selection emits `kind: 'bars' | 'bins' | 'boxes'`, with layer/panel IDs, selected row/bin/group `indices`, `count`, and `truncated` (at most 10,000 returned indices). Bin/group indices are not raw sample indices. Selecting a box means selecting a group, not filtering its raw samples. Histogram/bin selection remains independent; linked highlighting begins in a scatter of an explicit selection link.

The inspector's `total` counts source values; `valid` counts finite values, `omitted` counts non-finite values, and `rangeExcluded` counts histogram samples outside the range. `rendered` counts intersecting bars/bins/groups, not GPU triangles. `visible` for histograms/boxes counts samples in intersecting bins/groups, **not** a raw point-in-viewport query; `method` states this distinction. Summary exactness is independent of viewport clipping.

PNG includes all panels and category labels. HTML embeds original samples, category maps, options and the matching engine; it needs no Python kernel or network. The existing 2,000,000-vertex geometry budget applies and fails explicitly rather than silently sampling statistical marks. Narrow the viewport or disable boxplot outlier marks when needed.
