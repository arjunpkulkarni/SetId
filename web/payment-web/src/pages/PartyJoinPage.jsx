import { useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { joinParty } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';
import './PartyJoinPage.css';

export default function PartyJoinPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const basePath = location.pathname.startsWith('/join') ? '/join' : '/party';
  const [nickname, setNickname] = useState('');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState(null);

  const handleJoin = async (e) => {
    e.preventDefault();
    const name = nickname.trim();
    if (!name) return;

    setJoining(true);
    setError(null);
    try {
      const data = await joinParty(token, name);
      navigate(`${basePath}/${token}/receipt`, {
        state: {
          memberId: data.member_id,
          memberName: name,
          billId: data.bill_id,
          billTitle: data.bill_title,
        },
      });
    } catch (err) {
      setError(err.message);
      setJoining(false);
    }
  };

  if (joining && !error) return <LoadingSpinner message="Joining the party..." />;

  return (
    <div className="join-page">
      <div className="join-container">
        <header className="brand-header"><span className="brand">settld</span></header>

        <div className="join-hero">
          <div className="join-icon"><span style={{ fontSize: 32 }}>🎉</span></div>
          <h1 className="join-title">You&rsquo;re Invited!</h1>
          <p className="join-subtitle">Enter your name to join the bill split</p>
        </div>

        <form onSubmit={handleJoin} className="join-form">
          <label htmlFor="nickname" className="join-label">Your Name</label>
          <input
            id="nickname"
            type="text"
            className="join-input"
            placeholder="e.g. Jane"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            autoFocus
            maxLength={50}
            required
          />

          {error && (
            <div className="join-error" role="alert">{error}</div>
          )}

          <button
            type="submit"
            className="action-btn join-btn"
            disabled={!nickname.trim() || joining}
          >
            {joining ? 'Joining...' : 'Join Party'}
          </button>
        </form>
      </div>
    </div>
  );
}
