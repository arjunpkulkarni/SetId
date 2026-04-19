#!/usr/bin/env python3
"""
Quick test script to verify Stripe API connectivity and configuration.
Run with: python test_stripe.py
"""

import os
import sys
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY")
STRIPE_PUBLISHABLE_KEY = os.getenv("STRIPE_PUBLISHABLE_KEY")

def test_stripe_config():
    """Test Stripe API configuration and connectivity."""
    print("=" * 60)
    print("STRIPE CONFIGURATION TEST")
    print("=" * 60)
    
    # Check if keys are set
    if not STRIPE_SECRET_KEY:
        print("❌ ERROR: STRIPE_SECRET_KEY not set in .env")
        return False
    
    if not STRIPE_PUBLISHABLE_KEY:
        print("❌ ERROR: STRIPE_PUBLISHABLE_KEY not set in .env")
        return False
    
    # Check key format
    secret_prefix = STRIPE_SECRET_KEY[:7]
    pub_prefix = STRIPE_PUBLISHABLE_KEY[:7]
    
    print(f"✓ Secret Key: {secret_prefix}{'*' * (len(STRIPE_SECRET_KEY) - 7)}")
    print(f"✓ Publishable Key: {pub_prefix}{'*' * (len(STRIPE_PUBLISHABLE_KEY) - 7)}")
    
    # Determine environment
    if STRIPE_SECRET_KEY.startswith("sk_live_"):
        print("⚠️  Mode: LIVE (real charges will be made)")
        mode = "LIVE"
    elif STRIPE_SECRET_KEY.startswith("sk_test_"):
        print("✓ Mode: TEST (safe for development)")
        mode = "TEST"
    else:
        print("❌ ERROR: Invalid Stripe secret key format")
        return False
    
    # Verify publishable key matches
    if mode == "LIVE" and not STRIPE_PUBLISHABLE_KEY.startswith("pk_live_"):
        print("❌ ERROR: Secret key is LIVE but publishable key is not")
        return False
    
    if mode == "TEST" and not STRIPE_PUBLISHABLE_KEY.startswith("pk_test_"):
        print("❌ ERROR: Secret key is TEST but publishable key is not")
        return False
    
    print("\n" + "=" * 60)
    print("Testing Stripe API Connection...")
    print("=" * 60)
    
    try:
        import stripe
    except ImportError:
        print("❌ ERROR: stripe package not installed")
        print("Install with: pip install stripe")
        return False
    
    stripe.api_key = STRIPE_SECRET_KEY
    
    try:
        # Test 1: Retrieve account information
        print("\n[Test 1] Retrieving account information...")
        account = stripe.Account.retrieve()
        print(f"✓ Account ID: {account.id}")
        print(f"✓ Country: {account.country}")
        print(f"✓ Charges Enabled: {account.charges_enabled}")
        print(f"✓ Payouts Enabled: {account.payouts_enabled}")
        
        if not account.charges_enabled:
            print("⚠️  WARNING: Charges are not enabled on this account!")
            print("   You need to complete Stripe account setup to accept payments.")
        
        # Test 2: Create a small test PaymentIntent
        print("\n[Test 2] Creating test PaymentIntent ($1.00 USD)...")
        intent = stripe.PaymentIntent.create(
            amount=100,  # $1.00 in cents
            currency="usd",
            metadata={
                "test": "true",
                "source": "test_stripe.py"
            },
            # Don't capture automatically - just test creation
            capture_method="manual"
        )
        print(f"✓ PaymentIntent created: {intent.id}")
        print(f"✓ Status: {intent.status}")
        print(f"✓ Client Secret: {intent.client_secret[:20]}...")
        
        # Cancel the test intent
        stripe.PaymentIntent.cancel(intent.id)
        print(f"✓ Test PaymentIntent cancelled successfully")
        
        print("\n" + "=" * 60)
        print("✅ ALL TESTS PASSED!")
        print("=" * 60)
        print("\nYour Stripe integration is configured correctly.")
        if mode == "LIVE":
            print("⚠️  Remember: You're using LIVE keys - real charges will occur!")
        
        return True
        
    except stripe.error.AuthenticationError as e:
        print(f"\n❌ AUTHENTICATION ERROR: {e}")
        print("   Your Stripe API key is invalid or has been revoked.")
        return False
    
    except stripe.error.PermissionError as e:
        print(f"\n❌ PERMISSION ERROR: {e}")
        print("   Your API key doesn't have permission for this operation.")
        return False
    
    except stripe.error.StripeError as e:
        print(f"\n❌ STRIPE ERROR: {e}")
        print(f"   Type: {type(e).__name__}")
        return False
    
    except Exception as e:
        print(f"\n❌ UNEXPECTED ERROR: {e}")
        return False

if __name__ == "__main__":
    success = test_stripe_config()
    sys.exit(0 if success else 1)
