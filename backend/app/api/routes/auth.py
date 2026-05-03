import logging
import uuid

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_token_payload
from app.db.session import get_db
from app.models.user import User
from app.core.response import success_response, error_response
from app.schemas.auth import (
    SignupRequest,
    LoginRequest,
    AuthResponse,
    UserBrief,
    AppleSignInRequest,
    SendOtpRequest,
    VerifyOtpRequest,
    PhoneAuthData,
    CreateProfileRequest,
    APPLE_PLACEHOLDER_FULL_NAME,
)
from app.services.auth_service import AuthService
from app.services.otp_service import (
    OtpProviderError,
    is_test_phone,
    otp_uses_dev_store,
    send_otp as send_sms_otp,
)
from app.limiter import limiter
from app.utils.phone import normalize_to_e164
from app.utils.phone_rate_limit import check_phone_send_limit

router = APIRouter(prefix="/auth", tags=["Auth"])
logger = logging.getLogger(__name__)


@router.post("/signup")
def signup(body: SignupRequest):
    return error_response(
        "UNSUPPORTED_AUTH_FLOW",
        "Email/password signup is disabled. Use phone OTP via Twilio Verify.",
        410,
    )


@router.post("/login")
def login(body: LoginRequest):
    return error_response(
        "UNSUPPORTED_AUTH_FLOW",
        "Email/password login is disabled. Use phone OTP via Twilio Verify.",
        410,
    )


@router.get("/me")
def get_me(current_user: User = Depends(get_current_user)):
    user_brief = UserBrief.model_validate(current_user)
    return success_response(data=user_brief.model_dump())


@router.post("/logout")
def logout(_payload: dict = Depends(get_token_payload)):
    return success_response(message="Logged out successfully")


@router.post("/create-profile")
def create_profile(
    body: CreateProfileRequest,
    payload: dict = Depends(get_token_payload),
    db: Session = Depends(get_db),
):
    sub = payload.get("sub")
    try:
        user_id = uuid.UUID(str(sub))
    except (TypeError, ValueError):
        return error_response("INVALID_TOKEN", "Invalid token subject", 401)

    existing = db.query(User).filter(User.id == user_id).first()
    if existing:
        # Apple Sign In often yields no real name (Apple only sends it once). Those
        # accounts are created with APPLE_PLACEHOLDER_FULL_NAME; let them complete
        # onboarding / create-profile to set a proper display name.
        if (
            (existing.auth_provider or "").lower() == "apple"
            and (existing.full_name or "").strip() == APPLE_PLACEHOLDER_FULL_NAME
        ):
            existing.full_name = body.full_name.strip()
            db.commit()
            db.refresh(existing)
            return success_response(
                data=UserBrief.model_validate(existing).model_dump(mode="json"),
                message="Profile updated",
            )
        return success_response(
            data=UserBrief.model_validate(existing).model_dump(mode="json"),
            message="Profile already exists",
        )

    raw_phone = payload.get("phone")
    phone_e164 = None
    if isinstance(raw_phone, str) and raw_phone.strip():
        try:
            phone_e164 = normalize_to_e164(raw_phone)
        except ValueError:
            phone_e164 = None

    if phone_e164:
        by_phone = db.query(User).filter(User.phone == phone_e164).first()
        if by_phone:
            return success_response(
                data=UserBrief.model_validate(by_phone).model_dump(),
                message="Profile already exists",
            )

    email = payload.get("email")
    if not isinstance(email, str) or not email.strip():
        email = f"{''.join(c for c in (phone_e164 or str(user_id)) if c.isdigit())}@phone.users.spltr"

    user = User(
        id=user_id,
        email=email,
        full_name=body.full_name.strip(),
        phone=phone_e164,
        auth_provider="phone",
        password_hash=None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return success_response(
        data=UserBrief.model_validate(user).model_dump(),
        message="Profile created",
    )


@router.post("/send-otp")
@limiter.limit("20/minute")
def send_otp(request: Request, body: SendOtpRequest, db: Session = Depends(get_db)):
    """Send SMS OTP via Twilio Verify (or dev in-memory when configured)."""
    try:
        phone_e164 = normalize_to_e164(body.phone)
    except ValueError:
        logger.warning(
            "auth.send_otp invalid_phone ip=%s",
            request.client.host if request.client else None,
        )
        return error_response(
            "INVALID_PHONE",
            "Enter a valid phone number in international format.",
            400,
        )
    # Test-login bypass phones skip the per-phone rate limit so reviewers
    # / QA can exercise the flow repeatedly without tripping the hourly cap.
    if not is_test_phone(phone_e164):
        try:
            check_phone_send_limit(phone_e164)
        except PermissionError as e:
            logger.warning(
                "auth.send_otp rate_limited phone_tail=%s ip=%s",
                phone_e164[-4:],
                request.client.host if request.client else None,
            )
            return error_response("RATE_LIMIT_EXCEEDED", str(e), 429)
    svc = AuthService(db)
    try:
        svc.assert_send_otp_intent(phone_e164, body.intent)
    except ValueError as e:
        err = e.args[0] if e.args else "ERROR"
        if err == "PHONE_ALREADY_REGISTERED":
            return error_response(
                "PHONE_ALREADY_REGISTERED",
                "This number already has an account. Log in instead.",
                409,
            )
        if err == "PHONE_NOT_REGISTERED":
            return error_response(
                "PHONE_NOT_REGISTERED",
                "No account for this number yet. Use Get Started to sign up.",
                404,
            )
        return error_response("ERROR", str(e), 400)
    try:
        send_sms_otp(phone_e164)
    except OtpProviderError as e:
        logger.warning(
            "auth.send_otp failed code=%s phone_tail=%s ip=%s",
            e.code,
            phone_e164[-4:],
            request.client.host if request.client else None,
        )
        status = 503 if e.code == "CONFIG_ERROR" else 502
        return error_response(e.code, e.message, status)
    logger.info(
        "auth.send_otp ok phone_tail=%s dev_mode=%s ip=%s",
        phone_e164[-4:],
        otp_uses_dev_store(),
        request.client.host if request.client else None,
    )
    return success_response(
        data={"sent": True, "otp_dev_mode": otp_uses_dev_store()},
        message="Verification code sent",
    )


@router.post("/verify-otp")
@limiter.limit("40/minute")
def verify_otp_phone(request: Request, body: VerifyOtpRequest, db: Session = Depends(get_db)):
    """Verify OTP and return JWT + user (signup creates user; login requires existing phone)."""
    svc = AuthService(db)
    try:
        user, token, needs_profile = svc.complete_phone_otp(
            body.phone, body.code, body.first_name, body.intent
        )
    except OtpProviderError as e:
        logger.warning(
            "auth.verify_otp provider_error code=%s ip=%s",
            e.code,
            request.client.host if request.client else None,
        )
        status = 503 if e.code == "CONFIG_ERROR" else 502
        return error_response(e.code, e.message, status)
    except ValueError as e:
        code = e.args[0] if e.args else "ERROR"
        logger.warning(
            "auth.verify_otp rejected reason=%s phone_tail=%s ip=%s",
            code,
            (body.phone or "")[-4:] if len(body.phone or "") >= 4 else "****",
            request.client.host if request.client else None,
        )
        mapping = {
            "INVALID_PHONE": (400, "INVALID_PHONE", "Enter a valid phone number."),
            "INVALID_OTP": (401, "INVALID_OTP", "That code is incorrect. Try again."),
            "OTP_EXPIRED": (400, "OTP_EXPIRED", "This code has expired. Request a new one."),
            "EMAIL_CONFLICT": (409, "EMAIL_CONFLICT", "Unable to create account. Contact support."),
            "ACCOUNT_DISABLED": (403, "ACCOUNT_DISABLED", "This account is disabled."),
            "PHONE_ALREADY_REGISTERED": (
                409,
                "PHONE_ALREADY_REGISTERED",
                "This number already has an account. Log in instead.",
            ),
            "PHONE_NOT_REGISTERED": (
                404,
                "PHONE_NOT_REGISTERED",
                "No account for this number. Use Get Started to sign up.",
            ),
            "NAME_REQUIRED": (
                400,
                "NAME_REQUIRED",
                "Enter your first name to create an account.",
            ),
        }
        if code in mapping:
            status, err_code, msg = mapping[code]
            return error_response(err_code, msg, status)
        return error_response("VERIFICATION_FAILED", str(e), 400)

    logger.info(
        "auth.verify_otp ok user_id=%s phone_tail=%s ip=%s",
        user.id if user else "pending-profile",
        (body.phone or "")[-4:] if len(body.phone or "") >= 4 else "****",
        request.client.host if request.client else None,
    )

    auth = PhoneAuthData(
        token=token,
        access_token=token,
        user=UserBrief.model_validate(user) if user else None,
        needs_profile=needs_profile,
    )
    return success_response(data=auth.model_dump(mode="json"), message="Signed in successfully")


@router.post("/apple")
@limiter.limit("30/minute")
async def apple_signin(
    request: Request,
    body: AppleSignInRequest,
    db: Session = Depends(get_db),
):
    """Sign in / sign up with Apple via native Apple Sign In on iOS."""
    svc = AuthService(db)
    try:
        user, token = await svc.apple_signin(
            identity_token=body.identity_token,
            authorization_code=body.authorization_code,
            user_info=body.user_info,
        )
    except ValueError as e:
        msg = str(e) or "Apple Sign-In failed."
        logger.warning(
            "auth.apple_signin rejected reason=%s ip=%s",
            msg,
            request.client.host if request.client else None,
        )
        if "disabled" in msg.lower() or "deactivated" in msg.lower():
            return error_response("ACCOUNT_DISABLED", "This account is disabled.", 403)
        if "email is required" in msg.lower():
            return error_response(
                "APPLE_EMAIL_REQUIRED",
                "Apple did not share your email. Try Continue with phone instead.",
                400,
            )
        if "invalid apple token" in msg.lower() or "apple key" in msg.lower():
            return error_response("APPLE_TOKEN_INVALID", "Could not verify your Apple credentials. Please try again.", 401)
        return error_response("APPLE_SIGNIN_FAILED", "Could not sign in with Apple. Please try again.", 400)

    logger.info(
        "auth.apple_signin ok user_id=%s ip=%s",
        user.id,
        request.client.host if request.client else None,
    )

    brief = UserBrief.model_validate(user)
    auth = PhoneAuthData(
        token=token,
        access_token=token,
        user=brief,
        needs_profile=brief.needs_display_name,
    )
    return success_response(data=auth.model_dump(mode="json"), message="Signed in with Apple")
