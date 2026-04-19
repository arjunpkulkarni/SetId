"""Pytest defaults so importing `app.main` never trips production boot guards."""

from __future__ import annotations

import os

# Always treat the test process as non-production so `app.main` import is stable
# even when the repo `.env` sets ENVIRONMENT=production (JWT / docs checks).
os.environ["ENVIRONMENT"] = "development"
