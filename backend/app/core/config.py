from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Repo root (B-SPLTR/), so .env loads even when cwd is not the project directory
_ENV_FILE = Path(__file__).resolve().parent.parent.parent / ".env"


class Settings(BaseSettings):
    PROJECT_NAME: str = "WealthSplit"

    DATABASE_URL: str = "postgresql://postgres:postgres@localhost:5432/wealthsplit"
    # Optional alternate DB URL (e.g. hosted Postgres). When set, `effective_database_url` prefers this.
    DATABASE_URL_PROD: str | None = None
    DIRECT_DATABASE_URL: str | None = None  # For migrations (bypasses connection pooling)

    JWT_SECRET_KEY: str = "dev-secret-change-me"
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440

    STRIPE_SECRET_KEY: str = ""
    STRIPE_WEBHOOK_SECRET: str = ""
    STRIPE_PUBLISHABLE_KEY: str = ""

    # ─── Stripe Connect (host payouts) ─────────────────────────────────
    # Separate webhook secret for the Connect endpoint (`account.updated`,
    # `payout.paid`, etc.). Use the secret shown in the dashboard for the
    # webhook whose URL is `/stripe/connect/webhook`. It MUST be different
    # from STRIPE_WEBHOOK_SECRET — Stripe signs Connect events with their
    # own endpoint's secret.
    STRIPE_CONNECT_WEBHOOK_SECRET: str = ""

    # Stripe-hosted Express onboarding redirects land here. Both URLs are
    # served by the backend itself (`/stripe/connect/return` and
    # `/stripe/connect/refresh`) — the mobile in-app browser detects the
    # redirect and closes, popping the user back into the app. No web
    # infrastructure change needed.
    CONNECT_RETURN_URL: str = "https://api.settld.live/stripe/connect/return"
    CONNECT_REFRESH_URL: str = "https://api.settld.live/stripe/connect/refresh"

    # Platform's cut on every guest PaymentIntent, in basis points.
    # 0 = no platform fee (everything except Stripe's per-txn fee flows to
    # the host). 200 = 2%. Applied as `application_fee_amount` on the
    # PaymentIntent when the bill's host has a connected account.
    PLATFORM_FEE_BPS: int = 0

    # Stripe Issuing (virtual cards)
    STRIPE_ISSUING_ENABLED: bool = False

    # Feature flags
    FEATURE_VIRTUAL_CARDS: bool = False

    OPENAI_API_KEY: str = ""
    OPENAI_BASE_URL: str | None = None
    OPENAI_RECEIPT_VISION_MODEL: str = "gpt-4.1"
    OPENAI_RECEIPT_CLEANUP_MODEL: str = "gpt-4.1-mini"

    GROQ_API_KEY: str = ""
    GROQ_BASE_URL: str = "https://api.groq.com/openai/v1"
    GROQ_RECEIPT_VISION_MODEL: str = "meta-llama/llama-4-scout-17b-16e-instruct"
    GROQ_RECEIPT_CLEANUP_MODEL: str = "openai/gpt-oss-20b"

    UPLOAD_DIR: str = "./uploads"

    # Explicit origin allow-list. Overridable via env as a JSON array.
    # Anything served from the `settld.live` family of hosts (app, pay, www,
    # marketing, etc.) should be allowed out of the box so we don't 400 every
    # OPTIONS preflight from a new subdomain.
    CORS_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
        "https://settld.live",
        "https://www.settld.live",
        "https://app.settld.live",
        "https://pay.settld.live",
    ]

    # Regex matched against the `Origin` header for credentialed requests that
    # come from dynamically-named subdomains (preview deploys, staging, etc.).
    # Must be a full-string regex. Leave empty to disable.
    CORS_ORIGIN_REGEX: str = r"https://[a-z0-9-]+\.settld\.live"

    # Apple Sign In
    APPLE_TEAM_ID: str = ""
    APPLE_KEY_ID: str = ""
    APPLE_BUNDLE_ID: str = ""
    APPLE_PRIVATE_KEY_PATH: str = "./apple_private_key.p8"

    # Twilio Programmable SMS + Verify (OTP)
    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    TWILIO_PHONE_NUMBER: str = ""  # E.164, e.g. +15551234567
    TWILIO_VERIFY_SERVICE_SID: str = ""

    # Base URL used in SMS links (must serve GET /pay/{token}, often API or app proxy)
    PUBLIC_PAYMENT_BASE_URL: str = "https://app.wealthsplit.com"

    # When Twilio is not configured, log SMS instead of sending (dev only)
    SMS_DEV_MODE: bool = True

    SMS_MAX_RETRIES: int = 3
    SMS_RETRY_BASE_DELAY_SEC: float = 0.5

    # Remind if still pending after N hours; at most one reminder per N hours
    REMINDER_UNPAID_AFTER_HOURS: int = 24
    REMINDER_MIN_INTERVAL_HOURS: int = 24

    # Optional: protect internal job endpoint
    INTERNAL_JOB_SECRET: str = ""

    # Run reminder job on interval (seconds); 0 disables in-process scheduler
    REMINDER_JOB_INTERVAL_SEC: int = 3600

    # When true (or when Twilio is not configured), use in-memory OTP for local/dev.
    OTP_DEV_MODE: bool = False

    # Max OTP send attempts per E.164 phone per rolling hour (in addition to IP limits)
    OTP_MAX_SENDS_PER_PHONE_PER_HOUR: int = 5

    # ─── Test-login bypass (Apple review / QA / demos) ────────────────
    # Any phone number listed here skips Twilio entirely: send_otp is a
    # no-op and verify_otp accepts only TEST_OTP_CODE. The bypass is
    # active even when Twilio credentials are configured, so it is safe
    # to use in production, but keep the list small and rotate the code
    # periodically. Numbers should be in E.164 (e.g. "+15555550100").
    # Fictitious US numbers like +1 (555) 01xx are encouraged since they
    # can never receive real SMS even if the bypass is later removed.
    TEST_PHONE_NUMBERS: list[str] = []
    TEST_OTP_CODE: str = "424242"

    # Service fee defaults (can be overridden per-bill)
    SERVICE_FEE_TYPE: str = "percentage"  # "flat" or "percentage"
    SERVICE_FEE_FLAT_AMOUNT: float = 0.75  # $0.75 default flat fee
    SERVICE_FEE_PERCENTAGE: float = 3.5  # 3.5% default percentage fee
    # Public pay link TTL in minutes (0 = no expiry)
    PAY_LINK_TTL_MINUTES: int = 20

    # Set to "production" to enable prod safety checks (secret validation, docs disabled)
    ENVIRONMENT: str = "development"

    # Async receipt parse (Celery). If unset, FastAPI BackgroundTasks runs the worker in-process.
    CELERY_BROKER_URL: str | None = None
    CELERY_RESULT_BACKEND: str | None = None

    # Redis URL for cross-worker WebSocket fan-out. When unset, the
    # per-bill WS manager is in-process only — safe for a single uvicorn
    # worker but broadcasts silently drop between workers/instances.
    # Setting this enables Redis pub/sub as the bus; every worker
    # subscribes and relays to its locally-connected sockets.
    WS_REDIS_URL: str | None = None

    # Optional LLM pass for item-name normalization (dictionary always runs first).
    RECEIPT_NORMALIZE_USE_LLM: bool = False

    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @staticmethod
    def _looks_like_openai_api_key(value: str | None) -> bool:
        return (value or "").strip().startswith("sk-")

    @staticmethod
    def _looks_like_groq_api_key(value: str | None) -> bool:
        return (value or "").strip().startswith("gsk_")

    @property
    def effective_database_url(self) -> str:
        """Prefer DATABASE_URL_PROD when set (e.g. hosted Postgres), else DATABASE_URL."""
        if self.DATABASE_URL_PROD:
            return self.DATABASE_URL_PROD
        return self.DATABASE_URL

    @property
    def receipt_ai_uses_openai(self) -> bool:
        if self.OPENAI_API_KEY:
            return True

        legacy_key = (self.GROQ_API_KEY or "").strip()
        legacy_base_url = (self.GROQ_BASE_URL or "").strip().lower().rstrip("/")
        if not legacy_key:
            return False
        if self._looks_like_groq_api_key(legacy_key):
            return False
        if not self._looks_like_openai_api_key(legacy_key):
            return False

        # If a legacy Groq key slot now contains an OpenAI key, prefer native
        # OpenAI defaults instead of accidentally sending that key to Groq's
        # compatibility endpoint.
        return not legacy_base_url or legacy_base_url == "https://api.groq.com/openai/v1"

    @property
    def receipt_ai_configured(self) -> bool:
        return bool(self.receipt_ai_api_key)

    @property
    def receipt_ai_api_key(self) -> str:
        return (self.OPENAI_API_KEY or self.GROQ_API_KEY).strip()

    @property
    def receipt_ai_base_url(self) -> str | None:
        if self.receipt_ai_uses_openai:
            return (self.OPENAI_BASE_URL or "").strip() or None
        return (self.GROQ_BASE_URL or "").strip() or None

    @property
    def receipt_ai_vision_model(self) -> str:
        if self.receipt_ai_uses_openai:
            return self.OPENAI_RECEIPT_VISION_MODEL
        return self.GROQ_RECEIPT_VISION_MODEL

    @property
    def receipt_ai_cleanup_model(self) -> str:
        if self.receipt_ai_uses_openai:
            return self.OPENAI_RECEIPT_CLEANUP_MODEL
        return self.GROQ_RECEIPT_CLEANUP_MODEL


settings = Settings()
