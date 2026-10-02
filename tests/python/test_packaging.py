from pathlib import Path
import runpy

import pytest


def test_packaging_requires_all_engine_assets(tmp_path):
    check = runpy.run_path(str(Path(__file__).parents[2] / "setup.py"))["check_engine_assets"]
    with pytest.raises(RuntimeError, match="npm run build"):
        check(tmp_path)
    assets = tmp_path / "python" / "vesora" / "_assets"
    assets.mkdir(parents=True)
    for name in ("index.js", "worker.js", "notebook.js", "host.js", "viewer.html"):
        (assets / name).write_text("bundled asset", encoding="utf-8")
    check(tmp_path)
    (assets / "worker.js").write_bytes(b"")
    with pytest.raises(RuntimeError, match="worker.js"):
        check(tmp_path)
