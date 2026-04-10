import time
import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
import httpx
from typing import Dict, Any

from app.core.config import settings


class AppleAuthService:
    def __init__(self):
        self.team_id = settings.APPLE_TEAM_ID
        self.key_id = settings.APPLE_KEY_ID
        self.bundle_id = settings.APPLE_BUNDLE_ID
        self.private_key_path = settings.APPLE_PRIVATE_KEY_PATH
        
    def _load_private_key(self):
        """Load Apple private key from .p8 file"""
        try:
            with open(self.private_key_path, 'rb') as key_file:
                private_key = serialization.load_pem_private_key(
                    key_file.read(),
                    password=None
                )
            return private_key
        except FileNotFoundError:
            raise ValueError("Apple private key file not found. Please add your .p8 file.")
    
    def _generate_client_secret(self) -> str:
        """Generate JWT client secret for Apple"""
        private_key = self._load_private_key()
        
        headers = {
            "alg": "ES256",
            "kid": self.key_id
        }
        
        payload = {
            "iss": self.team_id,
            "iat": int(time.time()),
            "exp": int(time.time()) + 86400 * 180,  # 6 months
            "aud": "https://appleid.apple.com",
            "sub": self.bundle_id
        }
        
        return jwt.encode(payload, private_key, algorithm="ES256", headers=headers)
    
    async def verify_apple_token(self, identity_token: str, authorization_code: str) -> Dict[str, Any]:
        """Verify Apple identity token and get user info"""
        try:
            # Decode without verification first to get header info
            unverified_header = jwt.get_unverified_header(identity_token)
            unverified_payload = jwt.decode(identity_token, options={"verify_signature": False})
            
            # Get Apple's public keys
            async with httpx.AsyncClient() as client:
                response = await client.get("https://appleid.apple.com/auth/keys")
                apple_keys = response.json()
            
            # Find the correct key
            key_id = unverified_header.get("kid")
            apple_key = None
            for key in apple_keys["keys"]:
                if key["kid"] == key_id:
                    apple_key = key
                    break
            
            if not apple_key:
                raise ValueError("Apple key not found")
            
            # Convert JWK to PEM format for verification
            from jwt.algorithms import RSAAlgorithm
            public_key = RSAAlgorithm.from_jwk(apple_key)
            
            # Verify the token
            payload = jwt.decode(
                identity_token,
                public_key,
                algorithms=["RS256"],
                audience=self.bundle_id,
                issuer="https://appleid.apple.com"
            )
            
            return {
                "apple_id": payload.get("sub"),
                "email": payload.get("email"),
                "email_verified": payload.get("email_verified", False),
                "is_private_email": payload.get("is_private_email", False),
                "real_user_status": payload.get("real_user_status", 0)
            }
            
        except Exception as e:
            raise ValueError(f"Invalid Apple token: {str(e)}")
    
    async def exchange_code_for_tokens(self, authorization_code: str) -> Dict[str, Any]:
        """Exchange authorization code for access and refresh tokens"""
        client_secret = self._generate_client_secret()
        
        data = {
            "client_id": self.bundle_id,
            "client_secret": client_secret,
            "code": authorization_code,
            "grant_type": "authorization_code"
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://appleid.apple.com/auth/token",
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"}
            )
            
            if response.status_code != 200:
                raise ValueError("Failed to exchange authorization code")
            
            return response.json()