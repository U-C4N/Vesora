# Python

```python
import vesora as vs

fig = vs.figure(title="Request latency")
latency = fig.ecdf([12, 14, 14, 28, 90], label="Latency")
latency.set_semantics({"samples": {"quantity": "duration", "unit": "ms"}})
fig.set_axes(xlabel="Latency (ms)", ylabel="Fraction at or below")
fig.save_html("latency.html", observation=True)
fig.show()  # Notebook widget or Qt desktop according to the host.
```

Python uses `event_timeline`, `parallel_coordinates`, `pareto_front`, `phase_portrait`, `contourf`, `errorbar`, `spectrogram`, `ternary`, `ecdf`, and `ccdf`. Options include `y_lower`, `y_upper`, `max_rows`, `value_scale`, `db_reference`, `show_all`, and `cap_size`. Spectrogram updates use `layer.append_rows(time, values)`.

Lists work directly; optional NumPy arrays avoid conversion work in applications that already use NumPy. Do not add NumPy or SciPy just to plot a supplied list/matrix. Computing FFT/STFT is a separate explicit analysis step; preserve its window, sampling rate, scaling and units when displaying the result.

Notebook PNG export must let comm messages run: display the figure, then `await fig.savefig_async("figure.png")`. Qt uses `fig.savefig("figure.png")`. `save_html` does not require a running Qt window and embeds retained data. Close the figure after the application or notebook is done with it.

Run `python skills/vesora/scripts/example_python.py` from a checkout to validate all ten family constructors and write a portable HTML. The example does not start a desktop window unless requested.
