import { useLocation } from 'react-router-dom';
import { formatCurrency } from '../utils/formatters';
import './SuccessPage.css';

export default function SuccessPage() {
  const { state } = useLocation();
  const amount = state?.amount;
  const billTitle = state?.billTitle;
  const merchantName = state?.merchantName;

  return (
    <div className="success-page">
      <div className="success-container">
        <header className="brand-header"><span className="brand">settld</span></header>

        <div className="success-header">
          <div className="success-icon-circle">
            <span className="success-check">✓</span>
          </div>
          <h1 className="success-title">Payment recorded</h1>
          <p className="success-desc">
            {amount ? `${formatCurrency(amount)} for ` : ''}
            {merchantName || billTitle || 'your bill'} was processed successfully.
          </p>
        </div>

        <div className="amount-card">
          <div className="amount-card-label">Amount Paid</div>
          <div className="amount-card-value">{amount ? formatCurrency(amount) : '$0.00'}</div>
          {(billTitle || merchantName) && (
            <div className="amount-card-bill">{billTitle || merchantName}</div>
          )}
          <div className="amount-card-footer">
            <span className="amount-card-shield">🛡️</span>
            <span className="amount-card-footer-text">Secured with Stripe</span>
          </div>
        </div>

        <div className="info-card">
          <div className="info-card-header">
            <span className="info-card-icon">ℹ️</span>
            <span className="info-card-title">What happens next</span>
          </div>
          <p className="info-card-desc">
            Your payment is saved on this bill. Other members can pay their shares from their
            accounts. You can close this page — everything is settled on your end.
          </p>
        </div>

        <button
          className="success-primary-btn"
          onClick={() => window.close()}
        >
          ✓ Done
        </button>
      </div>
    </div>
  );
}
