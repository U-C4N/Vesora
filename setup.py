"""Prevent packaging a Python facade without its required shared JS engine."""
from pathlib import Path

def check_engine_assets(root: Path | None = None) -> None:
    root = Path(__file__).parent if root is None else root
    assets = root / "python" / "vesora" / "_assets"
    required = ("index.js", "worker.js", "notebook.js", "host.js", "viewer.html")
    missing = [name for name in required if not (assets / name).is_file() or (assets / name).stat().st_size == 0]
    if missing:
        raise RuntimeError(
            "Vesora shared-engine assets are missing or empty: " + ", ".join(missing)
            + ". Run `npm ci` and `npm run build` from the repository root before building or installing the Python package."
        )


if __name__ == "__main__":
    from setuptools import setup
    check_engine_assets()
    setup()
