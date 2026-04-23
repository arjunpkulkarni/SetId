"""
Seed one user row per phone listed in settings.TEST_PHONE_NUMBERS so the
test-login bypass works for the "login" intent (not just "signup") right
out of the box.

Idempotent: skips phones that already have a user row. Safe to run on
production — only inserts rows for the exact phones you configured as
test logins.

Run with: python -m scripts.seed_test_phones
"""

from __future__ import annotations

import uuid

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.user import User


def _synthetic_email(phone_e164: str) -> str:
    digits = "".join(c for c in phone_e164 if c.isdigit())
    return f"{digits}@phone.users.spltr"


def seed_test_phones() -> None:
    phones = [p.strip() for p in settings.TEST_PHONE_NUMBERS if p and p.strip()]
    if not phones:
        print("No TEST_PHONE_NUMBERS configured; nothing to do.")
        return

    db = SessionLocal()
    created = 0
    skipped = 0
    try:
        for idx, phone in enumerate(phones, start=1):
            existing = db.query(User).filter(User.phone == phone).first()
            if existing:
                print(f"  skip  {phone} (user {existing.id} already exists)")
                skipped += 1
                continue

            user = User(
                id=uuid.uuid4(),
                email=_synthetic_email(phone),
                full_name=f"Test User {idx}",
                phone=phone,
                auth_provider="phone",
                password_hash=None,
            )
            db.add(user)
            db.flush()
            print(f"  add   {phone} -> user {user.id}")
            created += 1

        db.commit()
        print(
            f"Done. Created {created}, skipped {skipped}. "
            f"Use code {settings.TEST_OTP_CODE} to log in with any of these numbers."
        )
    except Exception as e:
        db.rollback()
        print(f"Error seeding test phones: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_test_phones()
