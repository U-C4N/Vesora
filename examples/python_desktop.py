"""Run after building/installing Vesora: python examples/python_desktop.py."""
import math
import vesora as vs

x = [i * 12 / 3_999 for i in range(4_000)]
y = [math.exp(-t / 5) * math.sin(4 * t) for t in x]
fig = vs.figure(title="Damped oscillation")
vs.plot(x, y, color="cyan", label="model")
vs.scatter(x[::100], y[::100], color="orange", size=5, label="samples")
fig.set_axes(xlabel="Time (s)", ylabel="Amplitude")
fig.show()
# Closing the desktop window preserves the figure so it can be exported/reopened.
fig.savefig("oscillation.png")
fig.close()
