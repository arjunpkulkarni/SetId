import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import logo from '../assets/logo.png';
import './Nav.css';

export default function Nav({ variant = 'light' }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => setOpen(false), [location.pathname]);

  const isLanding = location.pathname === '/';
  const isEditorial = variant === 'dark-editorial';

  const classes = [
    'nav',
    `nav-${variant}`,
    scrolled ? 'nav-scrolled' : '',
    open ? 'nav-open' : '',
  ].filter(Boolean).join(' ');

  return (
    <header className={classes}>
      <div className="nav-inner container">
        <Link to="/" className="nav-brand" aria-label="Settld home">
          {isEditorial ? (
            <img src={logo} alt="" className="nav-logo-img" />
          ) : (
            <span className="nav-logo-shell">
              <img src={logo} alt="" />
            </span>
          )}
          <span className="nav-wordmark">{isEditorial ? 'settld' : 'Settld.'}</span>
        </Link>

        <nav className="nav-links" aria-label="Primary">
          {isLanding ? (
            <>
              <a href="#how" className="nav-link">How it works</a>
              <a href="#features" className="nav-link">Features</a>
              <a href="#faq" className="nav-link">FAQ</a>
            </>
          ) : (
            <>
              <NavLink to="/" className="nav-link">Home</NavLink>
              <NavLink to="/support" className="nav-link">Support</NavLink>
              <NavLink to="/marketing" className="nav-link">Press</NavLink>
            </>
          )}
          {!isEditorial && (
            <Link to="/support" className="nav-link nav-link-sm">Support</Link>
          )}
        </nav>

        <div className="nav-cta">
          {isEditorial && (
            <a href="#download" className="nav-link nav-link-quiet">Sign in</a>
          )}
          <a href="#download" className="btn btn-primary nav-cta-btn">
            {isEditorial ? 'Get the app →' : 'Get the app'}
          </a>
        </div>

        <button
          type="button"
          className="nav-burger"
          aria-label="Menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span></span>
          <span></span>
        </button>
      </div>

      {open && (
        <div className="nav-drawer">
          {isLanding && (
            <>
              <a href="#how" className="nav-drawer-link">How it works</a>
              <a href="#features" className="nav-drawer-link">Features</a>
              <a href="#faq" className="nav-drawer-link">FAQ</a>
            </>
          )}
          <Link to="/support" className="nav-drawer-link">Support</Link>
          <Link to="/marketing" className="nav-drawer-link">Press</Link>
          <Link to="/privacy" className="nav-drawer-link">Privacy</Link>
          <a href="#download" className="btn btn-primary nav-drawer-cta">Get the app</a>
        </div>
      )}
    </header>
  );
}
