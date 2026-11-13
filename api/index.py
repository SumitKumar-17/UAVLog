"""Vercel entry point for the FastAPI service (read-only deployment: set ALLOW_WRITES=0). Vercel serves the ASGI object named `app`."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app.api.main import app  # noqa: E402,F401
