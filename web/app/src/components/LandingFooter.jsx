import { Link } from 'react-router-dom';
import './LandingFooter.css';

export default function LandingFooter() {
  return (
    <footer className="lp-footer">
      <div className="container lp-footer-grid">
        <div className="lp-footer-brand">
          <Link to="/" className="lp-footer-logo" aria-label="Settld home">
            <span className="lp-footer-dot" aria-hidden="true" />
            <span>settld</span>
          </Link>
          <p>
            Bill-splitting that doesn't ruin dinner. Made in Brooklyn,
            settled everywhere.
          </p>
        </div>

        <div className="lp-footer-col">
          <h5>Product</h5>
          <ul>
            <li><a href="#features">Features</a></li>
            <li><a href="#how">How it works</a></li>
            <li><a href="#download">Download</a></li>
          </ul>
        </div>

        <div className="lp-footer-col">
          <h5>Company</h5>
          <ul>
            <li><Link to="/marketing">Press</Link></li>
            <li><a href="mailto:hello@settld.live">Contact</a></li>
          </ul>
        </div>

        <div className="lp-footer-col">
          <h5>Support</h5>
          <ul>
            <li><Link to="/support">Help center</Link></li>
            <li><Link to="/privacy">Privacy</Link></li>
            <li><a href="#">Terms</a></li>
          </ul>
        </div>
      </div>

      <div className="container lp-footer-bottom">
        <span>© {new Date().getFullYear()} Settld, Inc.</span>
        <span>v1.0.4 · Brooklyn → World</span>
      </div>
    </footer>
  );
}
