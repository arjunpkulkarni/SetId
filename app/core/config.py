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

    # Twilio Verify (SMS OTP). Leave empty to use OTP_DEV_MODE only.
    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    TWILIO_VERIFY_SERVICE_SID: str = ""

    # When true (or when Twilio is not configured), use in-memory OTP for local/dev.
    OTP_DEV_MODE: bool = False

    # Max OTP send attempts per E.164 phone per rolling hour (in addition to IP limits)
    OTP_MAX_SENDS_PER_PHONE_PER_HOUR: int = 5

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
