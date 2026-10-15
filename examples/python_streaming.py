"""Bounded synthetic telemetry. Run after installing or building Vesora."""
import math
import time
import vesora as vs

fig = vs.figure(title="Synthetic training telemetry", width=1100, height=600)
layers = [fig.plot([], [], label=f"Model {chr(65 + i)}", color=color)
          .enable_streaming(max_points=2000)
          for i, color in enumerate(["#3569c8", "#137f8b", "#d36a55"])]
fig.set_axes(xlabel="Training step", ylabel="Synthetic loss")
fig.set_hover_mode("x")
fig.show(block=False)
try:
    for start in range(0, 20_000, 100):
        x = list(range(start, start + 100))
        for i, layer in enumerate(layers):
            y = [(i + 1) * .15 + 3 * math.exp(-t / 2000) + .08 * math.sin(t * .07 + i) for t in x]
            layer.append_data(x=x, y=y)
        vs.process_events()
        time.sleep(.05)
    fig.save_html("telemetry-snapshot.html")
    fig.savefig("telemetry.png", width=1100, height=600, scale=2)
finally:
    fig.close()
