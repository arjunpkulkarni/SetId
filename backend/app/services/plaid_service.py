"""Plaid Link → Stripe bank token (Auth product only, US)."""

from __future__ import annotations

import logging
from typing import Any

from app.core.config import settings
from app.utils.timing import Timer

logger = logging.getLogger(__name__)


class PlaidError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class PlaidService:
    def __init__(self) -> None:
        if not settings.PLAID_ENABLED:
            raise PlaidError(
                "PLAID_DISABLED",
                "Bank linking is not enabled yet. Use card or manual bank entry.",
            )
        if not settings.PLAID_CLIENT_ID or not settings.PLAID_SECRET:
            raise PlaidError(
                "PLAID_NOT_CONFIGURED",
                "Plaid credentials are not configured on the server.",
            )
        self._client = self._build_client()

    @staticmethod
    def _plaid_host() -> str:
        import plaid

        env = (settings.PLAID_ENV or "sandbox").strip().lower()
        if env == "production":
            return plaid.Environment.Production
        return plaid.Environment.Sandbox

    def _build_client(self):
        import plaid
        from plaid.api import plaid_api

        configuration = plaid.Configuration(
            host=self._plaid_host(),
            api_key={
                "clientId": settings.PLAID_CLIENT_ID,
                "secret": settings.PLAID_SECRET,
            },
        )
        return plaid_api.PlaidApi(plaid.ApiClient(configuration))

    def create_link_token(
        self,
        *,
        client_user_id: str,
        purpose: str,
        redirect_uri: str | None = None,
    ) -> dict[str, str]:
        from plaid.model.country_code import CountryCode
        from plaid.model.link_token_create_request import LinkTokenCreateRequest
        from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
        from plaid.model.products import Products

        products = [Products(p) for p in (settings.PLAID_PRODUCTS or ["auth"])]
        user = LinkTokenCreateRequestUser(client_user_id=str(client_user_id))
        req_kwargs: dict[str, Any] = {
            "client_name": "Settld",
            "language": "en",
            "country_codes": [CountryCode("US")],
            "user": user,
            "products": products,
        }
        redirect = (redirect_uri or settings.PLAID_REDIRECT_URI or "").strip()
        if redirect:
            req_kwargs["redirect_uri"] = redirect

        with Timer("plaid.link_token", purpose=purpose):
            try:
                resp = self._client.link_token_create(
                    LinkTokenCreateRequest(**req_kwargs)
                )
            except Exception as e:
                logger.exception("plaid_link_token_failed purpose=%s", purpose)
                raise PlaidError(
                    "PLAID_LINK_TOKEN_FAILED",
                    "Could not start bank linking. Try again in a moment.",
                ) from e

        expiration = resp.expiration
        if hasattr(expiration, "isoformat"):
            expiration = expiration.isoformat()
        return {
            "link_token": resp.link_token,
            "expiration": str(expiration),
        }

    def exchange_public_token(self, public_token: str) -> tuple[str, str]:
        from plaid.model.item_public_token_exchange_request import (
            ItemPublicTokenExchangeRequest,
        )

        with Timer("plaid.exchange"):
            try:
                resp = self._client.item_public_token_exchange(
                    ItemPublicTokenExchangeRequest(public_token=public_token)
                )
            except Exception as e:
                logger.exception("plaid_exchange_failed")
                raise PlaidError(
                    "PLAID_EXCHANGE_FAILED",
                    "Could not verify the bank link. Please try again.",
                ) from e
        return resp.access_token, resp.item_id

    def create_stripe_bank_token(
        self, access_token: str, account_id: str
    ) -> str:
        from plaid.model.processor_stripe_bank_account_token_create_request import (
            ProcessorStripeBankAccountTokenCreateRequest,
        )

        with Timer("plaid.stripe_btok", account_id=account_id):
            try:
                resp = self._client.processor_stripe_bank_account_token_create(
                    ProcessorStripeBankAccountTokenCreateRequest(
                        access_token=access_token,
                        account_id=account_id,
                    )
                )
            except Exception as e:
                logger.exception("plaid_stripe_btok_failed")
                raise PlaidError(
                    "PLAID_STRIPE_TOKEN_FAILED",
                    "Could not connect that bank account to payouts. Try another account.",
                ) from e
        btok = resp.stripe_bank_account_token
        if not btok:
            raise PlaidError(
                "PLAID_STRIPE_TOKEN_FAILED",
                "Stripe bank token missing from Plaid response.",
            )
        return btok

    def complete_bank_link(
        self, *, public_token: str, account_id: str
    ) -> str:
        """Exchange Plaid public token and return a Stripe ``btok_``."""
        access_token, _item_id = self.exchange_public_token(public_token)
        return self.create_stripe_bank_token(access_token, account_id)
