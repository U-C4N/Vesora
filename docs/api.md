# API and usage

Python uses `snake_case`; JavaScript uses `camelCase`. Both APIs send the same scene and data model to the shared TypeScript engine. A figure contains either 2D or 3D layers; mixing them in one figure raises an error.

## Create a figure

| Operation | Python | JavaScript |
| --- | --- | --- |
| Figure | `vs.figure(title="Experiment")` | `figure({title: 'Experiment'})` |
| Line | `fig.plot(x, y)` | `fig.plot(x, y)` |
| Scatter | `fig.scatter(x, y)` | `fig.scatter(x, y)` |
| Heatmap | `fig.heatmap(x, y, z)` | `fig.heatmap(x, y, z)` |
| Surface | `fig.surface(x, y, z)` | `fig.surface(x, y, z)` |
| 3D scatter | `fig.scatter3d(x, y, z)` | `fig.scatter3d(x, y, z)` |
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

## Use NumPy optionally

Supported Python inputs include lists, tuples, `array.array`, and supported numeric buffers. When installed, NumPy `ndarray` inputs are accepted through the buffer protocol. This uses the same data adapter and visualization engine.

For an optional source installation, run `python -m pip install -e ".[numpy]"`. For a downloaded wheel, run `python -m pip install "./vesora-0.2.0-py3-none-any.whl[numpy]"`. Float32/Float64 and supported integer buffers map to the shared data descriptors. NumPy grids must satisfy `z.shape == (len(y), len(x))`.

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

In 2D, drag to pan, use the wheel to zoom, and Shift + drag to select a rectangle. In 3D, drag to orbit the camera and use the wheel to zoom. Hover and selection results refer to original source indices or aggregation cells.

```javascript
// Using the figure created above:
const unsubscribe = fig.on('selection', selection => console.log(selection));
fig.on('representation', info => console.log(info));
fig.on('error', error => console.error(error));
console.log(fig.inspect());
unsubscribe();
```

JavaScript's `fig.inspect()` returns `kind`, `total`, `visible`, `rendered`, `exact`, `method`, and `layerId` for each layer. For density, `exact: true` means the counts are exact; it does not mean every point is drawn separately. After a view update, use `await fig.ready()` before reading the completed result.

Event names are `hover`, `selection`, `viewchange`, `representation`, and `error`. A point selection includes source `indices`, `count`, and `truncated`. A density selection includes `bounds` and `count`. Surface/heatmap colors represent z values; a density colorbar represents the number of points per cell.

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

Bookmarks capture axis scales, labels and limits, camera rotation/distance, and 3D pan. They do not capture data copies, historical layer visibility/styles, or selections. Every bookmark uses the latest dataset and the layer visibility at export time.

Names are trimmed and must be nonempty. Reusing a name replaces its view and note without changing the order. Notes are plain text and may be omitted. `restore_bookmark(name)` / `restoreBookmark(name)` replaces the full view, including returning to automatic axis limits. `remove_bookmark(name)` / `removeBookmark(name)` deletes it. Unknown names raise an error. Closed figures cannot be exported or bookmarked.

JavaScript can also restore a saved complete `ViewSpec` with `fig.restoreView(view)`. This replaces the view and clears transient interaction state; `setView` continues to update only supplied settings. `pan3d` is a pair of finite normalized screen offsets, defaulting to `[0, 0]`. In the viewer, Shift + drag pans a 3D scene; Python retains that interaction state for bookmarks and export.

The exported file opens at the export-time view, not the first bookmark. Its **Reset view** button and double-click restore that opening view. Clicking a bookmark restores its saved view; exploring manually clears the active bookmark indicator. Bookmarks are authored through the API, not edited in the exported viewer.

### Understand what is shared

The viewer's **Inspector** reports each visible layer separately, with units such as points, retained line samples, occupied density bins, cells, or triangles. Density's **All visible samples counted** means exact bin counts, not that every source point is drawn. Counts refresh after rendering each new view.

Full exported source arrays are embedded even when the screen shows a reduced representation. Large datasets produce larger files. Python callbacks, application code, gallery sliders, and live data connections are not serialized; computed data can be explored but Python calculations cannot be rerun from the file.

## Display Python figures on desktop or in a notebook

In a normal script, `fig.show()` opens a QtWebEngine window and waits until it closes. In an IPython notebook kernel, it selects the widget host. Choose a host explicitly with `host="desktop"` or `host="notebook"`. GUI calls must run on the main thread. `show(block=False)` requires an existing Qt event loop or regular calls to `vs.process_events()`.

For notebook support, install `python -m pip install -e ".[notebook]"` from source, then call `fig.show()`. The notebook adapter uses the same engine and binary data. Interactions require a running kernel and widget communication. Export a displayed widget with `await fig.savefig_async("plot.png")` without opening a Qt window; synchronous `savefig` uses the Qt host.

## Export PNG and release resources

Mount a JavaScript figure before exporting. `await fig.savefig()` waits for rendering, composites the WebGL and annotation canvases, and returns a PNG Blob. In the browser, the figure's width follows its mount element; set the element's CSS width for a fixed size. Output dimensions are the actual CSS figure dimensions multiplied by the device pixel ratio, capped at 2. Python's `fig.savefig(path)` can export a figure that has not been displayed, using the Qt host.

`close()` releases GPU resources, workers, and event listeners. A closed figure cannot be reused. In Python, closing only the desktop window preserves the figure's data for later display or export. An explicit `fig.close()` releases that data too.
