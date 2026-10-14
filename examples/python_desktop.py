"""Run the NumPy-free desktop example: python examples/python_desktop.py."""
import math
import vesora as vs

x = [i * 12 / 3_999 for i in range(4_000)]
y = [math.exp(-t / 5) * math.sin(4 * t) for t in x]
fig = vs.figure(title="Damped oscillation")
# Synthetic illustrative bounds; no uncertainty estimate is inferred from samples.
fig.fill_between(x, [v - .08 for v in y], [v + .08 for v in y],
                 color="cyan", opacity=.18, label="Illustrative ±0.08 bounds")
vs.plot(x, y, color="cyan", label="model")
vs.scatter(x[::100], y[::100], color="orange", size=5, label="samples")
fig.set_axes(xlabel="Time (s)", ylabel="Amplitude")
fig.set_hover_mode("x")
fig.show()
# Closing the desktop window preserves the figure for later export or display.
fig.savefig("oscillation.png", width=1000, height=625, scale=2)
fig.close()
