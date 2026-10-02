"""Opt-in GPU/Qt integration test: set VESORA_TEST_QT=1 on a desktop-capable host."""
import os
import struct
import time
from math import cos, sin

import pytest

import vesora as vs

pytestmark = pytest.mark.skipif(os.environ.get("VESORA_TEST_QT") != "1", reason="Set VESORA_TEST_QT=1 to run the real hidden Qt viewer")


@pytest.mark.parametrize("kind", ["line", "heatmap", "surface", "scatter3d"])
def test_shared_engine_hidden_qt_png_and_window_reopen(tmp_path, kind):
    pytest.importorskip("PySide6")
    fig = vs.Figure(title=f"Python {kind} integration")
    x = [-3 + 6 * i / 39 for i in range(40)]
    if kind == "line":
        layer = fig.plot(x, [sin(value) for value in x])
    elif kind == "heatmap":
        fig.heatmap(x, x, [[sin(y) * cos(value) for value in x] for y in x])
    elif kind == "surface":
        fig.surface(x, x, [[sin(y) * cos(value) for value in x] for y in x])
    else:
        fig.scatter3d(x, [sin(value) for value in x], [cos(value) for value in x])
    try:
        first = fig.savefig(tmp_path / f"{kind}.png")
        payload = first.read_bytes()
        assert payload[:8] == b"\x89PNG\r\n\x1a\n"
        width, height = struct.unpack(">II", payload[16:24])
        assert width >= 800 and height >= 520 and len(payload) > 1000
        if kind == "line":
            layer.set_data(y=[cos(value) for value in x])
            second = fig.savefig(tmp_path / "updated.png")
            assert second.read_bytes() != payload
            fig._window.close()
            vs.process_events()
            assert not fig._closed and fig._window is None
            assert len(fig.snapshot()["sources"]) == 2
            fig.savefig(tmp_path / "reopened.png")
    finally:
        fig.close()
        vs.process_events()


def test_immediate_scatter_update_moves_exported_pixels_and_render_errors_fail(tmp_path):
    from PySide6.QtGui import QImage

    def cyan_centroid(path):
        image = QImage(str(path)).convertToFormat(QImage.Format.Format_RGBA8888)
        pixels = memoryview(image.constBits()).cast("B")
        count = col_sum = row_sum = 0
        for row in range(image.height()):
            start = row * image.bytesPerLine()
            for col in range(image.width()):
                offset = start + col * 4
                if pixels[offset] < 100 and pixels[offset + 1] > 120 and pixels[offset + 2] > 180:
                    count += 1
                    col_sum += col
                    row_sum += row
        assert count > 100, "The exported PNG must contain the rendered points"
        return col_sum / count, row_sum / count, image.width(), image.height()

    fig = vs.Figure()
    layer = fig.scatter([.2, .3], [.2, .3], size=18, color="#38bdf8")
    fig.set_axes(xlim=(0, 1), ylim=(0, 1))
    try:
        before = cyan_centroid(fig.savefig(tmp_path / "points-before.png"))
        layer.set_data([.7, .8], [.7, .8])
        after = cyan_centroid(fig.savefig(tmp_path / "points-after.png"))
        assert after[0] - before[0] > before[2] * .25
        assert before[1] - after[1] > before[3] * .25
        # Fault injection at the transport boundary verifies render failures never
        # fall back to exporting the previous successful image.
        fig._spec["layers"][0]["style"]["color"] = "invalid-color"
        fig._publish()
        started = time.monotonic()
        with pytest.raises(RuntimeError, match="Colors"):
            fig.savefig(tmp_path / "must-not-export.png", timeout=20)
        assert time.monotonic() - started < 5
        assert not (tmp_path / "must-not-export.png").exists()
    finally:
        fig.close()
        vs.process_events()
