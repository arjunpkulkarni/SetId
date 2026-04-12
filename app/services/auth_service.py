from sqlalchemy.orm import Session

from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User
from app.services.apple_auth_service import AppleAuthService
from app.services.otp_service import OtpProviderError, verify_otp as verify_otp_code
from app.utils.phone import normalize_to_e164


def _synthetic_email_from_phone(e164: str) -> str:
    digits = "".join(c for c in e164 if c.isdigit())
    return f"{digits}@phone.users.spltr"


class AuthService:
    def __init__(self, db: Session):
        self.db = db

    def signup(self, email: str, password: str, full_name: str) -> tuple[User, str]:
        existing = self.db.query(User).filter(User.email == email).first()
        if existing:
            raise ValueError(f"User with email {email} already exists")

        user = User(
            email=email,
            password_hash=hash_password(password),
            full_name=full_name,
        )
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)

        token = create_access_token(str(user.id))
        return user, token

    def login(self, email: str, password: str) -> tuple[User, str]:
        user = self.db.query(User).filter(User.email == email).first()
        if not user:
            raise ValueError("Invalid email or password")

        if not verify_password(password, user.password_hash):
            raise ValueError("Invalid email or password")

        if not user.is_active:
            raise ValueError("User account is deactivated")

        token = create_access_token(str(user.id))
        return user, token

    def get_user(self, user_id: str) -> User | None:
        return self.db.query(User).filter(User.id == user_id).first()

    async def apple_signin(self, identity_token: str, authorization_code: str | None = None, user_info: dict | None = None) -> tuple[User, str]:
        """Handle Apple Sign In"""
        apple_service = AppleAuthService()
        
        try:
            # Verify Apple token
            apple_data = await apple_service.verify_apple_token(identity_token, authorization_code or "")
            
            apple_id = apple_data["apple_id"]
            email = apple_data.get("email")
            
            # Check if user exists by Apple ID
            user = self.db.query(User).filter(User.apple_id == apple_id).first()
            
            if user:
                # Existing user - just login
                if not user.is_active:
                    raise ValueError("User account is deactivated")
                token = create_access_token(str(user.id))
                return user, token
            
            # Check if user exists by email (for account linking)
            if email:
                existing_user = self.db.query(User).filter(User.email == email).first()
                if existing_user:
                    # Link Apple ID to existing account
                    existing_user.apple_id = apple_id
                    existing_user.auth_provider = "apple"
                    self.db.commit()
                    self.db.refresh(existing_user)
                    token = create_access_token(str(existing_user.id))
                    return existing_user, token
            
            # New user registration
            if not email:
                raise ValueError("Email is required for new user registration")
            
            # Extract name from user_info (first-time sign in only)
            full_name = "Apple User"  # Default
            if user_info and "name" in user_info:
                name_data = user_info["name"]
                first_name = name_data.get("firstName", "")
                last_name = name_data.get("lastName", "")
                if first_name or last_name:
                    full_name = f"{first_name} {last_name}".strip()
            
            # Create new user
            user = User(
                email=email,
                password_hash=None,  # No password for Apple users
                full_name=full_name,
                apple_id=apple_id,
                auth_provider="apple"
            )
            self.db.add(user)
            self.db.commit()
            self.db.refresh(user)
            
            token = create_access_token(str(user.id))
            return user, token
            
        except Exception as e:
            raise ValueError(f"Apple Sign In failed: {str(e)}")

    def get_or_create_user_for_phone(self, phone_e164: str, display_name: str) -> User:
        """display_name: trimmed first name (or fallback label for legacy)."""
        label = display_name.strip() if display_name else "Member"
        if not label:
            label = "Member"

        user = self.db.query(User).filter(User.phone == phone_e164).first()
        if user:
            if not user.is_active:
                raise ValueError("ACCOUNT_DISABLED")
            user.full_name = label
            self.db.commit()
            self.db.refresh(user)
            return user

        email = _synthetic_email_from_phone(phone_e164)
        if self.db.query(User).filter(User.email == email).first():
            raise ValueError("EMAIL_CONFLICT")

        user = User(
            email=email,
            password_hash=None,
            full_name=label,
            phone=phone_e164,
            auth_provider="phone",
        )
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return user

    def complete_phone_otp(self, phone_raw: str, code: str, first_name: str) -> tuple[User, str]:
        try:
            phone_e164 = normalize_to_e164(phone_raw)
        except ValueError as e:
            raise ValueError("INVALID_PHONE") from e

        try:
            status = verify_otp_code(phone_e164, code)
        except OtpProviderError:
            raise

        if status == "invalid":
            raise ValueError("INVALID_OTP")
        if status == "expired":
            raise ValueError("OTP_EXPIRED")

        display = (first_name or "").strip() or "Member"
        user = self.get_or_create_user_for_phone(phone_e164, display)
        token = create_access_token(str(user.id))
        return user, token
