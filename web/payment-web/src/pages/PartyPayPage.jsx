import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Elements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { confirmParty, notifyPaymentComplete } from '../services/api';
import { formatCurrency } from '../utils/formatters';
import LoadingSpinner from '../components/LoadingSpinner';
import ReceiptCard from '../components/ReceiptCard';
import PaymentForm from '../components/PaymentForm';
import './PartyPayPage.css';

export default function PartyPayPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const memberName = location.state?.memberName;
  const billTitle = location.state?.billTitle;

  const [paymentInfo, setPaymentInfo] = useState(null);
  const [stripePromise, setStripePromise] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchConfirmation = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await confirmParty(token);
      setPaymentInfo(data);

      const pk = data.stripe_publishable_key || import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
      if (pk) setStripePromise(loadStripe(pk));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchConfirmation(); }, [fetchConfirmation]);

  const handleSuccess = async () => {
    try {
      await notifyPaymentComplete(token);
    } catch {
      // Best-effort notification; webhook will also handle it
    }
    navigate('/success', {
      state: {
        amount: paymentInfo?.amount ?? paymentInfo?.breakdown?.total_owed,
        billTitle: billTitle || 'Your bill',
      },
    });
  };

  const handleError = (msg) => {
    setError(msg);
  };

  if (loading) return <LoadingSpinner message="Preparing payment..." />;

  if (error && !paymentInfo) {
    return (
      <div className="party-pay-page">
        <div className="party-pay-container">
          <header className="brand-header"><span className="brand">settld</span></header>
          <div className="centered-state">
            <div className="state-icon error-bg"><span className="state-emoji">!</span></div>
            <h1 className="state-title error-color">Payment Failed</h1>
            <p className="state-desc">{error}</p>
            <button className="action-btn" onClick={fetchConfirmation}>Try Again</button>
          </div>
        </div>
      </div>
    );
  }

  if (!paymentInfo) return <LoadingSpinner message="Initializing..." />;

  const clientSecret = paymentInfo.stripe_client_secret;
  const breakdown = paymentInfo.breakdown || {};
  const totalAmount = paymentInfo.amount ?? breakdown.total_owed;

  const receiptData = {
    subtotal: breakdown.subtotal,
    tax_share: breakdown.tax_share,
    tip_share: breakdown.tip_share,
    fee_share: breakdown.fee_share,
    total: totalAmount,
  };

  return (
    <div className="party-pay-page">
      <div className="party-pay-container">
        <header className="brand-header"><span className="brand">settld</span></header>

        <div className="party-pay-hero">
          <div className="party-pay-icon"><span style={{ fontSize: 28 }}>💳</span></div>
          <h1 className="party-pay-title">{billTitle || 'Your Share'}</h1>
          {memberName && (
            <p className="party-pay-subtitle">Paying for {memberName}</p>
          )}
        </div>

        <ReceiptCard paymentInfo={receiptData} />

        {error && (
          <div className="party-pay-error" role="alert">{error}</div>
        )}

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
                  borderRadius: '8px',
                },
              },
            }}
          >
            <PaymentForm
              amount={totalAmount}
              billTitle={billTitle}
              clientSecret={clientSecret}
              onSuccess={handleSuccess}
              onError={handleError}
            />
          </Elements>
        ) : (
          <div className="centered-state">
            <p className="state-desc">
              Unable to load payment form. Please try again.
            </p>
            <button className="action-btn" onClick={fetchConfirmation}>Retry</button>
          </div>
        )}
      </div>
    </div>
  );
}
