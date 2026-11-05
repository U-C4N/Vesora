"""Synthetic all-ten-family gallery; no Qt window is needed to export HTML."""
from pathlib import Path
import sys
import vesora as vs


def make_figure():
    fig = vs.subplots(5, 2, width=1200, height=1800, title="Vesora 1.0 — ten analysis families")
    def panel(index):
        return fig.panel(index // 2, index % 2)
    panel(0).set_title("Empirical distribution").ecdf([2, 1, 2, 4, 7], label="ECDF", color="#3569c8")
    panel(0).ccdf([2, 1, 2, 4, 7], label="CCDF", color="#d36a55")
    panel(1).set_title("Supplied time × frequency").spectrogram([0, 1, 2], [10, 20, 30], [[1, 2, 1], [2, 5, 2], [1, 3, 4]], max_rows=16)
    panel(2).set_title("Events").event_timeline([{"start": 0, "end": 2, "lane": "Device A", "label": "Acquire", "id": "a"}, {"start": 1, "end": 3, "lane": "Device B", "label": "Acquire", "id": "b"}, {"start": 2, "lane": "Device A", "label": "Checkpoint", "id": "c"}])
    panel(3).set_title("Supplied measurement bounds").errorbar([0, 1, 2], [2, 3, 2], y_lower=[1.5, 2.8, 1.7], y_upper=[2.4, 3.5, 2.3])
    field = [[0, 1, 0], [1, 3, 1], [0, 1, 0]]
    panel(4).set_title("Scalar contours").contourf([0, 1, 2], [0, 1, 2], field, levels=[0.5, 1.5, 2.5])
    panel(4).contour([0, 1, 2], [0, 1, 2], field, levels=[0.5, 1.5, 2.5], color="#24323a")
    panel(5).set_title("Vector field").quiver([0, 1, 0, 1], [0, 0, 1, 1], [1, 0.5, -0.5, -1], [0.5, 1, 1, 0.5])
    panel(6).set_title("Alternatives").parallel_coordinates({"temperature": [10, 20, 15], "pressure": [2, 5, 3], "cost": [8, 4, 6]}, axes=[{"key": "temperature"}, {"key": "pressure"}, {"key": "cost"}])
    panel(7).set_title("Minimize both objectives").pareto_front([1, 2, 3, 4], [4, 2, 3, 1], objectives=["min", "min"], show_all=True)
    panel(8).set_title("Ordered trajectory").phase_portrait([0, 1, 0, -1, 0], [1, 0, -1, 0, 1], time=[0, 1, 2, 3, 4], direction=True)
    panel(9).set_title("Composition, total = 1").ternary([0.6, 0.2, 0.3], [0.2, 0.6, 0.3], [0.2, 0.2, 0.4], sum=1, labels=["A", "B", "C"])
    return fig


def write_example(output="artifacts/skill-examples/vesora-analysis-python.html"):
    fig = make_figure()
    try:
        assert fig.snapshot()["figure"]["protocolVersion"] == 9
        target = Path(output).resolve()
        target.parent.mkdir(parents=True, exist_ok=True)
        fig.save_html(target, observation=True)
        return target
    finally:
        fig.close()


if __name__ == "__main__":
    print(write_example(sys.argv[1] if len(sys.argv) > 1 else "artifacts/skill-examples/vesora-analysis-python.html"))
