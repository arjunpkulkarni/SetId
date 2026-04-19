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

    # Stripe Issuing (virtual cards)
    STRIPE_ISSUING_ENABLED: bool = False

    # Feature flags
    FEATURE_VIRTUAL_CARDS: bool = False

    GROQ_API_KEY: str = ""
    GROQ_BASE_URL: str = "https://api.groq.com/openai/v1"
    GROQ_RECEIPT_VISION_MODEL: str = "meta-llama/llama-4-scout-17b-16e-instruct"
    GROQ_RECEIPT_CLEANUP_MODEL: str = "openai/gpt-oss-20b"

    UPLOAD_DIR: str = "./uploads"

    CORS_ORIGINS: list[str] = ["http://localhost:3000", "http://localhost:5173"]

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

    # Optional LLM pass for item-name normalization (dictionary always runs first).
    RECEIPT_NORMALIZE_USE_LLM: bool = False

    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def effective_database_url(self) -> str:
        """Prefer DATABASE_URL_PROD when set (e.g. hosted Postgres), else DATABASE_URL."""
        if self.DATABASE_URL_PROD:
            return self.DATABASE_URL_PROD
        return self.DATABASE_URL


settings = Settings()
