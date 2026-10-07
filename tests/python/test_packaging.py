from pathlib import Path
import runpy

import pytest


@pytest.mark.parametrize("empty_asset", ["worker.js", "standalone.html"])
def test_packaging_requires_all_engine_assets(tmp_path, empty_asset):
    check = runpy.run_path(str(Path(__file__).parents[2] / "setup.py"))["check_engine_assets"]
    with pytest.raises(RuntimeError, match="npm run build"):
        check(tmp_path)
    assets = tmp_path / "python" / "vesora" / "_assets"
    assets.mkdir(parents=True)
    for name in ("index.js", "worker.js", "notebook.js", "host.js", "viewer.html", "standalone.html"):
        (assets / name).write_text("bundled asset", encoding="utf-8")
    check(tmp_path)
    (assets / empty_asset).write_bytes(b"")
    with pytest.raises(RuntimeError, match=empty_asset):
        check(tmp_path)
