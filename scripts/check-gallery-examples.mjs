// Pure computation check: no browser, GUI, NumPy, or rendering stubs beyond show/mount.
// Run after npm run build: node scripts/check-gallery-examples.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { figure, subplots } from '../packages/core/dist/index.js';
import { examples as originalExamples } from '../examples/web/scenarios.js';
import { comparisonExamples } from '../examples/web/comparison-scenarios.js';
import { statisticsExamples } from '../examples/web/statistics-scenarios.js';
const examples = [...originalExamples, ...comparisonExamples, ...statisticsExamples];

const root = fileURLToPath(new URL('../', import.meta.url));
const expected = ['multi-line', 'training-loss', 'benchmark-score', 'quality-latency', 'signal', 'scatter', 'density', 'heatmap', 'precision', 'spectrum', 'phase', 'surface', 'scatter3d', 'lorenz', 'interference', 'peaks'];
expected.push('signal-comparison', 'shared-distributions', 'heatmap-comparison');
expected.push(...statisticsExamples.map(example => example.id));
assert.deepEqual(examples.map(example => example.id), expected);
assert.equal(examples.filter(example => example.dimension === '2d').length, 20);
assert.equal(examples.filter(example => example.dimension === '3d').length, 5);

function shapeSummary(snapshot) {
  const sources = new Map(snapshot.sources.map(source => [source.id, source]));
  return {
    dimension: snapshot.figure.view.kind,
    layers: snapshot.figure.layers.map(layer => ({
      kind: layer.kind,
      data: Object.fromEntries(Object.entries(layer.data).map(([channel, id]) => [channel, sources.get(id).shape])),
    })),
  };
}

function checkBenchmarkValues(fig, id) {
  const view = fig.spec.view;
  const layers = fig.spec.layers.map(layer => ({ ...layer, x: fig.registry.get(layer.data.x).values, y: fig.registry.get(layer.data.y).values }));
  if (id === 'multi-line') {
    assert.deepEqual(layers.map(layer => layer.kind), ['line', 'line', 'line']);
    assert.match(view.yLabel, /°C/);
  } else if (id === 'training-loss') {
    assert.equal(view.yScale, 'log');
    assert.match(view.yLabel, /lower is better/i);
    for (const layer of layers) {
      assert.ok(layer.y.every(value => Number.isFinite(value) && value > 0));
      assert.ok(layer.y.at(-1) < layer.y[0]);
    }
  } else if (id === 'benchmark-score') {
    assert.equal(view.xScale, 'log');
    assert.deepEqual(view.yDomain, [0, 100]);
    assert.equal(layers.filter(layer => layer.kind === 'scatter').length, 3);
    for (const layer of layers) {
      assert.deepEqual(Array.from(layer.x), [128, 256, 512, 1024, 2048, 4096, 8192]);
      assert.ok(layer.y.every(value => Number.isFinite(value) && value >= 0 && value <= 100));
    }
  } else if (id === 'quality-latency') {
    assert.match(view.xLabel, /\bms\b/);
    assert.match(view.yLabel, /quality score/i);
    assert.deepEqual(view.yDomain, [0, 100]);
    for (const layer of layers) {
      assert.ok(layer.x.every(value => Number.isFinite(value) && value > 0));
      assert.ok(layer.y.every(value => Number.isFinite(value) && value >= 0 && value <= 100));
    }
  }
}

const javascript = [];
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
for (const example of examples) {
  assert.equal(typeof example.javascript, 'string', `${example.id}: JavaScript source missing`);
  const source = example.javascript.replace(/^\s*import\s*\{\s*(figure|subplots)\s*\}\s*from\s*['"]@vesora\/core['"];?\s*$/m, '');
  assert.notEqual(source, example.javascript, `${example.id}: expected standalone @vesora/core import`);
  const figures = [];
  const target = {};
  let mounts = 0;
  const create = factory => options => {
    const fig = factory(options);
    fig.mount = element => { assert.equal(element, target); mounts++; return fig; };
    figures.push(fig);
    return fig;
  };
  try {
    await new AsyncFunction('figure', 'subplots', 'document', source)(create(figure), create(subplots), { querySelector: selector => { assert.equal(selector, '#chart'); return target; } });
    assert.equal(figures.length, 1, `${example.id}: expected one standalone Figure`);
    assert.equal(mounts, 1, `${example.id}: standalone snippet must mount #chart`);
    const fig = figures[0], snapshot = fig.snapshot();
    assert.equal(snapshot.figure.view.kind, example.dimension, `${example.id}: incorrect dimension`);
    assert.ok(snapshot.figure.layers.length > 0, `${example.id}: empty scene`);
    if (expected.slice(0, 4).includes(example.id)) {
      assert.equal(example.synthetic, true);
      assert.match(example.dataNote, /Synthetic data/);
      assert.equal(example.series.length, 3);
      assert.deepEqual(example.series.flatMap(series => series.layerIndices).sort((a, b) => a - b), snapshot.figure.layers.map((_, index) => index));
      checkBenchmarkValues(fig, example.id);
    }
    for (const descriptor of snapshot.sources) {
      const values = fig.registry.get(descriptor.id).values;
      assert.equal(values.byteLength, descriptor.byteLength);
      assert.equal(values.length, descriptor.shape.reduce((product, length) => product * length, 1));
    }
    javascript.push({ id: example.id, summary: shapeSummary(snapshot) });
  } finally {
    for (const fig of figures) fig.close();
  }
}

const localPython = resolve(root, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
const python = process.env.VESORA_PYTHON ?? process.env.PYTHON ?? (existsSync(localPython) ? localPython : 'python');
const driver = String.raw`
import contextlib
import importlib.abc
import io
import json
import math
import struct
import sys
sys.path.insert(0, sys.argv[1])

class BlockNumPy(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname == 'numpy' or fullname.startswith('numpy.'):
            raise ImportError('Gallery snippets must work without NumPy')

sys.meta_path.insert(0, BlockNumPy())
import vesora as vs
vs.Figure.show = lambda self, *args, **kwargs: self
original_figure = vs.figure
original_subplots = vs.subplots
results = []
for example in json.load(sys.stdin):
    figures = []
    def create(**options):
        figure = original_figure(**options)
        figures.append(figure)
        return figure
    vs.figure = create
    def create_subplots(*args, **options):
        figure = original_subplots(*args, **options)
        figures.append(figure)
        return figure
    vs.subplots = create_subplots
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            exec(compile(example['python'], 'gallery-' + example['id'] + '.py', 'exec'), {'__name__': '__main__'})
        assert len(figures) == 1, example['id'] + ': expected one standalone Figure'
        figure = figures[0]
        snapshot = figure.snapshot()
        assert snapshot['figure']['view']['kind'] == example['dimension']
        assert snapshot['figure']['layers'], example['id'] + ': empty scene'
        sources = {source['id']: source for source in snapshot['sources']}
        for source in sources.values():
            assert len(figure._data_bytes(source['id'], source['version'])) == source['byteLength']
        if example['id'] in ('multi-line', 'training-loss', 'benchmark-score', 'quality-latency'):
            formats = {'float64': 'd', 'float32': 'f', 'int32': 'i', 'uint32': 'I', 'int16': 'h', 'uint16': 'H', 'int8': 'b', 'uint8': 'B'}
            def values(layer, channel):
                source = sources[layer['data'][channel]]
                return [item[0] for item in struct.iter_unpack('<' + formats[source['dtype']], figure._data_bytes(source['id'], source['version']))]
            view, layers = snapshot['figure']['view'], snapshot['figure']['layers']
            if example['id'] == 'multi-line':
                assert [layer['kind'] for layer in layers] == ['line', 'line', 'line']
                assert '°C' in view['yLabel']
            elif example['id'] == 'training-loss':
                assert view['yScale'] == 'log' and 'lower is better' in view['yLabel'].lower()
                for layer in layers:
                    loss = values(layer, 'y')
                    assert all(math.isfinite(value) and value > 0 for value in loss)
                    assert loss[-1] < loss[0]
            elif example['id'] == 'benchmark-score':
                assert view['xScale'] == 'log' and view['yDomain'] == [0, 100]
                assert sum(layer['kind'] == 'scatter' for layer in layers) == 3
                for layer in layers:
                    assert values(layer, 'x') == [128, 256, 512, 1024, 2048, 4096, 8192]
                    assert all(math.isfinite(value) and 0 <= value <= 100 for value in values(layer, 'y'))
            elif example['id'] == 'quality-latency':
                assert 'ms' in view['xLabel'] and view['yDomain'] == [0, 100]
                assert 'quality score' in view['yLabel'].lower()
                for layer in layers:
                    assert all(math.isfinite(value) and value > 0 for value in values(layer, 'x'))
                    assert all(math.isfinite(value) and 0 <= value <= 100 for value in values(layer, 'y'))
        summary = {
            'dimension': snapshot['figure']['view']['kind'],
            'layers': [
                {'kind': layer['kind'], 'data': {channel: sources[identifier]['shape'] for channel, identifier in layer['data'].items()}}
                for layer in snapshot['figure']['layers']
            ],
        }
        assert not any(name == 'numpy' or name.startswith('numpy.') for name in sys.modules)
        results.append({'id': example['id'], 'summary': summary})
    finally:
        for figure in figures:
            figure.close()
print(json.dumps(results))
`;
const result = execFileSync(python, ['-X', 'utf8', '-S', '-c', driver, resolve(root, 'python')], {
  cwd: root,
  input: JSON.stringify(examples.map(({ id, dimension, python }) => ({ id, dimension, python }))),
  encoding: 'utf8', windowsHide: true, timeout: 120_000, maxBuffer: 2 * 1024 * 1024,
});
const pythonResults = JSON.parse(result);
assert.deepEqual(pythonResults, javascript, 'Python and JavaScript snippets must create matching dimensions, layers and data shapes');
console.log(`Verified ${examples.length} JavaScript snippets and ${pythonResults.length} Python snippets with NumPy blocked; all scene shapes match.`);
