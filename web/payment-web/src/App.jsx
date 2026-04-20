import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import PaymentPage from './pages/PaymentPage';
import PartyJoinPage from './pages/PartyJoinPage';
import PartyReceiptPage from './pages/PartyReceiptPage';
import PartyPayPage from './pages/PartyPayPage';
import SuccessPage from './pages/SuccessPage';
import ErrorPage from './pages/ErrorPage';
import './App.css';

function App() {
  return (
    <Router>
      <Routes>
        {/* Home: enter invite code */}
        <Route path="/" element={<HomePage />} />

        {/* Flow 2: Party / Guest invite */}
        <Route path="/join/:token" element={<PartyJoinPage />} />
        <Route path="/join/:token/receipt" element={<PartyReceiptPage />} />
        <Route path="/join/:token/pay" element={<PartyPayPage />} />
        <Route path="/party/:token" element={<PartyJoinPage />} />
        <Route path="/party/:token/receipt" element={<PartyReceiptPage />} />
        <Route path="/party/:token/pay" element={<PartyPayPage />} />

        {/* Flow 3: Public pay link */}
        <Route path="/pay/:token" element={<PaymentPage />} />

        {/* Shared */}
        <Route path="/success" element={<SuccessPage />} />
        <Route path="/error" element={<ErrorPage />} />
        <Route path="*" element={<HomePage />} />
      </Routes>
    </Router>
  );
}

export default App;
