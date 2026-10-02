# @vesora/core

A TypeScript scientific visualization engine shared by Python and JavaScript. It provides WebGL2 rendering for 2D lines, scatter, and heatmaps; 3D surfaces and scatter; and PNG export. TypeScript types are included.

**0.1 development release:** the API is not yet stable. Rendering requires a browser with WebGL2 support.

## Installation

Download `vesora-core-0.1.0.tgz` from the [v0.1.0 GitHub Release](https://github.com/U-C4N/Vesora/releases/tag/v0.1.0) assets and place it in your frontend project:

```bash
npm install ./vesora-core-0.1.0.tgz
```

The package is distributed through GitHub Release assets. It has not been published to the npm registry.

## JavaScript / TypeScript usage

Add a chart container to your HTML page:

```html
<div id="chart"></div>
```

In the JavaScript or TypeScript entry point of your browser-based bundler project:

```javascript
import { figure } from '@vesora/core';

const chart = document.getElementById('chart');
if (!chart) throw new Error('The #chart element was not found');

const fig = figure({ title: 'Measurements' });
fig.plot([0, 1, 2, 3], [0, 1, 4, 9], { label: 'y = x²' });
fig.mount(chart);
```

`await fig.ready()` waits for pending rendering to finish; `await fig.savefig()` returns a PNG `Blob`. Update layers with `setData`, `setStyle`, and `setVisible`. Call `fig.close()` when removing a figure from the page.

## Documentation

- [API and examples](../../docs/api.md)
- [Shared core and data model](../../docs/architecture.md)
- [Python installation and source development](../../README.md)

This version works with in-memory data. Dense scatter uses count aggregation, and line reduction preserves extrema. WebGPU and SVG/PDF export are not available in this version.
