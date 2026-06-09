#!/usr/bin/env bash
# Wrapper — run from backend/ or repo root.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec "${ROOT}/scripts/run_perf_demo.sh" "$@"
