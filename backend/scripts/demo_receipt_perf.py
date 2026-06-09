#!/usr/bin/env python3
"""
Performance demo: async receipt parse (Celery + Redis) vs blocking sync parse.

Run from repo root:
  ./scripts/run_perf_demo.sh

Or inside Docker:
  docker compose exec api python -m scripts.demo_receipt_perf

Requires:
  - API + redis + worker-parse running (docker compose)
  - TEST_PHONE_NUMBERS includes DEMO_PHONE (default +15555550999)
  - OPENAI_API_KEY or GROQ_API_KEY for a full parse (enqueue timing works either way)
"""

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from pathlib import Path

import httpx

DEMO_PHONE = os.getenv("DEMO_PHONE", "+15555550999")
DEMO_OTP = os.getenv("DEMO_OTP", "424242")
API_BASE = os.getenv("DEMO_API_URL", "http://localhost:8000").rstrip("/")
POLL_INTERVAL_SEC = float(os.getenv("DEMO_POLL_INTERVAL", "1.5"))
POLL_TIMEOUT_SEC = float(os.getenv("DEMO_POLL_TIMEOUT", "180"))

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"
DEMO_RECEIPT_PATH = FIXTURES_DIR / "demo_receipt.jpg"


def _c(msg: str, code: str = "") -> str:
    if not sys.stdout.isatty():
        return msg
    colors = {
        "": "\033[0m",
        "bold": "\033[1m",
        "green": "\033[32m",
        "yellow": "\033[33m",
        "cyan": "\033[36m",
        "red": "\033[31m",
    }
    return f"{colors.get(code, '')}{msg}{colors['']}"


def _banner(title: str) -> None:
    print()
    print(_c("=" * 60, "cyan"))
    print(_c(f"  {title}", "bold"))
    print(_c("=" * 60, "cyan"))


def ensure_demo_receipt_image() -> Path:
    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
    if DEMO_RECEIPT_PATH.is_file() and DEMO_RECEIPT_PATH.stat().st_size > 1000:
        return DEMO_RECEIPT_PATH

    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        print(_c("Pillow not installed; using minimal placeholder bytes.", "yellow"))
        # Minimal valid JPEG header-ish won't work for OCR — user should pip install Pillow
        raise SystemExit(
            "Install Pillow in the API env to generate demo_receipt.jpg, or add your own JPEG "
            f"at {DEMO_RECEIPT_PATH}"
        )

    img = Image.new("RGB", (480, 720), color=(255, 255, 250))
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 22)
        font_sm = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 16)
    except OSError:
        font = ImageFont.load_default()
        font_sm = font

    lines = [
        "DEMO CAFE & GRILL",
        "123 Main St",
        "----------------",
        "Burger           12.00",
        "Fries             4.50",
        "Soda              2.50",
        "----------------",
        "Subtotal         19.00",
        "Tax               1.52",
        "Tip               3.00",
        "TOTAL            23.52",
        "Thank you!",
    ]
    y = 40
    for i, line in enumerate(lines):
        draw.text((32, y), line, fill=(20, 20, 20), font=font if i == 0 else font_sm)
        y += 36 if i == 0 else 28

    img.save(DEMO_RECEIPT_PATH, format="JPEG", quality=88)
    print(_c(f"Generated demo receipt image: {DEMO_RECEIPT_PATH}", "green"))
    return DEMO_RECEIPT_PATH


def _http_error_detail(resp: httpx.Response) -> str:
    try:
        body = resp.json()
        err = body.get("error") or {}
        code = err.get("code") or resp.status_code
        msg = err.get("message") or body.get("message") or resp.text
        return f"{code}: {msg}"
    except Exception:
        return resp.text[:500] or f"HTTP {resp.status_code}"


def _unwrap_json(resp: httpx.Response) -> dict:
    if resp.status_code >= 400:
        raise RuntimeError(_http_error_detail(resp))
    body = resp.json()
    if not body.get("success", True) and body.get("error"):
        raise RuntimeError(body["error"].get("message", str(body)))
    return body.get("data") or body


class PerfDemoClient:
    def __init__(self, base_url: str) -> None:
        self.base = base_url
        self.client = httpx.Client(base_url=base_url, timeout=120.0)
        self.token: str | None = None

    def close(self) -> None:
        self.client.close()

    def health(self) -> dict:
        r = self.client.get("/health")
        return r.json()

    def login_test_phone(self, phone: str, code: str) -> None:
        """Sign in via test-phone OTP bypass (+15555550999 / 424242).

        Tries signup first (fresh DB), then login if the number already exists.
        Requires TEST_PHONE_NUMBERS to include ``phone`` on the API container
        (fictitious 555 numbers fail normal E.164 validation otherwise).
        """
        intent = "signup"
        r = self.client.post(
            "/auth/send-otp",
            json={"phone": phone, "intent": "signup"},
        )
        if r.status_code == 409:
            intent = "login"
            r = self.client.post(
                "/auth/send-otp",
                json={"phone": phone, "intent": "login"},
            )
        if r.status_code >= 400:
            raise RuntimeError(
                f"send-otp failed: {_http_error_detail(r)}\n"
                "Fix: ensure backend/.env has an active line (not commented):\n"
                f'  TEST_PHONE_NUMBERS=["{phone}"]\n'
                "  TEST_OTP_CODE=424242\n"
                "Then: cd backend && docker compose up -d --force-recreate api"
            )

        r = self.client.post(
            "/auth/verify-otp",
            json={
                "phone": phone,
                "code": code,
                "first_name": "Perf Demo",
                "intent": intent,
            },
        )
        data = _unwrap_json(r)
        self.token = data.get("access_token") or data.get("token")
        if not self.token:
            raise RuntimeError("No access_token in verify-otp response")
        token_path = Path(os.getenv("SETLD_DEMO_TOKEN_FILE", "/tmp/settld_demo_token.txt"))
        token_path.write_text(self.token, encoding="utf-8")
        print(_c(f"   JWT written for app auto-login: {token_path}", "cyan"))

    def _auth_headers(self) -> dict[str, str]:
        if not self.token:
            raise RuntimeError("Not authenticated")
        return {"Authorization": f"Bearer {self.token}"}

    def create_bill(self, title: str) -> str:
        r = self.client.post(
            "/bills",
            headers=self._auth_headers(),
            json={"title": title, "merchant_name": "Demo Cafe", "currency": "USD"},
        )
        data = _unwrap_json(r)
        bill_id = data.get("id")
        if not bill_id:
            raise RuntimeError("create bill: missing id")
        return str(bill_id)

    def upload_receipt(self, bill_id: str, image_path: Path) -> None:
        with image_path.open("rb") as f:
            files = {"file": (image_path.name, f, "image/jpeg")}
            r = self.client.post(
                f"/bills/{bill_id}/receipt/upload",
                headers=self._auth_headers(),
                files=files,
            )
        _unwrap_json(r)

    def parse_async(self, bill_id: str) -> tuple[float, dict]:
        t0 = time.perf_counter()
        r = self.client.post(
            f"/bills/{bill_id}/receipt/parse",
            headers=self._auth_headers(),
        )
        elapsed_ms = (time.perf_counter() - t0) * 1000
        return elapsed_ms, _unwrap_json(r)

    def parse_sync(self, bill_id: str) -> tuple[float, dict]:
        t0 = time.perf_counter()
        r = self.client.post(
            f"/bills/{bill_id}/receipt/parse",
            headers=self._auth_headers(),
            params={"sync": True},
        )
        elapsed_ms = (time.perf_counter() - t0) * 1000
        return elapsed_ms, _unwrap_json(r)

    def parse_status(self, bill_id: str, job_id: str) -> dict:
        r = self.client.get(
            f"/bills/{bill_id}/receipt/parse-status/{job_id}",
            headers=self._auth_headers(),
        )
        return _unwrap_json(r)

    def poll_until_done(self, bill_id: str, job_id: str) -> tuple[float, dict]:
        t0 = time.perf_counter()
        deadline = t0 + POLL_TIMEOUT_SEC
        last: dict = {}
        while time.perf_counter() < deadline:
            last = self.parse_status(bill_id, job_id)
            status = last.get("status")
            if status in ("completed", "failed"):
                break
            time.sleep(POLL_INTERVAL_SEC)
        elapsed_ms = (time.perf_counter() - t0) * 1000
        return elapsed_ms, last


def check_docker_services() -> None:
    """Best-effort: warn if celery workers might be down."""
    try:
        import subprocess

        out = subprocess.run(
            ["docker", "compose", "ps", "--format", "json"],
            capture_output=True,
            text=True,
            cwd=Path(__file__).resolve().parents[1],
            timeout=10,
        )
        if out.returncode != 0:
            print(_c("Could not run `docker compose ps` (non-fatal).", "yellow"))
            return
        running = out.stdout
        for name in ("worker-parse", "redis"):
            if name not in running:
                print(_c(f"Warning: {name} may not be running.", "yellow"))
    except Exception:
        pass


def main() -> int:
    _banner("Settld receipt parse performance demo")
    print(f"API: {API_BASE}")
    print(f"Test phone: {DEMO_PHONE}  OTP: {DEMO_OTP}")

    check_docker_services()
    image_path = ensure_demo_receipt_image()

    client = PerfDemoClient(API_BASE)
    try:
        health = client.health()
        print(_c(f"Health: {health.get('status', health)}", "green"))

        print(_c("\n1) Test-phone login…", "bold"))
        client.login_test_phone(DEMO_PHONE, DEMO_OTP)
        print(_c("   Authenticated.", "green"))

        bill_title = f"Perf Demo {uuid.uuid4().hex[:6]}"
        print(_c(f"\n2) Create bill “{bill_title}”…", "bold"))
        bill_id = client.create_bill(bill_title)
        print(_c(f"   bill_id={bill_id}", "cyan"))

        print(_c("\n3) Upload demo receipt image…", "bold"))
        client.upload_receipt(bill_id, image_path)
        print(_c("   Uploaded.", "green"))

        print(_c("\n4) ASYNC parse (Celery) — HTTP should return fast", "bold"))
        enqueue_ms, enqueue_body = client.parse_async(bill_id)
        job_id = enqueue_body.get("job_id")
        status = enqueue_body.get("status")
        print(f"   enqueue_ms={enqueue_ms:.1f}  status={status}  job_id={job_id}")

        if not job_id:
            print(_c("   No job_id — already completed or not enqueued.", "yellow"))
            poll_ms, final = 0.0, enqueue_body
        else:
            print(_c("\n5) Poll parse-status until done…", "bold"))
            poll_ms, final = client.poll_until_done(bill_id, job_id)
            print(f"   poll_total_ms={poll_ms:.1f}  final_status={final.get('status')}")
            if final.get("status") == "failed":
                print(_c(f"   error={final.get('error')}", "red"))

        # Second bill for sync comparison (optional, can be slow)
        print(_c("\n6) SYNC parse (legacy) — blocks until pipeline finishes", "bold"))
        bill_id_sync = client.create_bill(f"{bill_title} sync")
        client.upload_receipt(bill_id_sync, image_path)
        sync_ms, sync_body = client.parse_sync(bill_id_sync)
        item_count = len((sync_body.get("items") or [])) if isinstance(sync_body, dict) else 0
        print(f"   sync_total_ms={sync_ms:.1f}  items={item_count}")

        _banner("Summary")
        print(f"  Async enqueue (user waits):     {enqueue_ms:>8.1f} ms")
        if job_id:
            print(f"  Worker + poll (background):     {poll_ms:>8.1f} ms")
        print(f"  Sync parse (blocks HTTP):       {sync_ms:>8.1f} ms")
        if enqueue_ms > 0 and sync_ms > 0:
            ratio = sync_ms / max(enqueue_ms, 0.1)
            print(_c(f"\n  Async enqueue is ~{ratio:.0f}x faster to respond than sync.", "green"))

        print(_c("\nLogs to watch:", "bold"))
        print("  docker compose logs -f api worker-parse | grep -E 'parse_enqueue|celery\\.task|worker\\.parse'")

        # Write bill id for the mobile demo script
        out_file = Path(os.getenv("SETTLD_DEMO_BILL_FILE", "/tmp/settld_demo_bill_id"))
        out_file.write_text(bill_id, encoding="utf-8")
        print(_c(f"\nMobile demo bill_id saved to {out_file}", "cyan"))
        print(_c(f"Login in simulator: {DEMO_PHONE}  code {DEMO_OTP}", "cyan"))

        return 0 if final.get("status") != "failed" else 1
    except httpx.ConnectError:
        print(_c(f"\nCannot reach API at {API_BASE}. Start stack: cd backend && docker compose up -d", "red"))
        return 1
    except Exception as exc:
        print(_c(f"\nDemo failed: {exc}", "red"))
        return 1
    finally:
        client.close()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--generate-image-only":
        ensure_demo_receipt_image()
        raise SystemExit(0)
    raise SystemExit(main())
