import { benchmarkExamples } from './benchmark-scenarios.js';

// Every card and its copyable snippets use the same shared-engine semantics.
// No timings or performance figures are fabricated by this gallery.
function range(start, end, count) {
  return Float64Array.from({ length: count }, (_, i) => start + (end - start) * i / (count - 1));
}

function gaussian(count, seed = 42) {
  const x = new Float64Array(count), y = new Float64Array(count);
  const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) + 1) / 4294967297;
  for (let i = 0; i < count; i++) {
    const radius = Math.sqrt(-2 * Math.log(random())), angle = 2 * Math.PI * random();
    x[i] = radius * Math.cos(angle); y[i] = radius * Math.sin(angle);
  }
  return { x, y };
}

function twoSourceGrid(axis, phase, intensity = false) {
  const size = axis.length, z = new Float64Array(size * size);
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    const x = axis[col], y = axis[row];
    const r1 = Math.hypot(x + 1.6, y), r2 = Math.hypot(x - 1.6, y);
    // Regularized, dimensionless amplitudes; this is an idealized wave model.
    const a = 1 / Math.sqrt(1 + r1), b = 1 / Math.sqrt(1 + r2);
    z[row * size + col] = intensity
      ? a * a + b * b + 2 * a * b * Math.cos(5 * (r1 - r2) - phase)
      : a * Math.cos(5 * r1) + b * Math.cos(5 * r2 + phase);
  }
  return z;
}

function lorenzData(rho = 28, count = 25000) {
  const x = new Float64Array(count), y = new Float64Array(count), z = new Float64Array(count);
  const step = 0.005, warmup = 2000;
  const derivative = (a, b, c) => [10 * (b - a), a * (rho - c) - b, a * b - (8 / 3) * c];
  let a = 0.1, b = 0, c = 0;
  for (let i = 0; i < count + warmup; i++) {
    const k1 = derivative(a, b, c);
    const k2 = derivative(a + step * k1[0] / 2, b + step * k1[1] / 2, c + step * k1[2] / 2);
    const k3 = derivative(a + step * k2[0] / 2, b + step * k2[1] / 2, c + step * k2[2] / 2);
    const k4 = derivative(a + step * k3[0], b + step * k3[1], c + step * k3[2]);
    a += step * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]) / 6;
    b += step * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]) / 6;
    c += step * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]) / 6;
    if (i >= warmup) { const j = i - warmup; x[j] = a; y[j] = b; z[j] = c; }
  }
  return { x, y, z };
}

function peakField(x, y) {
  return 3 * Math.exp(-((x - 1.2) ** 2 / 0.45 + (y - 0.7) ** 2 / 0.7))
    - 2.2 * Math.exp(-((x + 1.1) ** 2 / 0.7 + (y + 0.4) ** 2 / 0.45))
    + 2 * Math.exp(-((x + 0.5) ** 2 / 0.35 + (y - 1.45) ** 2 / 0.5))
    + 0.25 * x * y * Math.exp(-0.15 * (x * x + y * y));
}

function signal(fig) {
  const x = range(0, 24, 120000), baseline = new Float64Array(x.length), y = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const t = x[i];
    baseline[i] = Math.sin(2 * Math.PI * 0.6 * t);
    y[i] = baseline[i] + 0.18 * Math.sin(2 * Math.PI * 13 * t)
      + 2.4 * Math.exp(-(((t - 4.25) / 0.0035) ** 2))
      - 2.2 * Math.exp(-(((t - 16.6) / 0.0045) ** 2));
    if (t > 10.4 && t < 11.3) { y[i] = NaN; baseline[i] = NaN; }
  }
  fig.plot(x, y, { color: '#137f8b', width: 1.3, label: 'Signal model' });
  fig.plot(x, baseline, { color: '#d48c43', width: 1.5, label: '0.6 Hz component' });
  fig.setView({ xLabel: 'Time (s)', yLabel: 'Amplitude' });
}

function scatter(fig) {
  const { x, y: noise } = gaussian(6000, 17), y = new Float64Array(x.length), sigma = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    x[i] *= 1.2; sigma[i] = 0.12 + 0.2 * Math.abs(x[i]);
    y[i] = 0.45 * x[i] + 0.1 * x[i] ** 2 + sigma[i] * noise[i];
  }
  fig.scatter(x, y, { values: sigma, size: 3, opacity: 0.6, representation: 'points', colormap: 'viridis' });
  const trend = range(-4.5, 4.5, 300);
  fig.plot(trend, trend.map(v => 0.45 * v + 0.1 * v * v), { color: '#b85c4a', width: 2, label: 'Conditional mean' });
  fig.setView({ xLabel: 'Input x', yLabel: 'Response y' });
}

function density(fig) {
  const { x, y } = gaussian(1000000, 42);
  for (let i = 0; i < x.length; i++) {
    const a = x[i], b = y[i], group = i % 10;
    if (group < 5) { x[i] = -1.8 + 0.65 * a; y[i] = -0.8 + 0.35 * a + 0.4 * b; }
    else if (group < 8) { x[i] = 1.5 + 0.45 * a; y[i] = -0.65 - 0.25 * a + 0.6 * b; }
    else { x[i] = 0.65 * a; y[i] = 1.65 + 0.35 * b; }
  }
  fig.scatter(x, y, { color: '#137f8b', size: 3, representation: 'auto', colormap: 'viridis' });
  fig.setView({ xLabel: 'x', yLabel: 'y' });
  fig.bookmark('Overview', { note: 'Zoomed out, color reports the number of samples in each bin.' });
  fig.setView({ xDomain: [-3.5, 0], yDomain: [-2, 0.6] });
  fig.bookmark('Separate clusters', { note: 'Inspect the left-hand cluster without changing the source data.' });
  fig.setView({ xDomain: [-1.81, -1.79], yDomain: [-0.81, -0.79] });
  fig.bookmark('Individual samples', { note: 'At this scale, the renderer shows individual samples.' });
  fig.restoreBookmark('Overview');
}

function heatmap(fig) {
  const axis = range(-6, 6, 181), z = twoSourceGrid(axis, Math.PI / 3, true);
  fig.heatmap(axis, axis, z, { colormap: 'magma', colorDomain: [0, 2.5] });
  fig.setView({ xLabel: 'x (relative units)', yLabel: 'y (relative units)' });
}

function precision(fig) {
  const origin = 1e12;
  const x = Float64Array.from({ length: 2048 }, (_, i) => origin + i * 0.00025);
  const y = x.map(value => {
    const t = value - origin;
    return 0.6 * Math.sin(2 * Math.PI * 8 * t) + 0.15 * Math.sin(2 * Math.PI * 80 * t);
  });
  fig.plot(x, y, { color: '#8560ad', width: 1.7, label: 'Float64 source' });
  fig.setView({ xLabel: 'x ≈ 10¹² (target Δx = 0.00025)', yLabel: 'Amplitude' });
}

function spectrum(fig) {
  const f = Float64Array.from({ length: 8000 }, (_, i) => 10 ** (-1 + 4 * i / 7999));
  const y = f.map(value => 0.002 + 0.1 / (1 + (value / 2) ** 2)
    + 4 / (1 + ((value - 3.4) / 0.04) ** 2)
    + 1.8 / (1 + ((value - 24.5) / 0.35) ** 2)
    + 0.75 / (1 + ((value - 210) / 2.2) ** 2));
  fig.plot(f, y, { color: '#bc8040', width: 1.8, label: 'Positive model spectrum' });
  fig.setView({ xScale: 'log', yScale: 'log', xLabel: 'Frequency (Hz)', yLabel: 'Relative power' });
}

function phase(fig) {
  const t = range(0, 2 * Math.PI, 12000), y = t.map(v => Math.sin(4 * v));
  const xFor = value => t.map(v => Math.sin(3 * v + value));
  const layer = fig.plot(xFor(1.1), y, { color: '#8560ad', width: 1.7, label: 'x = sin(3t + φ), y = sin(4t)' });
  fig.setView({ xDomain: [-1.12, 1.12], yDomain: [-1.12, 1.12], xLabel: 'x(t)', yLabel: 'y(t)' });
  return { update(value) { layer.setData({ x: xFor(Number(value)) }); } };
}

function surface(fig) {
  const axis = range(-5, 5, 121);
  const z = Float64Array.from({ length: axis.length ** 2 }, (_, i) => {
    const r = Math.hypot(axis[i % axis.length], axis[Math.floor(i / axis.length)]);
    return (r === 0 ? 1 : Math.sin(2.8 * r) / (2.8 * r)) * Math.exp(-0.06 * r * r);
  });
  fig.surface(axis, axis, z, { colormap: 'viridis' });
  fig.setView({ xLabel: 'x', yLabel: 'y', zLabel: 'Damped sinc(r)' });
}

function scatter3d(fig) {
  const t = range(0, 2 * Math.PI, 14000);
  const x = t.map(v => (2 + 0.65 * Math.cos(3 * v)) * Math.cos(2 * v));
  const y = t.map(v => (2 + 0.65 * Math.cos(3 * v)) * Math.sin(2 * v));
  const z = t.map(v => 0.65 * Math.sin(3 * v));
  fig.scatter3d(x, y, z, { values: t, size: 3, colormap: 'viridis' });
  fig.setView({ xLabel: 'x(t)', yLabel: 'y(t)', zLabel: 'z(t)' });
}

function lorenz(fig) {
  const initial = lorenzData(28);
  const layer = fig.scatter3d(initial.x, initial.y, initial.z, { values: initial.z, size: 2, colormap: 'magma', colorDomain: [0, 65] });
  fig.setView({ xLabel: 'x', yLabel: 'y', zLabel: 'z' });
  return { update(value) { const data = lorenzData(Number(value)); layer.setData({ ...data, color: data.z }); } };
}

function interference(fig) {
  const axis = range(-6, 6, 141);
  const layer = fig.surface(axis, axis, twoSourceGrid(axis, 0), { colormap: 'magma', colorDomain: [-2, 2] });
  fig.setView({ xLabel: 'x (relative units)', yLabel: 'y (relative units)', zLabel: 'Displacement', zDomain: [-2, 2] });
  return { update(value) { layer.setData({ z: twoSourceGrid(axis, Number(value)) }); } };
}

function peaks(fig) {
  const axis = range(-3, 3, 151);
  const z = Float64Array.from({ length: axis.length ** 2 }, (_, i) => peakField(axis[i % axis.length], axis[Math.floor(i / axis.length)]));
  fig.surface(axis, axis, z, { colormap: 'viridis' });
  fig.setView({ xLabel: 'x', yLabel: 'y', zLabel: 'f(x, y)' });
}

function javascript(create, helpers = [], controlled = false) {
  return 'import { figure } from "@vesora/core";\n\n// HTML: <div id="chart"></div>\n\n'
    + helpers.map(helper => helper.toString()).join('\n\n') + (helpers.length ? '\n\n' : '')
    + create.toString() + '\n\nconst fig = figure();\n'
    + (controlled ? `const control = ${create.name}(fig);\n// To update: control.update(newValue);\n` : `${create.name}(fig);\n`)
    + 'fig.mount(document.querySelector("#chart"));';
}

const pythonGaussian = `def gaussian(count, seed=42):
    x, y = [], []
    def random_unit():
        nonlocal seed
        seed = (1664525 * seed + 1013904223) & 0xffffffff
        return (seed + 1) / 4294967297
    for _ in range(count):
        radius = math.sqrt(-2 * math.log(random_unit()))
        angle = 2 * math.pi * random_unit()
        x.append(radius * math.cos(angle))
        y.append(radius * math.sin(angle))
    return x, y
`;

const pythonWaves = `def wave_grid(axis, phase, intensity=False):
    rows = []
    for y in axis:
        row = []
        for x in axis:
            r1, r2 = math.hypot(x + 1.6, y), math.hypot(x - 1.6, y)
            a, b = 1 / math.sqrt(1 + r1), 1 / math.sqrt(1 + r2)
            # Idealized model: dimensionless amplitudes, finite at each source.
            value = (a*a + b*b + 2*a*b*math.cos(5*(r1-r2)-phase)
                     if intensity else a*math.cos(5*r1) + b*math.cos(5*r2+phase))
            row.append(value)
        rows.append(row)
    return rows
`;

const pythonLorenz = `def lorenz(rho=28, count=25000):
    dt, warmup = 0.005, 2000
    x, y, z = [], [], []
    a, b, c = 0.1, 0., 0.
    def derivative(a, b, c):
        return (10*(b-a), a*(rho-c)-b, a*b-(8/3)*c)
    for i in range(count + warmup):
        k1 = derivative(a, b, c)
        k2 = derivative(a+dt*k1[0]/2, b+dt*k1[1]/2, c+dt*k1[2]/2)
        k3 = derivative(a+dt*k2[0]/2, b+dt*k2[1]/2, c+dt*k2[2]/2)
        k4 = derivative(a+dt*k3[0], b+dt*k3[1], c+dt*k3[2])
        a += dt*(k1[0]+2*k2[0]+2*k3[0]+k4[0])/6
        b += dt*(k1[1]+2*k2[1]+2*k3[1]+k4[1])/6
        c += dt*(k1[2]+2*k2[2]+2*k3[2]+k4[2])/6
        if i >= warmup:
            x.append(a); y.append(b); z.append(c)
    return x, y, z
`;

const python = body => 'import math\nimport vesora as vs\n\n' + body.trim() + '\n\nvs.show()';

export const examples = [
  ...benchmarkExamples,
  {
    id: 'signal', dimension: '2d', title: 'Hidden detail in a signal', type: 'LINE / TIME SERIES',
    description: '120,000 samples · Two frequencies, narrow spikes, and a missing-data interval.',
    tags: ['120k samples', 'Min / max', 'NaN gap'],
    insight: 'Narrow spikes at 4.25 and 16.6 seconds survive reduction; the missing interval remains a gap.',
    create: signal, javascript: javascript(signal, [range]),
    python: python(`fig = vs.figure()
x = [i * 24 / 119999 for i in range(120000)]
baseline, y = [], []
for t in x:
    base = math.sin(2*math.pi*0.6*t)
    value = (base + 0.18*math.sin(2*math.pi*13*t)
             + 2.4*math.exp(-((t-4.25)/0.0035)**2)
             - 2.2*math.exp(-((t-16.6)/0.0045)**2))
    gap = 10.4 < t < 11.3
    baseline.append(math.nan if gap else base)
    y.append(math.nan if gap else value)
fig.plot(x, y, color="#137f8b", width=1.3, label="Signal model")
fig.plot(x, baseline, color="#d48c43", width=1.5, label="0.6 Hz component")
fig.set_axes(xlabel="Time (s)", ylabel="Amplitude")`),
  },
  {
    id: 'scatter', dimension: '2d', title: 'Uncertainty varies', type: 'SCATTER / VARYING VARIANCE',
    description: '6,000 observations · Noise grows with |x| around a nonlinear mean.',
    tags: ['6k observations', 'Scalar colors', 'σ(x)'],
    insight: 'Color encodes the noise standard deviation; the points spread out toward the extremes.',
    create: scatter, javascript: javascript(scatter, [range, gaussian]),
    python: python(`${pythonGaussian}
fig = vs.figure()
x, noise = gaussian(6000, 17)
x = [1.2*v for v in x]
sigma = [0.12 + 0.2*abs(v) for v in x]
y = [0.45*v + 0.1*v*v + sigma[i]*noise[i] for i, v in enumerate(x)]
fig.scatter(x, y, color=sigma, size=3, opacity=0.6,
            representation="points", colormap="viridis")
trend = [-4.5 + 9*i/299 for i in range(300)]
fig.plot(trend, [0.45*v + 0.1*v*v for v in trend],
         color="#b85c4a", width=2, label="Conditional mean")
fig.set_axes(xlabel="Input x", ylabel="Response y")`),
  },
  {
    id: 'density', dimension: '2d', title: 'Three clusters, one million points', type: 'DENSITY / ADAPTIVE EXPLORATION',
    description: '1,000,000 records · A 50% / 30% / 20% mixture with different cluster spreads.',
    tags: ['1 million records', 'Count aggregation', 'Bookmarks', 'Offline sharing'],
    insight: 'Follow three saved views, then download HTML to share the same interactive exploration offline.',
    create: density, javascript: javascript(density, [gaussian]) + '\n\n// Optional: save a self-contained interactive figure.\n// import { downloadHTML } from "@vesora/core";\n// downloadHTML(fig, "three-clusters.html");',
    python: python(`${pythonGaussian}
fig = vs.figure()
x, y = gaussian(1000000, 42)
for i in range(len(x)):
    a, b, group = x[i], y[i], i % 10
    if group < 5:
        x[i], y[i] = -1.8 + 0.65*a, -0.8 + 0.35*a + 0.4*b
    elif group < 8:
        x[i], y[i] = 1.5 + 0.45*a, -0.65 - 0.25*a + 0.6*b
    else:
        x[i], y[i] = 0.65*a, 1.65 + 0.35*b
fig.scatter(x, y, color="#137f8b", size=3,
            representation="auto", colormap="viridis")
fig.set_axes(xlabel="x", ylabel="y")
fig.bookmark("Overview", note="Zoomed out, color reports the number of samples in each bin.")
fig.set_axes(xlim=(-3.5, 0), ylim=(-2, 0.6))
fig.bookmark("Separate clusters", note="Inspect the left-hand cluster without changing the source data.")
fig.set_axes(xlim=(-1.81, -1.79), ylim=(-0.81, -0.79))
fig.bookmark("Individual samples", note="At this scale, the renderer shows individual samples.")
fig.restore_bookmark("Overview")
# Optional: save a self-contained interactive figure.
# fig.save_html("three-clusters.html")`),
  },
  {
    id: 'heatmap', dimension: '2d', title: 'Tracing interference', type: 'HEATMAP / WAVE INTENSITY',
    description: '181 × 181 grid · Two coherent sources, φ = π/3; an idealized dimensionless model.',
    tags: ['32,761 cells', 'Interference', 'Relative intensity'],
    insight: 'Bright and dark bands show where the waves reinforce or cancel one another.',
    create: heatmap, javascript: javascript(heatmap, [range, twoSourceGrid]),
    python: python(`${pythonWaves}
fig = vs.figure()
axis = [-6 + 12*i/180 for i in range(181)]
z = wave_grid(axis, math.pi/3, intensity=True)
fig.heatmap(axis, axis, z, colormap="magma", color_domain=(0, 2.5))
fig.set_axes(xlabel="x (relative units)", ylabel="y (relative units)")`),
  },
  {
    id: 'precision', dimension: '2d', title: 'Large coordinates, small differences', type: 'FLOAT64 / PRECISE COORDINATES',
    description: '2,048 samples · Coordinates near 10¹² with a nominal sampling step of 0.00025.',
    tags: ['Float64', 'Local projection', 'Δx ≪ x'],
    insight: 'Source values are projected into local coordinates before reaching the GPU, preserving small differences.',
    create: precision, javascript: javascript(precision),
    python: python(`fig = vs.figure()
origin = 1e12
x = [origin + i*0.00025 for i in range(2048)]
y = [0.6*math.sin(2*math.pi*8*(v-origin))
     + 0.15*math.sin(2*math.pi*80*(v-origin)) for v in x]
fig.plot(x, y, color="#8560ad", width=1.7, label="Float64 source")
fig.set_axes(xlabel="x ≈ 10¹² (target Δx = 0.00025)", ylabel="Amplitude")`),
  },
  {
    id: 'spectrum', dimension: '2d', title: 'Resonance across four decades', type: 'LOG–LOG / MODEL SPECTRUM',
    description: '8,000 frequency samples · Three Lorentzian peaks above a positive baseline.',
    tags: ['Log x / log y', '0.1–1,000 Hz', 'Three resonances'],
    insight: 'Logarithmic axes reveal narrow resonances and the low-power baseline in the same view.',
    create: spectrum, javascript: javascript(spectrum),
    python: python(`fig = vs.figure()
f = [10**(-1 + 4*i/7999) for i in range(8000)]
y = [0.002 + 0.1/(1+(v/2)**2)
     + 4/(1+((v-3.4)/0.04)**2)
     + 1.8/(1+((v-24.5)/0.35)**2)
     + 0.75/(1+((v-210)/2.2)**2) for v in f]
fig.plot(f, y, color="#bc8040", width=1.8, label="Positive model spectrum")
fig.set_axes(xscale="log", yscale="log", xlabel="Frequency (Hz)", ylabel="Relative power")`),
  },
  {
    id: 'phase', dimension: '2d', title: 'Change the phase, watch the curve', type: 'PARAMETRIC / LISSAJOUS',
    description: '12,000 samples · x = sin(3t + φ), y = sin(4t); updates reuse the existing layer.',
    tags: ['Phase control', '3:4 frequency ratio', 'Data updates'],
    insight: 'Both frequencies stay fixed as the phase changes, shifting the crossings and symmetry of the curve.',
    control: { label: 'Phase φ', min: 0, max: 6.28, step: 0.05, value: 1.1, unit: 'rad' },
    create: phase, javascript: javascript(phase, [range], true),
    python: python(`fig = vs.figure()
phase = 1.1  # Radians; change this value and recompute.
t = [2*math.pi*i/11999 for i in range(12000)]
x = [math.sin(3*v + phase) for v in t]
y = [math.sin(4*v) for v in t]
layer = fig.plot(x, y, color="#8560ad", width=1.7,
                 label="x = sin(3t + φ), y = sin(4t)")
fig.set_axes(xlim=(-1.12, 1.12), ylim=(-1.12, 1.12), xlabel="x(t)", ylabel="y(t)")
# To update an open chart: layer.set_data(x=new_x)`),
  },
  {
    id: 'surface', dimension: '3d', title: 'Geometry from the center', type: 'SURFACE / RADIAL MODEL',
    description: '121 × 121 grid · exp(−0.06r²) sin(2.8r)/(2.8r), with a central limit of 1.',
    tags: ['28,800 triangles', 'Radial symmetry', 'Camera controls'],
    insight: 'Rotate the camera to inspect the central peak and the rings that fade with distance.',
    create: surface, javascript: javascript(surface, [range]),
    python: python(`fig = vs.figure()
axis = [-5 + 10*i/120 for i in range(121)]
def radial(x, y):
    r = math.hypot(x, y)
    return (1 if r == 0 else math.sin(2.8*r)/(2.8*r))*math.exp(-0.06*r*r)
z = [[radial(x, y) for x in axis] for y in axis]
fig.surface(axis, axis, z, colormap="viridis")
fig.set_axes(xlabel="x", ylabel="y", zlabel="Damped sinc(r)")`),
  },
  {
    id: 'scatter3d', dimension: '3d', title: 'Around a torus knot', type: '3D SCATTER / TORUS KNOT',
    description: '14,000 points · A (2, 3) torus knot; color follows the parameter t.',
    tags: ['14k points', 'Parametric model', 't → color'],
    insight: 'Change the viewing angle to separate strands that overlap in projection.',
    create: scatter3d, javascript: javascript(scatter3d, [range]),
    python: python(`fig = vs.figure()
t = [2*math.pi*i/13999 for i in range(14000)]
x = [(2 + 0.65*math.cos(3*v))*math.cos(2*v) for v in t]
y = [(2 + 0.65*math.cos(3*v))*math.sin(2*v) for v in t]
z = [0.65*math.sin(3*v) for v in t]
fig.scatter3d(x, y, z, color=t, size=3, colormap="viridis")
fig.set_axes(xlabel="x(t)", ylabel="y(t)", zlabel="z(t)")`),
  },
  {
    id: 'lorenz', dimension: '3d', title: 'Between order and chaos', type: '3D SCATTER / LORENZ SYSTEM',
    description: '25,000 steps · RK4, Δt = 0.005; the first 2,000 warm-up steps are omitted.',
    tags: ['RK4 integration', 'σ = 10, β = 8/3', 'ρ control'],
    insight: 'Changing ρ changes the trajectory; color encodes z. This is a numerical approximation with a fixed integration step.',
    control: { label: 'Rayleigh parameter ρ', min: 20, max: 40, step: 0.5, value: 28 },
    create: lorenz, javascript: javascript(lorenz, [lorenzData], true),
    python: python(`${pythonLorenz}
fig = vs.figure()
x, y, z = lorenz(rho=28)
fig.scatter3d(x, y, z, color=z, size=2, colormap="magma", color_domain=(0, 65))
fig.set_axes(xlabel="x", ylabel="y", zlabel="z")`),
  },
  {
    id: 'interference', dimension: '3d', title: 'Two sources, one wave field', type: 'SURFACE / PHASE INTERACTION',
    description: '141 × 141 grid · Instantaneous displacement from two idealized point sources.',
    tags: ['39,200 triangles', 'Phase control', 'Fixed color range'],
    insight: 'Shift the phase of one source; reinforcing and cancelling regions move while the color scale stays fixed.',
    control: { label: 'Source phase φ', min: 0, max: 6.28, step: 0.05, value: 0, unit: 'rad' },
    create: interference, javascript: javascript(interference, [range, twoSourceGrid], true),
    python: python(`${pythonWaves}
fig = vs.figure()
axis = [-6 + 12*i/140 for i in range(141)]
phase = 0  # Radians.
z = wave_grid(axis, phase)
fig.surface(axis, axis, z, colormap="magma", color_domain=(-2, 2))
fig.set_axes(xlabel="x (relative units)", ylabel="y (relative units)",
             zlabel="Displacement", zlim=(-2, 2))`),
  },
  {
    id: 'peaks', dimension: '3d', title: 'Peaks, valleys, and a saddle', type: 'SURFACE / GAUSSIANS + SADDLE',
    description: '151 × 151 grid · Two positive Gaussian peaks, a valley, and a damped saddle term.',
    tags: ['45,000 triangles', 'Local extrema', 'Signed scalar field'],
    insight: 'Change the viewing angle to distinguish peaks, the valley, and the transitions between them.',
    create: peaks, javascript: javascript(peaks, [range, peakField]),
    python: python(`fig = vs.figure()
axis = [-3 + 6*i/150 for i in range(151)]
def field(x, y):
    return (3*math.exp(-((x-1.2)**2/0.45 + (y-0.7)**2/0.7))
            - 2.2*math.exp(-((x+1.1)**2/0.7 + (y+0.4)**2/0.45))
            + 2*math.exp(-((x+0.5)**2/0.35 + (y-1.45)**2/0.5))
            + 0.25*x*y*math.exp(-0.15*(x*x+y*y)))
z = [[field(x, y) for x in axis] for y in axis]
fig.surface(axis, axis, z, colormap="viridis")
fig.set_axes(xlabel="x", ylabel="y", zlabel="f(x, y)")`),
  },
];
