"""
Foreign-exchange rates → USD.

Used by the receipt parser when a host scans a bill in a non-USD
currency (Bali / IDR, Singapore / SGD, London / GBP, …) so the app can
convert every amount on the bill to USD before persistence. The host's
Stripe Connect account stays USD; this is only a *display + math*
conversion done once at parse time. The original currency + the FX
rate used are stored on the bill (`original_currency`, `original_total`,
`fx_rate_to_usd`) so the BillSplit screen can render the original-
currency total as a small hint underneath the USD figure.

Why open.er-api.com:
    - Free, no API key required.
    - Daily updated rates (precise enough for splitting a dinner bill).
    - Returns ALL ISO 4217 codes against a single base in one call.
    - https://open.er-api.com/v6/latest/USD

We cache the full rate table in-process for ``CACHE_TTL_SECONDS`` so a
busy parse pipeline (multi-image receipts, parallel cleanup workers)
hits the network at most once per ~hour. The cache is per-process —
fine for a small fleet; if we ever scale horizontally and want shared
caching, drop in Redis at the call site.

Failure mode: every public API has bad days. If the fetch fails, we
fall back to "rate unavailable" → callers should treat the bill as
USD (no conversion). The receipt parser handles this gracefully by
logging a warning and leaving amounts in the original (assumed USD)
currency rather than half-converting.
"""

import logging
import threading
import time
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


# Public free endpoint — base=USD means each `rates[X]` is "X per 1 USD".
_OPEN_ER_API_URL = "https://open.er-api.com/v6/latest/USD"

# Cache the full rate table for an hour. Receipts get parsed in bursts
# (especially during dinner rushes) and these rates only update daily,
# so a 60-min TTL is generous and well within freshness.
CACHE_TTL_SECONDS = 60 * 60

# Network timeout — keep tight so a slow FX provider can't stall the
# receipt parse pipeline. The parser's outer pipeline already has its
# own timeout / retry but we don't want to lean on it for FX.
_HTTP_TIMEOUT_SECONDS = 6.0

_MONEY_QUANTIZE = Decimal("0.01")
_RATE_QUANTIZE = Decimal("0.00000001")  # 8 decimals matches DB column


class FxRateUnavailable(RuntimeError):
    """Raised when we couldn't get an FX rate for a currency.

    Callers should generally catch and degrade gracefully (e.g. leave
    the bill in its original currency) rather than 500 the user.
    """


# In-process cache — guarded by a lock so the first request after TTL
# expiry doesn't fan out into N parallel HTTP calls when a multi-image
# receipt is parsing all images at once.
_cache_lock = threading.Lock()
_cache: dict[str, object] = {
    # `rates`: dict[str, Decimal] — base USD, e.g. {"EUR": "0.92", ...}
    "rates": None,
    "fetched_at": 0.0,
}


def _normalize_code(code: str | None) -> str | None:
    """Return an upper-case 3-letter ISO code, or None if invalid.

    The receipt parser passes whatever the LLM returned; sometimes that's
    a symbol (`$`), a country word (`yen`), or an empty string. The
    cleanup-step Pydantic validator already normalizes the obvious
    cases — this is just a defensive last pass.
    """
    if not code:
        return None
    cleaned = "".join(ch for ch in code if ch.isalpha()).upper()
    return cleaned if len(cleaned) == 3 else None


def _fetch_rates() -> dict[str, Decimal]:
    """Pull the latest USD-base rate table from open.er-api.com."""
    try:
        with httpx.Client(timeout=_HTTP_TIMEOUT_SECONDS) as client:
            resp = client.get(_OPEN_ER_API_URL)
            resp.raise_for_status()
            payload = resp.json()
    except (httpx.HTTPError, ValueError) as e:
        raise FxRateUnavailable(f"FX provider request failed: {e}") from e

    if payload.get("result") != "success":
        raise FxRateUnavailable(
            f"FX provider returned non-success result: "
            f"{payload.get('error-type') or payload.get('result')}"
        )

    raw_rates = payload.get("rates") or {}
    if not isinstance(raw_rates, dict) or not raw_rates:
        raise FxRateUnavailable("FX provider returned empty rate table")

    rates: dict[str, Decimal] = {}
    for code, rate in raw_rates.items():
        norm = _normalize_code(code)
        if not norm:
            continue
        try:
            rates[norm] = Decimal(str(rate))
        except (ValueError, ArithmeticError):
            continue

    # USD vs USD is implicit — guarantee a self-rate of 1 even if the
    # provider ever drops it (it doesn't today).
    rates.setdefault("USD", Decimal("1"))
    return rates


def _get_rates(force_refresh: bool = False) -> dict[str, Decimal]:
    """Return the cached USD-base rate table, refreshing if stale."""
    now = time.time()
    if not force_refresh:
        cached = _cache.get("rates")
        fetched_at = float(_cache.get("fetched_at") or 0.0)
        if cached and (now - fetched_at) < CACHE_TTL_SECONDS:
            return cached  # type: ignore[return-value]

    with _cache_lock:
        # Re-check after grabbing the lock — another thread may have
        # populated the cache while we were waiting.
        cached = _cache.get("rates")
        fetched_at = float(_cache.get("fetched_at") or 0.0)
        if (
            not force_refresh
            and cached
            and (time.time() - fetched_at) < CACHE_TTL_SECONDS
        ):
            return cached  # type: ignore[return-value]

        rates = _fetch_rates()
        _cache["rates"] = rates
        _cache["fetched_at"] = time.time()
        logger.info(
            "fx_rates_refreshed currency_count=%s sample_eur=%s sample_idr=%s",
            len(rates),
            rates.get("EUR"),
            rates.get("IDR"),
        )
        return rates


def get_rate_to_usd(currency_code: str) -> Decimal:
    """Return the rate that converts 1 unit of ``currency_code`` to USD.

    i.e. ``usd_amount = native_amount * get_rate_to_usd(code)``.

    Raises :class:`FxRateUnavailable` if the code is unknown or the
    rate provider is unreachable. Callers should generally treat that
    as "leave the bill in its original currency" rather than aborting.
    """
    code = _normalize_code(currency_code)
    if not code:
        raise FxRateUnavailable(
            f"Unrecognized currency code: {currency_code!r}"
        )
    if code == "USD":
        return Decimal("1")

    rates = _get_rates()
    # Provider returns rates as "code per USD" — the inverse of what we
    # want. e.g. rates["IDR"] = 16,250 → 1 USD ≈ 16,250 IDR → 1 IDR ≈
    # 1 / 16,250 USD.
    code_per_usd = rates.get(code)
    if not code_per_usd or code_per_usd <= 0:
        raise FxRateUnavailable(
            f"FX provider has no rate for {code!r}"
        )
    rate_to_usd = (Decimal("1") / code_per_usd).quantize(
        _RATE_QUANTIZE, rounding=ROUND_HALF_UP
    )
    return rate_to_usd


def convert_to_usd(
    amount: Decimal | None,
    currency_code: str,
    *,
    rate: Optional[Decimal] = None,
) -> Decimal | None:
    """Convert ``amount`` from ``currency_code`` to USD (rounded to cents).

    ``rate`` lets the caller reuse a single rate snapshot across many
    fields on the same bill — important so the FX rate the parser
    stamps on the bill (`fx_rate_to_usd`) actually matches what was
    applied to every line item / total / tax line. A second call to
    `get_rate_to_usd` an hour later might return a fractionally
    different rate after the cache rolls.

    Returns None when ``amount`` is None (caller can pass in optional
    fields like ``cleaned.tip`` directly).
    """
    if amount is None:
        return None
    code = _normalize_code(currency_code)
    if not code or code == "USD":
        return Decimal(amount).quantize(_MONEY_QUANTIZE, rounding=ROUND_HALF_UP)

    fx = rate if rate is not None else get_rate_to_usd(code)
    return (Decimal(amount) * fx).quantize(
        _MONEY_QUANTIZE, rounding=ROUND_HALF_UP
    )
