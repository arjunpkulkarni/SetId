import { formatCurrency } from '../utils/formatters';
import './ReceiptCard.css';

export default function ReceiptCard({ paymentInfo }) {
  const items = paymentInfo.items || [];
  const subtotal = parseFloat(paymentInfo.subtotal ?? paymentInfo.amount ?? 0) || 0;
  const tax = parseFloat(paymentInfo.tax ?? paymentInfo.tax_share ?? 0) || 0;
  const serviceFee = parseFloat(paymentInfo.service_fee ?? paymentInfo.tip_share ?? paymentInfo.fee_share ?? 0) || 0;
  const total = parseFloat(paymentInfo.total ?? paymentInfo.total_owed ?? subtotal) || 0;

  return (
    <div className="receipt-card">
      {items.length === 0 ? (
        <p className="empty-items">No line items for your share.</p>
      ) : (
        items.map((item, i) => (
          <div key={`${item.name}-${i}`} className="line-item">
            <div className="line-item-left">
              <div className="line-item-name">{item.name || 'Item'}</div>
              <div className="line-item-desc">Assigned to you</div>
            </div>
            <span className="line-item-price">
              {formatCurrency(parseFloat(item.total_price || item.unit_price || item.amount || item.price || 0))}
            </span>
          </div>
        ))
      )}

      <div className="receipt-divider" />

      <div className="breakdown-section">
        <div className="breakdown-row">
          <span className="breakdown-label">Subtotal (your share)</span>
          <span className="breakdown-value">{formatCurrency(subtotal)}</span>
        </div>
        {tax > 0 && (
          <div className="breakdown-row">
            <span className="breakdown-label">Tax</span>
            <span className="breakdown-value">{formatCurrency(tax)}</span>
          </div>
        )}
        {serviceFee > 0 && (
          <div className="breakdown-row">
            <span className="breakdown-label">Service Fee</span>
            <span className="breakdown-value">{formatCurrency(serviceFee)}</span>
          </div>
        )}
      </div>

      <div className="receipt-dashed-divider" />

      <div className="receipt-total-row">
        <span className="receipt-total-label">Total to Pay</span>
        <span className="receipt-total-amount">{formatCurrency(total)}</span>
      </div>
    </div>
  );
}
