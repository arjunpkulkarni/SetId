"""Optional integration test for demo_receipt_perf (requires running API + workers)."""

import os

import httpx
import pytest

API_BASE = os.getenv("DEMO_API_URL", "http://localhost:8000")


def _api_up() -> bool:
    try:
        r = httpx.get(f"{API_BASE}/health", timeout=2.0)
        return r.status_code == 200
    except Exception:
        return False


@pytest.mark.integration
@pytest.mark.skipif(not _api_up(), reason="API not running at DEMO_API_URL")
def test_async_parse_enqueue_is_fast():
    """POST /parse (async) should accept quickly while workers process in background."""
    from scripts.demo_receipt_perf import (
        DEMO_OTP,
        DEMO_PHONE,
        PerfDemoClient,
        ensure_demo_receipt_image,
    )

    image = ensure_demo_receipt_image()
    client = PerfDemoClient(API_BASE)
    try:
        client.login_test_phone(DEMO_PHONE, DEMO_OTP)
        bill_id = client.create_bill("pytest perf")
        client.upload_receipt(bill_id, image)
        enqueue_ms, body = client.parse_async(bill_id)
        assert enqueue_ms < 2000, f"enqueue took {enqueue_ms}ms (expected fast accept)"
        assert body.get("job_id") or body.get("status") == "completed"
    finally:
        client.close()
