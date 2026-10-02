"""Plot a regular-grid surface using the standard library and Vesora's shared engine."""
import math
import vesora as vs

x = [-6 + i * 12 / 119 for i in range(120)]
y = [-6 + i * 12 / 119 for i in range(120)]


def amplitude(x_value, y_value):
    radius = math.hypot(x_value, y_value)
    return math.sin(radius) / radius if radius else 1.0


z = [[amplitude(x_value, y_value) for x_value in x] for y_value in y]
fig = vs.figure(title="sin(r) / r")
fig.surface(x, y, z, colormap="viridis")
fig.set_axes(xlabel="x", ylabel="y", zlabel="Amplitude")
fig.show()
fig.close()
