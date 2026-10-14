"""Opt-in real Qt protocol-6 rendering and explicit export transport."""
import json
import os
import struct

import pytest

import vesora as vs


pytestmark = pytest.mark.skipif(os.environ.get("VESORA_TEST_QT") != "1",
                              reason="Set VESORA_TEST_QT=1 to run the real hidden Qt viewer")


def test_real_qt_band_updates_and_scaled_exports_preserve_live_figure(tmp_path):
    pytest.importorskip("PySide6")
    from PySide6.QtGui import QImage
    from test_linked_desktop import javascript

    fig = vs.figure(title="Real Qt interval", width=800, height=520,
                    theme={"titleFontSize": 20, "tickFontSize": 14, "labelFontSize": 16, "legendFontSize": 14})
    band = fig.fill_between([0, 1, 2, 3, 4], [1] * 5, [3] * 5, color="#ef4444", opacity=.3)
    fig.plot([0, 1, 2, 3, 4], [2] * 5, color="#3569c8", label="Source samples")
    fig.set_axes(xlim=(0, 4), ylim=(0, 5), xlabel="Step", ylabel="Value")
    fig.set_hover_mode("x")
    original = fig.snapshot()
    try:
        first = None
        for scale in (2, 4):
            output = fig.savefig(tmp_path / f"quality-scale-{scale}.png", width=800, height=500, scale=scale, timeout=45)
            payload = output.read_bytes()
            assert payload.startswith(b"\x89PNG\r\n\x1a\n")
            assert struct.unpack(">II", payload[16:24]) == (800 * scale, 500 * scale)
            assert fig.snapshot() == original, "Explicit export must preserve the Python scene"
            image = QImage(str(output)).convertToFormat(QImage.Format.Format_RGBA8888)
            pixels = memoryview(image.constBits()).cast("B")
            red_pixels = sum(1 for i in range(0, len(pixels), 4)
                             if pixels[i] > 230 and 150 < pixels[i + 1] < 230
                             and pixels[i] - pixels[i + 1] > 20 and abs(pixels[i + 1] - pixels[i + 2]) < 5)
            assert red_pixels > 5000, "The translucent interval must contribute visible pixels"
            if scale == 2:
                first = payload
        page = fig._window._vesora_view.page()
        browser_scene = json.loads(javascript(page, "JSON.stringify(window.vesoraFigure.snapshot().figure)"))
        assert browser_scene == original["figure"], "Sized exports must preserve the live browser scene"
        assert browser_scene["hoverMode"] == "x" and browser_scene["protocolVersion"] == 6
        band.set_data(upper=[4] * 5)
        updated = fig.savefig(tmp_path / "quality-updated.png", width=800, height=500, scale=2, timeout=45)
        assert updated.read_bytes() != first
        before_invalid = fig.snapshot()
        with pytest.raises(ValueError, match="pixel limit"):
            fig.savefig(tmp_path / "quality-oversized.png", width=800, height=500, scale=100)
        assert fig.snapshot() == before_invalid
        assert not (tmp_path / "quality-oversized.png").exists()
    finally:
        fig.close()
        vs.process_events()
