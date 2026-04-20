import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './HomePage.css';

export default function HomePage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);

  const handleJoin = (e) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;

    setError(null);

    // If they pasted a full URL, extract the token from it
    const urlMatch = trimmed.match(/\/(?:party|join)\/([^/?\s]+)/);
    if (urlMatch) {
      navigate(`/join/${urlMatch[1]}`);
      return;
    }

    // If it looks like a token/code, navigate directly
    if (/^[a-zA-Z0-9_-]{4,}$/.test(trimmed)) {
      navigate(`/join/${trimmed}`);
      return;
    }

    setError('That doesn\u2019t look like a valid invite code. Check and try again.');
  };

  return (
    <div className="home-page">
      <div className="home-container">
        <header className="home-brand">
          <span className="brand">settld</span>
        </header>

        <div className="home-hero">
          <div className="home-icon"><span style={{ fontSize: 40 }}>🍕</span></div>
          <h1 className="home-title">Split bills,<br />not friendships</h1>
          <p className="home-subtitle">
            Enter your invite code to join a bill split and pay your share
          </p>
        </div>

        <form onSubmit={handleJoin} className="home-form">
          <label htmlFor="invite-code" className="home-label">Invite Code</label>
          <input
            id="invite-code"
            type="text"
            className="home-input"
            placeholder="Paste code or link"
            value={code}
            onChange={(e) => { setCode(e.target.value); setError(null); }}
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />

          {error && (
            <div className="home-error" role="alert">{error}</div>
          )}

          <button
            type="submit"
            className="action-btn home-join-btn"
            disabled={!code.trim()}
          >
            Join Party
          </button>
        </form>

        <p className="home-footer-text">
          Got a payment link? It should open automatically.
        </p>
      </div>
    </div>
  );
}
