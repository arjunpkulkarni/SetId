import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Elements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { getPaymentDetails } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';
import ReceiptCard from '../components/ReceiptCard';
import PaymentForm from '../components/PaymentForm';
import './PaymentPage.css';

export default function PaymentPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [paymentData, setPaymentData] = useState(null);
  const [stripePromise, setStripePromise] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchPayment = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getPaymentDetails(token);

      if (data.token_expired) {
        navigate('/error', { state: { type: 'expired' } });
        return;
      }
      if (data.payments_locked) {
        navigate('/error', {
          state: {
            type: 'locked',
            message: data.lock_message || 'The host has not opened payments yet.',
          },
        });
        return;
      }
      if (data.already_paid) {
        navigate('/error', { state: { type: 'paid' } });
        return;
      }

      setPaymentData(data);
      const pk = data.stripe_publishable_key || import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
      if (pk) setStripePromise(loadStripe(pk));
    } catch (err) {
      setError(err.message || 'Could not load payment details.');
    } finally {
      setLoading(false);
    }
  }, [token, navigate]);

  useEffect(() => { fetchPayment(); }, [fetchPayment]);

  const handleSuccess = () => {
    navigate('/success', {
      state: {
        amount: paymentData?.total ?? paymentData?.amount,
        billTitle: paymentData?.bill_title,
        merchantName: paymentData?.merchant_name,
      },
    });
  };

  if (loading) return <LoadingSpinner message="Loading payment details..." />;

  if (error) {
    return (
      <div className="pay-page">
        <div className="pay-container">
          <header className="brand-header"><span className="brand">settld</span></header>
          <div className="centered-state">
            <div className="state-icon error-bg"><span className="state-emoji">!</span></div>
            <h1 className="state-title error-color">Unable to Load Payment</h1>
            <p className="state-desc">{error}</p>
            <button className="action-btn" onClick={fetchPayment}>Try Again</button>
          </div>
        </div>
      </div>
    );
  }

  if (!paymentData) return <LoadingSpinner message="Initializing..." />;

  const billTitle = paymentData.bill_title || paymentData.merchant_name || 'Your Bill';
  const totalAmount = paymentData.total ?? paymentData.amount;
  const clientSecret = paymentData.stripe_client_secret || paymentData.payment_intent_client_secret;
  const memberName = paymentData.member_nickname || paymentData.member_name;

  return (
    <div className="pay-page">
      <div className="pay-container">
        <header className="brand-header"><span className="brand">settld</span></header>

        <div className="pay-hero-section">
          <div className="pay-hero-icon"><span style={{ fontSize: 36 }}>🧾</span></div>
          <h1 className="pay-hero-title">{billTitle}</h1>
          <p className="pay-hero-subtitle">
            Your share{memberName ? ` (${memberName})` : ''} — review and pay below.
          </p>
        </div>

        <ReceiptCard paymentInfo={paymentData} />

        {clientSecret && stripePromise ? (
          <Elements
            stripe={stripePromise}
            options={{
              clientSecret,
              appearance: {
                theme: 'stripe',
                variables: {
                  colorPrimary: '#006c5c',
                  fontFamily: 'Inter, system-ui, sans-serif',
                  borderRadius: '12px',
                },
                rules: {
                  '.Input': {
                    padding: '14px 16px',
                    fontSize: '16px',
                  },
                },
              },
            }}
          >
            <PaymentForm
              amount={totalAmount}
              billTitle={billTitle}
              clientSecret={clientSecret}
              onSuccess={handleSuccess}
            />
          </Elements>
        ) : (
          <div className="no-stripe-card">
            <p className="no-stripe-text">
              {!import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
                ? 'Stripe is not configured. Contact the bill owner.'
                : 'Unable to load payment form.'}
            </p>
          </div>
        )}

        <div className="security-footer">
          <div className="footer-card">
            <div className="footer-card-icon">🔒</div>
            <div className="footer-card-label">Security</div>
            <div className="footer-card-value">Payments processed securely via Stripe</div>
          </div>
          <div className="footer-card">
            <div className="footer-card-icon">💳</div>
            <div className="footer-card-label">Payment</div>
            <div className="footer-card-value">Card, Apple Pay, and Google Pay accepted</div>
          </div>
        </div>
      </div>
    </div>
  );
}
