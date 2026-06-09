import { useCallback, useEffect, useState } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { createPlaidLinkToken, completePlaidGuestPay } from '../services/api';
import { formatCurrency } from '../utils/formatters';
import './PaymentForm.css';

export default function BankPayForm({
  amount,
  paymentId,
  payToken,
  onSuccess,
  onError,
}) {
  const [linkToken, setLinkToken] = useState(null);
  const [loadingToken, setLoadingToken] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingToken(true);
      try {
        const data = await createPlaidLinkToken({
          purpose: 'guest_pay',
          payment_id: paymentId,
          pay_token: payToken,
        });
        if (!cancelled) setLinkToken(data.link_token);
      } catch (err) {
        if (!cancelled) {
          const msg = err.message || 'Bank pay is unavailable.';
          setErrorMsg(msg);
          onError?.(msg);
        }
      } finally {
        if (!cancelled) setLoadingToken(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paymentId, payToken, onError]);

  const handlePlaidSuccess = useCallback(
    async (publicToken, metadata) => {
      setProcessing(true);
      setErrorMsg(null);
      try {
        const accountId = metadata?.accounts?.[0]?.id;
        if (!accountId) throw new Error('No bank account selected.');
        const result = await completePlaidGuestPay({
          public_token: publicToken,
          account_id: accountId,
          payment_id: paymentId,
          pay_token: payToken,
        });
        onSuccess?.({ processing: result.status === 'processing', bankLast4: result.bank_last4 });
      } catch (err) {
        const msg = err.message || 'Bank payment failed.';
        setErrorMsg(msg);
        onError?.(msg);
      } finally {
        setProcessing(false);
      }
    },
    [paymentId, payToken, onSuccess, onError],
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: handlePlaidSuccess,
  });

  return (
    <div className="bank-pay-section">
      <p className="pay-hint bank-pay-hint">
        Pay from your US bank account. ACH can take 1–3 business days to settle; your bill
        will show as processing until the transfer completes.
      </p>
      {errorMsg && (
        <div className="payment-error" role="alert">{errorMsg}</div>
      )}
      <button
        type="button"
        className="pay-btn bank-pay-btn"
        disabled={loadingToken || processing || !ready}
        onClick={() => open()}
      >
        <span className="pay-btn-icon">🏦</span>
        {processing
          ? 'Processing bank payment…'
          : loadingToken
            ? 'Loading bank pay…'
            : `Pay ${formatCurrency(amount)} with bank`}
      </button>
    </div>
  );
}
