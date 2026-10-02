"""Regenerate README figures with Vesora's packaged engine, without NumPy.

Run `npm run build`, install Vesora, then `python scripts/render_readme.py`.
A working QtWebEngine graphics environment is required, just as for savefig().
"""
from array import array
import math
from pathlib import Path
import random

import vesora as vs

OUT = Path(__file__).resolve().parents[1] / "docs" / "assets"


def export(fig, name):
    try:
        path = fig.savefig(OUT / f"{name}.png")
        print(f"Rendered {path.name}: {path.stat().st_size:,} bytes", flush=True)
    finally:
        fig.close()
        vs.process_events()


def training():
    fig = vs.figure(title="Training loss · synthetic models", width=760, height=500)
    steps = [i * 100 for i in range(201)]
    for label, color, rate, floor in (
        ("Model A", "#3569c8", 3500, 0.24),
        ("Model B", "#d36a55", 5400, 0.16),
        ("Model C", "#188781", 2300, 0.36),
    ):
        loss = [(3.6 * math.exp(-step / rate) + floor)
                * (1 + 0.022 * math.sin(step / 190)) for step in steps]
        fig.plot(steps, loss, color=color, width=2.5, label=label)
    fig.set_axes(xlabel="Training step", ylabel="Loss (lower is better)", yscale="log")
    export(fig, "training-loss")


def density():
    rng = random.Random(42)
    x, y = array("d"), array("d")
    centers = [(-2.4, -0.6), (0.8, 1.5), (2.8, -1.6)]
    for i in range(1_000_000):
        cx, cy = centers[i % len(centers)]
        a, b = rng.gauss(0, 0.85), rng.gauss(0, 0.38)
        x.append(cx + a)
        y.append(cy + b + 0.4 * a)
    fig = vs.figure(title="1,000,000 samples · count aggregation", width=760, height=500)
    fig.scatter(x, y, representation="auto", colormap="magma", size=2)
    fig.set_axes(xlabel="x", ylabel="y", xlim=(-6, 6), ylim=(-4, 4))
    export(fig, "density")


def surface():
    axis = [-6 + 12 * i / 139 for i in range(140)]
    z = [[math.sin(math.hypot(x + 1.6, y)) * math.cos(0.65 * y)
          * math.exp(-0.035 * (x*x + y*y)) for x in axis] for y in axis]
    fig = vs.figure(title="Wave interference · regular-grid surface", width=760, height=500)
    fig.surface(axis, axis, z, colormap="viridis")
    fig.set_axes(xlabel="x", ylabel="y", zlabel="Amplitude")
    export(fig, "surface")


def lorenz():
    x, y, z = [], [], []
    a, b, c = 0.1, 0.0, 0.0
    for i in range(20_000):
        da, db, dc = 10 * (b - a), a * (28 - c) - b, a * b - 8 * c / 3
        a, b, c = a + 0.006 * da, b + 0.006 * db, c + 0.006 * dc
        if i >= 1000:
            x.append(a)
            y.append(b)
            z.append(c)
    fig = vs.figure(title="Lorenz attractor · 3D trajectory samples", width=760, height=500)
    fig.scatter3d(x, y, z, values=z, colormap="viridis", size=2)
    fig.set_axes(xlabel="x", ylabel="y", zlabel="z")
    export(fig, "lorenz")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for render in (training, density, surface, lorenz):
        render()
