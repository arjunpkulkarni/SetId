#!/usr/bin/env python3
"""Start the FastAPI app from the project root (directory that contains `app/`).

Usage (from this repo root):
  python3 run_dev.py
  PORT=8001 python3 run_dev.py   # if 8000 is already in use
"""
import os
import socket
import sys

import uvicorn


def _port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    if _port_in_use(port):
        print(
            f"Port {port} is already in use (another uvicorn/API?).\n"
            f"  Use a free port:  PORT=8001 python3 run_dev.py\n"
            f"  Or stop the other process, e.g. find PID:  lsof -i :{port}",
            file=sys.stderr,
        )
        sys.exit(1)
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=True)
