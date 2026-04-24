import { useState } from 'react';
import Nav from '../components/Nav.jsx';
import LandingFooter from '../components/LandingFooter.jsx';

import heroBG from '../assets/heroBG.png';

import './LandingPage.css';

const FAQ_ITEMS = [
  {
    q: 'Do my friends need to download Settld?',
    a: 'No. They pay through a link in their browser using Apple Pay, Google Pay, Venmo, or card. Only the host needs the app.',
  },
  {
    q: 'What does it cost?',
    a: 'Settld is free for personal use. We take a 1.5% platform fee on card transactions, paid by the host \u2014 never the friend paying you back.',
  },
  {
    q: 'Can it scan handwritten receipts?',
    a: 'Yes. Our OCR handles thermal printer paper, PDFs, and most legible handwriting. If something looks off, you can edit any line item before sharing.',
  },
  {
    q: 'Is my data secure?',
    a: 'Payment processing runs on Stripe. We never store full card numbers. Receipt photos are encrypted at rest and you can delete them at any time.',
  },
  {
    q: 'Android?',
    a: 'Coming Q3. Join the waitlist at the bottom of this page and we\u2019ll send you a TestFlight-style build the moment it\u2019s ready.',
  },
];

const MARQUEE_ITEMS = [
  { text: 'Scan the receipt' },
  { text: 'Tap to ', em: 'assign' },
  { text: 'Share the link' },
  { text: 'Get ', em: 'paid' },
  { text: 'No more spreadsheets' },
  { text: 'No more ', em: 'awkward', tail: ' texts' },
];

export default function LandingPage() {
  return (
    <div className="lp-root">
      <Nav variant="dark-editorial" />

      {/* ── Hero ────────────────────────────────────────────── */}
      <header
        className="lp-hero"
        style={{ backgroundImage: `url(${heroBG})` }}
      >
        <div className="lp-hero-scrim" aria-hidden="true" />
        <div className="lp-hero-grain" aria-hidden="true" />
        <div className="container lp-hero-inner">
          <div className="lp-hero-copy">
            <span className="lp-eyebrow">
              <span className="lp-pulse" aria-hidden="true" />
              Now in TestFlight · v1.0
            </span>
            <h1 className="lp-h1">
              Split the bill,<br />
              not the <em>friendship</em>.
            </h1>
            <p className="lp-hero-sub">
              Settld scans the receipt, assigns items per person, and chases
              the awkward Venmo requests for you. You eat. We do the math.
            </p>
            <div className="lp-hero-cta">
              <a href="#download" className="lp-btn lp-btn-primary">Download for iOS →</a>
              <a href="#how" className="lp-btn">Watch the demo</a>
            </div>
            <div className="lp-hero-meta">
              <span><b>4.9 ★</b> · 12k reviews</span>
              <span><b>$2.4M</b> settled this month</span>
              <span><b>No subscription</b> · ever</span>
            </div>
          </div>
        </div>
      </header>

      {/* ── Marquee ─────────────────────────────────────────── */}
      <div className="lp-marquee" aria-hidden="true">
        <div className="lp-marquee-track">
          {[0, 1].map((loop) => (
            MARQUEE_ITEMS.map((m, i) => (
              <span key={`${loop}-${i}`} className="lp-marquee-item">
                {m.text}
                {m.em && <em>{m.em}</em>}
                {m.tail}
              </span>
            ))
          ))}
        </div>
      </div>

      {/* ── How it works ────────────────────────────────────── */}
      <section id="how" className="lp-section">
        <div className="container">
          <div className="lp-section-head">
            <div className="lp-section-eyebrow">— How it works</div>
            <h2 className="lp-section-title">
              Three taps from <em>dinner</em> to <em>done</em>.
            </h2>
          </div>

          <div className="lp-steps">
            <article className="lp-step">
              <div className="lp-step-num">01 — CAPTURE</div>
              <h3 className="lp-step-title">Snap the <em>receipt</em>.</h3>
              <p className="lp-step-desc">
                Photograph any paper or digital bill. Our OCR pulls every line item, tax, and tip in under two seconds.
              </p>
              <div className="lp-step-visual lp-receipt">
                <div className="lp-receipt-row"><span>Chicken Critter</span><span>15.99</span></div>
                <div className="lp-receipt-row"><span>Margarita ×2</span><span>18.00</span></div>
                <div className="lp-receipt-row"><span>Side Caesar</span><span>6.50</span></div>
                <div className="lp-receipt-row"><span>Tax + Tip</span><span>9.43</span></div>
                <div className="lp-receipt-row lp-receipt-total"><span>TOTAL</span><span>49.92</span></div>
              </div>
            </article>

            <article className="lp-step">
              <div className="lp-step-num">02 — ASSIGN</div>
              <h3 className="lp-step-title"><em>Tap</em> who ordered what.</h3>
              <p className="lp-step-desc">
                Drag items to people. Split shared plates evenly with a single gesture. Everyone sees the math, in real time.
              </p>
              <div className="lp-step-visual lp-assign">
                <span className="lp-chip">Arjun · $8.00</span>
                <span className="lp-chip">Jane · $8.00</span>
                <span className="lp-chip lp-chip-dim">Marco · 0</span>
                <span className="lp-chip lp-chip-dim">+ shared plate</span>
                <span className="lp-chip">Arjun · $4.50</span>
                <span className="lp-chip">Jane · $4.50</span>
              </div>
            </article>

            <article className="lp-step">
              <div className="lp-step-num">03 — COLLECT</div>
              <h3 className="lp-step-title">We <em>chase</em> the rest.</h3>
              <p className="lp-step-desc">
                Send a single link. Friends pay via Apple Pay, Venmo, or card — no app install required. We nudge the late ones.
              </p>
              <div className="lp-step-visual lp-progress">
                <div className="lp-progress-row"><span>$39.04 collected</span><span>$10.88 left</span></div>
                <div className="lp-progress-bar"><div className="lp-progress-fill" /></div>
                <div className="lp-progress-row lp-muted"><span>4 of 5 paid</span><span>78%</span></div>
              </div>
            </article>
          </div>
        </div>
      </section>

      {/* ── Features (bento) ────────────────────────────────── */}
      <section id="features" className="lp-section">
        <div className="container">
          <div className="lp-section-head">
            <div className="lp-section-eyebrow">— What's inside</div>
            <h2 className="lp-section-title">
              Built for the <em>awkward</em> in-between.
            </h2>
          </div>

          <div className="lp-bento">
            <article className="lp-feat lp-feat-big">
              <div className="lp-feat-tag">SMART SPLIT</div>
              <h3>Split by item, share, or <em>vibes</em>.</h3>
              <p>
                Even splits, percentage splits, line-item splits, custom splits.
                Whatever the table negotiated, Settld math'd it before dessert arrived.
              </p>
            </article>

            <article className="lp-feat">
              <div className="lp-feat-tag">ONE LINK</div>
              <h3>Share a link. <em>Anywhere</em>.</h3>
              <p>iMessage, WhatsApp, email, AirDrop. Recipients pay through the link — they never have to install Settld.</p>
            </article>

            <article className="lp-feat">
              <div className="lp-feat-tag">RECEIPT OCR</div>
              <h3><em>Scan</em> any receipt.</h3>
              <p>From CVS to Carbone — itemized in 2 seconds.</p>
            </article>

            <article className="lp-feat">
              <div className="lp-feat-tag">PAYMENT TRACKING</div>
              <h3>Know who <em>owes</em>, instantly.</h3>
              <p>Live status per friend. Auto-nudges. Zero spreadsheet.</p>
            </article>

            <article className="lp-feat">
              <div className="lp-feat-tag">CASH MODE</div>
              <h3>Someone paid in <em>cash</em>?</h3>
              <p>Mark them paid manually. Settld closes the loop either way.</p>
            </article>
          </div>
        </div>
      </section>

      {/* ── Quote ───────────────────────────────────────────── */}
      <section className="lp-quote-section">
        <div className="container lp-quote">
          <div className="lp-section-eyebrow">— A REAL DM</div>
          <p className="lp-quote-text">
            "I sent the link, walked to the bathroom, and by the time I got back
            <em> three of four </em>people had paid. The fourth got a polite reminder I didn't have to send."
          </p>
          <div className="lp-quote-attr">
            <span className="lp-avatar">M</span>
            <span><b>Maya R.</b> · Brooklyn, NY · using Settld since beta</span>
          </div>
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────── */}
      <section id="faq" className="lp-section">
        <div className="container">
          <div className="lp-section-head">
            <div className="lp-section-eyebrow">— FAQ</div>
            <h2 className="lp-section-title">Questions, <em>answered</em>.</h2>
          </div>
          <div className="lp-faq">
            {FAQ_ITEMS.map((it) => <FaqItem key={it.q} q={it.q} a={it.a} />)}
          </div>
        </div>
      </section>

      {/* ── CTA + wordmark ──────────────────────────────────── */}
      <section id="download" className="lp-cta">
        <h2 className="lp-cta-title">Settld <em>it</em>.</h2>
        <p className="lp-cta-sub">Free forever for personal bills. Download takes 12 seconds.</p>
        <div className="lp-cta-buttons">
          <a href="#" className="lp-btn lp-btn-primary">Download for iOS →</a>
          <a href="#" className="lp-btn">Join Android waitlist</a>
        </div>
      </section>

      <div className="lp-wordmark" aria-hidden="true">settl<em>d</em>.</div>

      <LandingFooter />
    </div>
  );
}

function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={`lp-faq-item ${open ? 'is-open' : ''}`}
      onClick={() => setOpen((v) => !v)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setOpen((v) => !v);
        }
      }}
    >
      <div className="lp-faq-q">
        <span>{q}</span>
        <span className="lp-faq-toggle" aria-hidden="true">{open ? '×' : '+'}</span>
      </div>
      {open && <div className="lp-faq-a">{a}</div>}
    </div>
  );
}
