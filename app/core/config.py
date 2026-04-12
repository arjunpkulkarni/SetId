from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    PROJECT_NAME: str = "WealthSplit"

    DATABASE_URL: str = "postgresql://postgres:postgres@localhost:5432/wealthsplit"

    JWT_SECRET_KEY: str = "dev-secret-change-me"
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440

    STRIPE_SECRET_KEY: str = ""
    STRIPE_WEBHOOK_SECRET: str = ""
    STRIPE_PUBLISHABLE_KEY: str = ""

    UPLOAD_DIR: str = "./uploads"

    CORS_ORIGINS: list[str] = ["http://localhost:3000", "http://localhost:5173"]

    # Apple Sign In
    APPLE_TEAM_ID: str = ""
    APPLE_KEY_ID: str = ""
    APPLE_BUNDLE_ID: str = ""
    APPLE_PRIVATE_KEY_PATH: str = "./apple_private_key.p8"

    # Twilio Programmable SMS (payment requests & reminders)
    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    TWILIO_PHONE_NUMBER: str = ""  # E.164, e.g. +15551234567

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

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
