import { useLocation, useNavigate } from 'react-router-dom';
import './ErrorPage.css';

export default function ErrorPage() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const type = state?.type;
  const message = state?.message;

  const isExpired = type === 'expired' || (message && message.toLowerCase().includes('expired'));
  const isPaid = type === 'paid' || (message && message.toLowerCase().includes('paid'));

  let icon, title, desc, infoTitle, infoDesc, circleClass, titleClass;

  if (isExpired) {
    icon = '⏰';
    title = 'Link Expired';
    desc = 'This payment link has expired. Ask the bill owner to resend your invite to get a new link.';
    infoTitle = 'Why do links expire?';
    infoDesc = 'Payment links expire after 20 minutes for security. The bill owner can send you a fresh link from their app at any time.';
    circleClass = 'expired';
    titleClass = '';
  } else if (isPaid) {
    icon = '✓';
    title = 'Already Paid';
    desc = 'This bill has already been paid. No further action is needed.';
    infoTitle = 'Need a receipt?';
    infoDesc = 'Your payment confirmation was sent to your email. You can also check your payment status in the settld app.';
    circleClass = 'paid';
    titleClass = 'paid-title';
  } else {
    icon = '!';
    title = 'Payment Failed';
    desc = message || 'An unexpected error occurred. Please try again or contact the bill owner.';
    infoTitle = 'What can you do?';
    infoDesc = 'Check your payment method, ensure your card has sufficient funds, or try again. If the problem persists, ask the bill owner for a new link.';
    circleClass = 'failed';
    titleClass = 'failed-title';
  }

  return (
    <div className="error-page">
      <div className="error-container">
        <header className="brand-header"><span className="brand">settld</span></header>

        <div style={{ textAlign: 'center', paddingTop: 48 }}>
          <div className={`error-icon-circle ${circleClass}`}>
            <span className="error-icon-emoji">{icon}</span>
          </div>
          <h1 className={`error-title ${titleClass}`}>{title}</h1>
          <p className="error-desc">{desc}</p>
        </div>

        <div className="error-info-card">
          <div className="error-info-header">
            <span className="error-info-icon">ℹ️</span>
            <span className="error-info-title">{infoTitle}</span>
          </div>
          <p className="error-info-desc">{infoDesc}</p>
        </div>

        {!isPaid && (
          <button className="error-action-btn" onClick={() => navigate(-1)}>
            ← Go Back
          </button>
        )}

        <button
          className="error-secondary-btn"
          onClick={() => window.close()}
        >
          Close Page
        </button>
      </div>
    </div>
  );
}
