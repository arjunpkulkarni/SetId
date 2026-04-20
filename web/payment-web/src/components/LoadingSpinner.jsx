import './LoadingSpinner.css';

export default function LoadingSpinner({ message = 'Loading...' }) {
  return (
    <div className="loading-container">
      <div className="spinner" />
      <p className="loading-text">{message}</p>
    </div>
  );
}
