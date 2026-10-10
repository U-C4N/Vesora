# API and usage

Python uses `snake_case`; JavaScript uses `camelCase`. Both APIs send the same scene and data model to the shared TypeScript engine. A figure contains either 2D or 3D layers; mixing them in one figure raises an error. v0.4 adds statistical charts and categorical coordinates to the existing fixed 2D panels, annotations and exports. Installation dependencies are unchanged.

## Create a figure

| Operation | Python | JavaScript |
| --- | --- | --- |
| Figure | `vs.figure(title="Experiment")` | `figure({title: 'Experiment'})` |
| 2D grid | `vs.subplots(2, 1, sharex=True)` | `subplots({rows: 2, cols: 1, shareX: true})` |
| Panel | `fig.panel(0, 0)` | `fig.panel(0, 0)` |
| Line | `fig.plot(x, y)` | `fig.plot(x, y)` |
| Scatter | `fig.scatter(x, y)` | `fig.scatter(x, y)` |
| Heatmap | `fig.heatmap(x, y, z)` | `fig.heatmap(x, y, z)` |
| Surface | `fig.surface(x, y, z)` | `fig.surface(x, y, z)` |
| 3D scatter | `fig.scatter3d(x, y, z)` | `fig.scatter3d(x, y, z)` |
| Histogram | `fig.hist(samples, bins=20)` | `fig.hist(samples, {bins: 20})` |
| Vertical/horizontal bars | `fig.bar(labels, values)` / `fig.barh(labels, values)` | `fig.bar(labels, values)` / `fig.barh(labels, values)` |
| Boxplot | `fig.boxplot(groups, labels=names)` | `fig.boxplot(groups, {labels: names})` |
| Display | `fig.show()` | `fig.mount(element)` |
| PNG export | `fig.savefig("figure.png")` | `await fig.savefig()` → `Blob` |
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

Grid shape is fixed at creation. This version has no panel spans, nested layouts, dynamic panel insertion, 3D panels, or linked selection highlighting. Existing single-panel 3D figures remain supported.

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

`text` requires x and y; a horizontal line accepts y; a vertical line accepts x. Coordinates must be finite numbers. Error bars, confidence bands, arrows, mathematical text rendering and 3D annotations are not part of this API.

Defaults are color `#475569`, line width `1`, opacity `1`, and font size `12`. Text uses the system sans-serif font, left alignment, and literal newline characters for multiple lines. Text is never interpreted as HTML or mathematical markup.

## Use NumPy optionally

Supported Python inputs include lists, tuples, `array.array`, and supported numeric buffers. When installed, NumPy `ndarray` inputs are accepted through the buffer protocol. This uses the same data adapter and visualization engine.

For an optional source installation, run `python -m pip install -e ".[numpy]"`. For a locally built wheel, run `python -m pip install "./dist/release-v0.4.0/vesora-0.4.0-py3-none-any.whl[numpy]"`. Float32/Float64 and supported integer buffers map to the shared data descriptors. NumPy grids must satisfy `z.shape == (len(y), len(x))`.

This example supplies Float32 buffers using the Python standard library:

```python
from array import array
import vesora as vs

fig = vs.figure(title="Float32 measurements")
fig.scatter(array("f", [1, 2, 3]), array("f", [3, 1, 2]))
fig.show()
```

## Update styles and data

Style options are `color`, `size`, `width`, `opacity`, `label`, `colormap`, `representation`, and `colorDomain` (`color_domain` in Python). Colormaps are `viridis` or `magma`. Scatter representation modes are `auto`, `points`, and `density`.

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

JavaScript event names are `hover`, `selection`, `viewchange`, `representation`, and `error`. Python hosts forward `selection`, `viewchange`, `representation`, and `error`; `hover` is currently JavaScript-only. A point selection includes source `indices`, `count`, and `truncated`; at most 10,000 indices are returned. A density selection includes `bounds` and `count`. Grid hover/selection events identify the source panel. A selection does not highlight or filter another panel. Surface/heatmap colors represent z values; a density colorbar represents the number of points per cell.

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

Mount a JavaScript figure before exporting. `await fig.savefig()` waits for every panel, composites the WebGL and annotation canvases, and returns a PNG Blob of the whole layout. In the browser, the figure's width follows its mount element subject to the grid's minimum cell size; set the element's CSS width for a fixed size. Output dimensions are the actual CSS figure dimensions multiplied by the device pixel ratio, capped at 2. Python's `fig.savefig(path)` can export a figure that has not been displayed, using the Qt host. A current render failure rejects export instead of returning an older image.

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

Statistical charts require linear 2D axes in v0.4. New layers and categorical scenes use protocol 3, including when combined with v0.3 panels or annotations. Existing v1/v2 scenes remain readable. Invalid data/options updates leave the previous valid scene intact.

Hover displays bar values/baselines, histogram bin edges/counts/displayed heights, or box quartiles/whiskers/outliers. Rectangle selection emits `kind: 'bars' | 'bins' | 'boxes'`, with layer/panel IDs, selected row/bin/group `indices`, `count`, and `truncated` (at most 10,000 returned indices). Bin/group indices are not raw sample indices. Selecting a box means selecting a group, not filtering its raw samples. Linked highlighting remains outside this release.

The inspector's `total` counts source values; `valid` counts finite values, `omitted` counts non-finite values, and `rangeExcluded` counts histogram samples outside the range. `rendered` counts intersecting bars/bins/groups, not GPU triangles. `visible` for histograms/boxes counts samples in intersecting bins/groups, **not** a raw point-in-viewport query; `method` states this distinction. Summary exactness is independent of viewport clipping.

PNG includes all panels and category labels. HTML embeds original samples, category maps, options and the matching engine; it needs no Python kernel or network. The existing 2,000,000-vertex geometry budget applies and fails explicitly rather than silently sampling statistical marks. Narrow the viewport or disable boxplot outlier marks when needed.
