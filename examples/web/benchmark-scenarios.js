// All values here are synthetic examples, not reported measurements or model results.
const dataNote = 'Synthetic data · Not measured results or real model outputs.';
const modelColors = ['#3569c8', '#d36a55', '#188781'];
const modelLabels = ['Model A', 'Model B', 'Model C'];

function addSeries(fig, records, markers = false) {
  for (const { x, y, label, color } of records) {
    fig.plot(x, y, { color, width: 2.2, label });
    if (markers) fig.scatter(x, y, { color, size: 6, representation: 'points' });
  }
}

function multiLine(fig) {
  const hour = Float64Array.from({ length: 97 }, (_, i) => i / 4);
  addSeries(fig, [
    {
      x: hour, label: 'Indoor', color: '#3569c8',
      y: hour.map(t => 22 + 1.8 * Math.sin(2 * Math.PI * (t - 8) / 24) + 0.25 * Math.sin(Math.PI * t / 2)),
    },
    {
      x: hour, label: 'Lab', color: '#d36a55',
      y: hour.map(t => 19.5 + 0.7 * Math.sin(2 * Math.PI * (t - 6) / 24) + 0.15 * Math.sin(Math.PI * t / 3)),
    },
    {
      x: hour, label: 'Outdoor', color: '#188781',
      y: hour.map(t => 16 + 5.5 * Math.sin(2 * Math.PI * (t - 8) / 24)),
    },
  ]);
  fig.setView({ xDomain: [0, 24], yDomain: [9, 26], xLabel: 'Hour', yLabel: 'Temperature (°C)' });
}

function trainingLoss(fig) {
  const steps = Float64Array.from({ length: 401 }, (_, i) => i * 50);
  addSeries(fig, [
    {
      x: steps, label: 'Model A', color: '#3569c8',
      y: steps.map(s => 2.3 * Math.exp(-s / 3400) + 0.23 + 0.03 * Math.exp(-s / 9000) * Math.sin(s / 240)),
    },
    {
      x: steps, label: 'Model B', color: '#d36a55',
      y: steps.map(s => 2.65 * Math.exp(-s / 4800) + 0.17 + 0.045 * Math.exp(-s / 8000) * Math.sin(s / 300 + 0.3)),
    },
    {
      x: steps, label: 'Model C', color: '#188781',
      y: steps.map(s => 2.5 * Math.exp(-s / 2400) + 0.34 + 0.025 * Math.exp(-s / 8500) * Math.sin(s / 180 + 0.7)),
    },
  ]);
  fig.setView({ xDomain: [0, 20000], yScale: 'log', xLabel: 'Training step', yLabel: 'Loss · lower is better' });
}

function benchmarkScore(fig) {
  const tokens = Float64Array.from([128, 256, 512, 1024, 2048, 4096, 8192]);
  addSeries(fig, [
    { x: tokens, y: Float64Array.from([38, 48, 58, 68, 77, 83, 87]), label: 'Model A', color: '#3569c8' },
    { x: tokens, y: Float64Array.from([44, 52, 61, 68, 74, 78, 81]), label: 'Model B', color: '#d36a55' },
    { x: tokens, y: Float64Array.from([30, 43, 56, 70, 81, 88, 92]), label: 'Model C', color: '#188781' },
  ], true);
  fig.setView({
    xScale: 'log', xDomain: [100, 10000], yDomain: [0, 100],
    xLabel: 'Inference token budget', yLabel: 'Success (%) · higher is better',
  });
}

function qualityLatency(fig) {
  // Each series follows the same seven synthetic token budgets: 128 through 8192.
  // Latencies are invented values, not timings measured in this browser.
  addSeries(fig, [
    {
      x: Float64Array.from([120, 180, 280, 430, 650, 960, 1440]),
      y: Float64Array.from([52, 61, 69, 76, 81, 85, 88]), label: 'Model A', color: '#3569c8',
    },
    {
      x: Float64Array.from([80, 115, 165, 240, 360, 520, 760]),
      y: Float64Array.from([49, 57, 64, 70, 75, 78, 80]), label: 'Model B', color: '#d36a55',
    },
    {
      x: Float64Array.from([180, 260, 390, 600, 900, 1360, 2050]),
      y: Float64Array.from([55, 65, 74, 82, 88, 92, 95]), label: 'Model C', color: '#188781',
    },
  ], true);
  fig.setView({
    xDomain: [0, 2200], yDomain: [0, 100],
    xLabel: 'Response latency (ms) · lower is better', yLabel: 'Quality score · higher is better',
  });
}

function javascript(create) {
  return 'import { figure } from "@vesora/core";\n\n'
    + '// Synthetic data: Not measured results or real model outputs.\n'
    + '// HTML: <div id="chart"></div>\n\n'
    + addSeries.toString() + '\n\n' + create.toString()
    + `\n\nconst fig = figure();\n${create.name}(fig);\nfig.mount(document.querySelector("#chart"));`;
}

function python(body) {
  return 'import math\nimport vesora as vs\n\n'
    + '# Synthetic data: Not measured results or real model outputs.\n'
    + body.trim() + '\n\nvs.show()';
}

function modelSeries(markers = false) {
  return modelLabels.map((label, i) => ({ label, color: modelColors[i], layerIndices: markers ? [i * 2, i * 2 + 1] : [i] }));
}

export const benchmarkExamples = [
  {
    id: 'multi-line', dimension: '2d', category: 'line', title: 'One day, three temperature curves', type: 'LINE / MULTIPLE SERIES',
    description: 'Synthetic · Three temperature sensors over 24 hours, sampled every 15 minutes.',
    tags: ['3 series', '24 hours', 'Temperature · °C'], synthetic: true, dataNote,
    insight: 'Compare indoor and outdoor temperature ranges on the same axes in this synthetic daily cycle.',
    series: ['Indoor', 'Laboratory', 'Outdoor'].map((label, i) => ({ label, color: modelColors[i], layerIndices: [i] })),
    create: multiLine, javascript: javascript(multiLine),
    python: python(`fig = vs.figure()
hour = [i/4 for i in range(97)]
records = [
    ("Indoor", "#3569c8",
     [22 + 1.8*math.sin(2*math.pi*(t-8)/24) + 0.25*math.sin(math.pi*t/2) for t in hour]),
    ("Lab", "#d36a55",
     [19.5 + 0.7*math.sin(2*math.pi*(t-6)/24) + 0.15*math.sin(math.pi*t/3) for t in hour]),
    ("Outdoor", "#188781",
     [16 + 5.5*math.sin(2*math.pi*(t-8)/24) for t in hour]),
]
for label, color, values in records:
    fig.plot(hour, values, color=color, width=2.2, label=label)
fig.set_axes(xlim=(0, 24), ylim=(9, 26), xlabel="Hour", ylabel="Temperature (°C)")`),
  },
  {
    id: 'training-loss', dimension: '2d', category: 'ai', title: 'Training loss over time', type: 'AI / LEARNING CURVES',
    description: 'Synthetic · Three fictional models, 20,000 training steps, and a logarithmic loss axis.',
    tags: ['Model A / B / C', 'Log loss', 'Lower is better'], synthetic: true, dataNote,
    insight: 'In these synthetic curves, the fastest initial improvement does not necessarily yield the lowest final loss.',
    series: modelSeries(), create: trainingLoss, javascript: javascript(trainingLoss),
    python: python(`fig = vs.figure()
steps = [i*50 for i in range(401)]
records = [
    ("Model A", "#3569c8",
     [2.3*math.exp(-s/3400) + 0.23 + 0.03*math.exp(-s/9000)*math.sin(s/240) for s in steps]),
    ("Model B", "#d36a55",
     [2.65*math.exp(-s/4800) + 0.17 + 0.045*math.exp(-s/8000)*math.sin(s/300+0.3) for s in steps]),
    ("Model C", "#188781",
     [2.5*math.exp(-s/2400) + 0.34 + 0.025*math.exp(-s/8500)*math.sin(s/180+0.7) for s in steps]),
]
for label, color, values in records:
    fig.plot(steps, values, color=color, width=2.2, label=label)
fig.set_axes(xlim=(0, 20000), yscale="log", xlabel="Training step", ylabel="Loss · lower is better")`),
  },
  {
    id: 'benchmark-score', dimension: '2d', category: 'ai', title: 'Success versus token budget', type: 'AI / BUDGET–SUCCESS CURVE',
    description: 'Synthetic · Three fictional models and seven inference budgets; these are not real benchmark results.',
    tags: ['128–8,192 tokens', 'Lines + markers', 'Success · %'], synthetic: true, dataNote,
    insight: 'The synthetic ranking changes with budget; markers show sample values and lines connect them.',
    series: modelSeries(true), create: benchmarkScore, javascript: javascript(benchmarkScore),
    python: python(`fig = vs.figure()
tokens = [128, 256, 512, 1024, 2048, 4096, 8192]
records = [
    ("Model A", "#3569c8", [38, 48, 58, 68, 77, 83, 87]),
    ("Model B", "#d36a55", [44, 52, 61, 68, 74, 78, 81]),
    ("Model C", "#188781", [30, 43, 56, 70, 81, 88, 92]),
]
for label, color, values in records:
    fig.plot(tokens, values, color=color, width=2.2, label=label)
    fig.scatter(tokens, values, color=color, size=6, representation="points")
fig.set_axes(xscale="log", xlim=(100, 10000), ylim=(0, 100),
             xlabel="Inference token budget", ylabel="Success (%) · higher is better")`),
  },
  {
    id: 'quality-latency', dimension: '2d', category: 'ai', title: 'Quality versus latency', type: 'AI / QUALITY–LATENCY CURVE',
    description: 'Synthetic · Seven budget settings per model; latency values are not measured timings.',
    tags: ['3 fictional models', 'Latency · ms', 'Quality · 0–100'], synthetic: true, dataNote,
    insight: 'The upper left means higher quality and shorter latency; use this synthetic example to compare the trade-off.',
    series: modelSeries(true), create: qualityLatency, javascript: javascript(qualityLatency),
    python: python(`fig = vs.figure()
# Each series follows token budgets of 128, 256, 512, 1024, 2048, 4096, and 8192, in that order.
# Latency values are entirely fictional; no timings are measured here.
records = [
    ("Model A", "#3569c8", [120, 180, 280, 430, 650, 960, 1440],
     [52, 61, 69, 76, 81, 85, 88]),
    ("Model B", "#d36a55", [80, 115, 165, 240, 360, 520, 760],
     [49, 57, 64, 70, 75, 78, 80]),
    ("Model C", "#188781", [180, 260, 390, 600, 900, 1360, 2050],
     [55, 65, 74, 82, 88, 92, 95]),
]
for label, color, latency, quality in records:
    fig.plot(latency, quality, color=color, width=2.2, label=label)
    fig.scatter(latency, quality, color=color, size=6, representation="points")
fig.set_axes(xlim=(0, 2200), ylim=(0, 100),
             xlabel="Response latency (ms) · lower is better",
             ylabel="Quality score · higher is better")`),
  },
];
