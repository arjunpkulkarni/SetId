import { useState, useEffect } from 'react';
import {
  PaymentElement,
  PaymentRequestButtonElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { formatCurrency } from '../utils/formatters';
import BankPayForm from './BankPayForm';
import './PaymentForm.css';

export default function PaymentForm({
  amount,
  billTitle,
  clientSecret,
  paymentId,
  payToken,
  plaidEnabled = false,
  onSuccess,
  onError,
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [paymentRequest, setPaymentRequest] = useState(null);
  const [payMode, setPayMode] = useState('card');

  useEffect(() => {
    if (!stripe || !amount || payMode === 'bank') return;
    const amountCents = Math.round(parseFloat(amount) * 100);
    if (amountCents <= 0) return;

    const pr = stripe.paymentRequest({
      country: 'US',
      currency: 'usd',
      total: { label: billTitle || 'settld Payment', amount: amountCents },
      requestPayerName: true,
      requestPayerEmail: true,
    });

    pr.canMakePayment().then((result) => {
      if (result) setPaymentRequest(pr);
    });

    pr.on('paymentmethod', async (ev) => {
      const { error: confirmError, paymentIntent } = await stripe.confirmCardPayment(
        clientSecret,
        { payment_method: ev.paymentMethod.id },
        { handleActions: false },
      );

      if (confirmError) {
        ev.complete('fail');
        setErrorMsg(confirmError.message);
        onError?.(confirmError.message);
      } else if (paymentIntent.status === 'requires_action') {
        const { error: actionError } = await stripe.confirmCardPayment(clientSecret);
        if (actionError) {
          ev.complete('fail');
          setErrorMsg(actionError.message);
          onError?.(actionError.message);
        } else {
          ev.complete('success');
          onSuccess?.();
        }
      } else {
        ev.complete('success');
        onSuccess?.();
      }
    });
  }, [stripe, amount, billTitle, clientSecret, onSuccess, onError, payMode]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setProcessing(true);
    setErrorMsg(null);

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.origin + '/success' },
      redirect: 'if_required',
    });

    if (error) {
      setErrorMsg(error.message);
      onError?.(error.message);
      setProcessing(false);
    } else if (paymentIntent?.status === 'succeeded') {
      onSuccess?.();
    } else {
      setProcessing(false);
    }
  };

  const handleBankSuccess = (meta) => {
    if (meta?.processing) {
      onSuccess?.({ processing: true, bankLast4: meta.bankLast4 });
    } else {
      onSuccess?.();
    }
  };

  if (plaidEnabled) {
    return (
      <div className="checkout-form">
        <div className="pay-mode-toggle" role="tablist" aria-label="Payment method">
          <button
            type="button"
            role="tab"
            aria-selected={payMode === 'card'}
            className={`pay-mode-chip${payMode === 'card' ? ' active' : ''}`}
            onClick={() => setPayMode('card')}
          >
            Card
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={payMode === 'bank'}
            className={`pay-mode-chip${payMode === 'bank' ? ' active' : ''}`}
            onClick={() => setPayMode('bank')}
          >
            Bank account
          </button>
        </div>

        {payMode === 'bank' ? (
          <BankPayForm
            amount={amount}
            paymentId={paymentId}
            payToken={payToken}
            onSuccess={handleBankSuccess}
            onError={onError}
          />
        ) : (
          <form onSubmit={handleSubmit}>
            {paymentRequest && (
              <div className="wallet-section">
                <PaymentRequestButtonElement options={{ paymentRequest }} />
                <div className="or-divider">
                  <span className="or-line" />
                  <span className="or-text">or pay with card</span>
                  <span className="or-line" />
                </div>
              </div>
            )}

            <PaymentElement />

            {errorMsg && (
              <div className="payment-error" role="alert">{errorMsg}</div>
            )}

            <button
              type="submit"
              disabled={processing || !stripe}
              className="pay-btn"
            >
              <span className="pay-btn-icon">🔒</span>
              {processing ? 'Processing...' : `Pay ${formatCurrency(amount)}`}
            </button>
          </form>
        )}

        <p className="pay-hint">
          Payments are processed securely via Stripe. Cards never go through Plaid.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="checkout-form">
      {paymentRequest && (
        <div className="wallet-section">
          <PaymentRequestButtonElement options={{ paymentRequest }} />
          <div className="or-divider">
            <span className="or-line" />
            <span className="or-text">or pay with card</span>
            <span className="or-line" />
          </div>
        </div>
      )}

      <PaymentElement />

      {errorMsg && (
        <div className="payment-error" role="alert">{errorMsg}</div>
      )}

      <button
        type="submit"
        disabled={processing || !stripe}
        className="pay-btn"
      >
        <span className="pay-btn-icon">🔒</span>
        {processing ? 'Processing...' : `Pay ${formatCurrency(amount)}`}
      </button>

      <p className="pay-hint">
        Uses your saved payment flow. Payments are processed securely via Stripe.
      </p>
    </form>
  );
}
