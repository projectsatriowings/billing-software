import React, { useState } from 'react';
import { BUSINESS_TYPES_META, type BusinessTypeMeta } from './businessTypes';

interface LandingPageProps {
  onNavigateLogin: () => void;
  onNavigateRegister: (businessType?: string) => void;
  user?: any;
  onNavigateDashboard?: () => void;
  onLogout?: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  onNavigateLogin,
  onNavigateRegister,
  user,
  onNavigateDashboard,
  onLogout,
}) => {
  const [activeFaq, setActiveFaq] = useState<number | null>(null);

  const toggleFaq = (index: number) => {
    setActiveFaq(activeFaq === index ? null : index);
  };

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const faqs = [
    {
      q: 'Can I use Adaptive Billing for both retail counter and wholesale distribution?',
      a: 'Yes! Adaptive Billing seamlessly adapts to both. For retail, enjoy fast barcode counter billing with thermal receipts. For wholesale, switch to A4 GST invoices with customer credit limits and vehicle numbers.',
    },
    {
      q: 'Do I need special hardware or barcode scanners?',
      a: 'No special hardware is required. It runs in any web browser and supports standard USB/Bluetooth barcode scanners, thermal receipt printers (58mm and 80mm), standard laser/inkjet printers, and weighing scales.',
    },
    {
      q: 'Is my business data isolated and secure from other businesses?',
      a: 'Absolutely. Every business runs in a strictly partitioned tenant container with encrypted authentication and role-based permissions. No business can ever view, query, or modify another store’s data.',
    },
    {
      q: 'Can cashiers access accounting or owner reports?',
      a: 'No. The built-in permission system restricts cashiers to counter billing and customer quick-add, preventing price modifications or viewing business financial summaries without manager or owner credentials.',
    },
    {
      q: 'Does it support offline billing if the internet drops?',
      a: 'Yes. The billing engine calculates pure deterministic integer GST offline in the browser and synchronizes sales automatically when the connection is restored.',
    },
  ];

  return (
    <div className="landing-wrapper">
      {/* Background Ambient Glow Lights */}
      <div className="ambient-glow glow-top" />
      <div className="ambient-glow glow-middle" />
      <div className="ambient-glow glow-bottom" />

      {/* Navbar with prominent Login & Register buttons */}
      <header className="landing-navbar">
        <div className="landing-nav-container">
          <div className="landing-brand" onClick={() => scrollToSection('hero')} style={{ cursor: 'pointer' }}>
            <span className="landing-brand-icon">⚡</span>
            <span className="landing-brand-name">Adaptive Billing</span>
            <span className="landing-brand-badge">SaaS OS 2.0</span>
          </div>

          <nav className="landing-nav-links">
            <button type="button" onClick={() => scrollToSection('hero')} className="nav-link-btn">Home</button>
            <button type="button" onClick={() => scrollToSection('features')} className="nav-link-btn">Features</button>
            <button type="button" onClick={() => scrollToSection('business-types')} className="nav-link-btn">Business Types</button>
            <button type="button" onClick={() => scrollToSection('pricing')} className="nav-link-btn">Pricing</button>
            <button type="button" onClick={() => scrollToSection('faq')} className="nav-link-btn">FAQ</button>
          </nav>

          <div className="landing-auth-buttons">
            <button
              type="button"
              onClick={onNavigateLogin}
              className="landing-btn-login"
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => onNavigateRegister('grocery')}
              className="landing-btn-register"
            >
              Register Your Business
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section id="hero" className="landing-hero-section">
        <div className="landing-hero-container">
          <div className="hero-text-content">
            <div className="hero-badge">
              <span className="hero-badge-star">✨</span>
              <span>Smart Billing for Growing Businesses</span>
            </div>

            <h1 className="hero-headline">
              One Billing Platform <br />
              for <span className="hero-highlight">Every Business</span>
            </h1>

            <p className="hero-subtext">
              Manage your sales, products, inventory, customers, and reports — all in one powerful, easy-to-use platform. Built for shops, stores, restaurants, pharmacies, and more.
            </p>

            <div className="hero-cta-group">
              <button
                type="button"
                onClick={() => onNavigateRegister('grocery')}
                className="hero-btn-primary"
              >
                <span>Register Your Business</span>
                <span className="btn-arrow">→</span>
              </button>
              <button
                type="button"
                onClick={onNavigateLogin}
                className="hero-btn-secondary"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}>
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                <span>Login to Account</span>
              </button>
            </div>

            <div className="hero-trust-row">
              <div className="trust-item">
                <span className="trust-check-bubble">✓</span>
                <span>Secure & Reliable</span>
              </div>
              <div className="trust-item">
                <span className="trust-check-bubble">✓</span>
                <span>Easy to Use</span>
              </div>
              <div className="trust-item">
                <span className="trust-check-bubble">✓</span>
                <span>Multi-Business Support</span>
              </div>
              <div className="trust-item">
                <span className="trust-check-bubble">✓</span>
                <span>24/7 Support</span>
              </div>
            </div>
          </div>

          {/* Hero Visual Mockup from Image 1 */}
          <div className="hero-visual-wrapper">
            <div className="device-mockup-frame">
              {/* Mockup Dashboard Shell */}
              <div className="mockup-inner-dashboard">
                {/* Left Mini Sidebar */}
                <div className="mockup-inner-sidebar">
                  <div className="mockup-sidebar-brand">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <polygon points="12 2 2 22 22 22" fill="#6D4AFF" />
                      <polygon points="12 6 5 20 19 20" fill="#312E81" />
                    </svg>
                    <span>Adaptive Billing</span>
                  </div>
                  <div className="mockup-nav-item active">
                    <span>📊</span>
                    <span>Dashboard</span>
                  </div>
                  <div className="mockup-nav-item">
                    <span>🛒</span>
                    <span>Sales</span>
                  </div>
                  <div className="mockup-nav-item">
                    <span>📦</span>
                    <span>Inventory</span>
                  </div>
                  <div className="mockup-nav-item">
                    <span>👥</span>
                    <span>Customers</span>
                  </div>
                  <div className="mockup-nav-item">
                    <span>🚚</span>
                    <span>Suppliers</span>
                  </div>
                  <div className="mockup-nav-item">
                    <span>📈</span>
                    <span>Reports</span>
                  </div>
                  <div className="mockup-nav-item">
                    <span>⚙️</span>
                    <span>Settings</span>
                  </div>
                </div>

                {/* Main Dashboard Screen */}
                <div className="mockup-inner-main">
                  {/* Search Bar & User Profile */}
                  <div className="mockup-top-search-row">
                    <div className="mockup-search-fake">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <circle cx="11" cy="11" r="8"/>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                      </svg>
                      <span>Search...</span>
                    </div>
                    <div className="mockup-user-fake">
                      <div className="mockup-avatar-circle">JD</div>
                      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
                        <span style={{ fontSize: '0.68rem', fontWeight: 800 }}>John Doe</span>
                        <span style={{ fontSize: '0.58rem', color: '#64748b' }}>Owner / User</span>
                      </div>
                      <span style={{ fontSize: '0.6rem', color: '#94a3b8' }}>▼</span>
                    </div>
                  </div>

                  {/* Greeting & Date */}
                  <div className="mockup-greeting-row">
                    <div className="mockup-greeting-text">
                      <h4>Good Morning, John!</h4>
                      <p>Here's what's happening with your business today.</p>
                    </div>
                    <div className="mockup-date-pill">
                      <span>Today, 14 Apr 2025</span>
                      <span style={{ fontSize: '0.6rem', marginLeft: '4px' }}>▼</span>
                    </div>
                  </div>

                  {/* 3 KPI Metric Cards */}
                  <div className="mockup-metric-cards-row">
                    <div className="mockup-metric-card">
                      <div className="metric-header">
                        <span>Total Sales</span>
                        <span style={{ color: '#6d4aff', fontSize: '0.8rem' }}>📊</span>
                      </div>
                      <div className="metric-val">₹45,720</div>
                      <div className="metric-badge">↑ 12% from last week</div>
                    </div>

                    <div className="mockup-metric-card">
                      <div className="metric-header">
                        <span>Total Invoices</span>
                        <span style={{ color: '#a78bfa', fontSize: '0.8rem' }}>🧾</span>
                      </div>
                      <div className="metric-val">24</div>
                      <div className="metric-badge">↑ 8% from last week</div>
                    </div>

                    <div className="mockup-metric-card">
                      <div className="metric-header">
                        <span>Total Customers</span>
                        <span style={{ color: '#10b981', fontSize: '0.8rem' }}>👥</span>
                      </div>
                      <div className="metric-val">120</div>
                      <div className="metric-badge">↑ 15% from last week</div>
                    </div>
                  </div>

                  {/* Middle Charts & Activities */}
                  <div className="mockup-charts-row">
                    {/* Sales Overview Chart */}
                    <div className="mockup-chart-card">
                      <div className="card-mini-title">
                        <span>Sales Overview</span>
                        <span style={{ fontSize: '0.62rem', color: '#64748b', fontWeight: 600 }}>Last 7 days ▼</span>
                      </div>
                      <div className="mockup-svg-chart-wrapper" style={{ position: 'relative', height: '110px' }}>
                        <svg viewBox="0 0 280 110" width="100%" height="100%" preserveAspectRatio="none">
                          <defs>
                            <linearGradient id="purpleAreaGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#6D4AFF" stopOpacity="0.32" />
                              <stop offset="70%" stopColor="#A78BFA" stopOpacity="0.1" />
                              <stop offset="100%" stopColor="#ffffff" stopOpacity="0.0" />
                            </linearGradient>
                          </defs>
                          {/* Grid Lines */}
                          <line x1="25" y1="18" x2="275" y2="18" stroke="#f1f5f9" strokeWidth="1" strokeDasharray="3 3"/>
                          <line x1="25" y1="42" x2="275" y2="42" stroke="#f1f5f9" strokeWidth="1" strokeDasharray="3 3"/>
                          <line x1="25" y1="68" x2="275" y2="68" stroke="#f1f5f9" strokeWidth="1" strokeDasharray="3 3"/>
                          <line x1="25" y1="92" x2="275" y2="92" stroke="#e2e8f0" strokeWidth="1"/>

                          {/* Y-Axis Labels */}
                          <text x="5" y="22" fill="#94a3b8" fontSize="6" fontFamily="sans-serif">60k</text>
                          <text x="5" y="46" fill="#94a3b8" fontSize="6" fontFamily="sans-serif">40k</text>
                          <text x="5" y="72" fill="#94a3b8" fontSize="6" fontFamily="sans-serif">20k</text>
                          <text x="5" y="94" fill="#94a3b8" fontSize="6" fontFamily="sans-serif">0</text>

                          {/* Chart Area Fill */}
                          <path
                            d="M 30,86 C 50,84 65,72 80,70 C 95,68 110,65 130,55 C 150,45 170,52 190,48 C 210,44 235,38 250,28 C 265,20 270,18 275,15 L 275,92 L 30,92 Z"
                            fill="url(#purpleAreaGrad)"
                          />
                          {/* Chart Line */}
                          <path
                            d="M 30,86 C 50,84 65,72 80,70 C 95,68 110,65 130,55 C 150,45 170,52 190,48 C 210,44 235,38 250,28 C 265,20 270,18 275,15"
                            fill="none"
                            stroke="#6D4AFF"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                          />
                          {/* Data points */}
                          <circle cx="80" cy="70" r="3" fill="#ffffff" stroke="#6D4AFF" strokeWidth="2"/>
                          <circle cx="130" cy="55" r="3" fill="#ffffff" stroke="#6D4AFF" strokeWidth="2"/>
                          <circle cx="190" cy="48" r="3" fill="#ffffff" stroke="#6D4AFF" strokeWidth="2"/>
                          <circle cx="250" cy="28" r="3" fill="#ffffff" stroke="#6D4AFF" strokeWidth="2"/>
                        </svg>
                        <div style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: '25px', fontSize: '0.55rem', color: '#94a3b8', marginTop: '2px' }}>
                          <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
                        </div>
                      </div>
                    </div>

                    {/* Recent Activities */}
                    <div className="mockup-activity-card">
                      <div className="card-mini-title">
                        <span>Recent Activities</span>
                      </div>
                      <div className="mockup-activity-list">
                        <div className="activity-item">
                          <span className="act-icon-circle green">🛒</span>
                          <div>
                            <strong>New sale #INV-1008</strong>
                            <div><span>₹2,400 • 2 hours ago</span></div>
                          </div>
                        </div>
                        <div className="activity-item">
                          <span className="act-icon-circle amber">📦</span>
                          <div>
                            <strong>Product added</strong>
                            <div><span>Organic Rice • 3 hours ago</span></div>
                          </div>
                        </div>
                        <div className="activity-item">
                          <span className="act-icon-circle blue">👤</span>
                          <div>
                            <strong>Customer registered</strong>
                            <div><span>Ramesh Kumar • 4 hours ago</span></div>
                          </div>
                        </div>
                        <div className="activity-item">
                          <span className="act-icon-circle rose">⚠️</span>
                          <div>
                            <strong>Stock alert</strong>
                            <div><span>Milk Powder • Low stock</span></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom Category Quick Strip */}
              <div className="mockup-category-strip">
                <div className="category-mini-chip" onClick={() => onNavigateRegister('grocery')}>
                  <div className="category-mini-chip-icon" style={{ background: '#fdf2f8', color: '#db2777' }}>🏪</div>
                  <div>
                    <strong style={{ display: 'block', fontSize: '0.68rem', color: '#1e1b4b' }}>Retail Shop</strong>
                    <span style={{ fontSize: '0.58rem', color: '#64748b' }}>POS & Billing</span>
                  </div>
                </div>
                <div className="category-mini-chip" onClick={() => onNavigateRegister('pharmacy')}>
                  <div className="category-mini-chip-icon" style={{ background: '#eff6ff', color: '#2563eb' }}>➕</div>
                  <div>
                    <strong style={{ display: 'block', fontSize: '0.68rem', color: '#1e1b4b' }}>Pharmacy</strong>
                    <span style={{ fontSize: '0.58rem', color: '#64748b' }}>Medicine & Health</span>
                  </div>
                </div>
                <div className="category-mini-chip" onClick={() => onNavigateRegister('restaurant')}>
                  <div className="category-mini-chip-icon" style={{ background: '#fff7ed', color: '#ea580c' }}>🍴</div>
                  <div>
                    <strong style={{ display: 'block', fontSize: '0.68rem', color: '#1e1b4b' }}>Restaurant</strong>
                    <span style={{ fontSize: '0.58rem', color: '#64748b' }}>Dine In & Takeaway</span>
                  </div>
                </div>
                <div className="category-mini-chip" onClick={() => onNavigateRegister('clothing')}>
                  <div className="category-mini-chip-icon" style={{ background: '#fdf2f8', color: '#c026d3' }}>👗</div>
                  <div>
                    <strong style={{ display: 'block', fontSize: '0.68rem', color: '#1e1b4b' }}>Clothing</strong>
                    <span style={{ fontSize: '0.58rem', color: '#64748b' }}>Fashion & Apparel</span>
                  </div>
                </div>
                <div className="category-mini-chip" onClick={() => onNavigateRegister('electronics')}>
                  <div className="category-mini-chip-icon" style={{ background: '#f0fdf4', color: '#16a34a' }}>💻</div>
                  <div>
                    <strong style={{ display: 'block', fontSize: '0.68rem', color: '#1e1b4b' }}>Electronics</strong>
                    <span style={{ fontSize: '0.58rem', color: '#64748b' }}>Gadgets & More</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Business Types Section from Image 1 */}
      <section id="business-types" className="landing-business-types-section">
        <div className="section-header-top-row">
          <div>
            <span className="section-badge-pill">Choose Your Business Type</span>
            <h2 className="section-main-heading">Explore Business Types</h2>
            <p className="section-subtext">
              Select your business type and get started with the right features, fields and modules tailored for your needs.
            </p>
          </div>
          <button
            type="button"
            className="view-all-link"
            onClick={() => onNavigateRegister('grocery')}
          >
            <span>View All Business Types</span>
            <span style={{ marginLeft: '4px' }}>→</span>
          </button>
        </div>

        <div className="business-cards-grid">
          {BUSINESS_TYPES_META.map((b: BusinessTypeMeta) => (
            <div
              key={b.id}
              className="business-type-card"
              onClick={() => onNavigateRegister(b.id)}
            >
              <div className="card-top-header">
                <div className="card-icon-squircle" style={{ background: `linear-gradient(135deg, ${b.badgeColor}18, ${b.badgeColor}30)` }}>
                  <span className="type-icon">{b.icon}</span>
                </div>
              </div>

              <h3 className="card-type-title">{b.title}</h3>
              <p className="card-type-desc">{b.shortDesc}</p>

              <div className="card-action-footer">
                <span className="card-register-link">
                  <span>Register Now</span>
                  <span className="btn-chevron">→</span>
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 3 Pillars of Adaptive Billing */}
      <section className="landing-pillars-section">
        <div className="section-header-centered">
          <span className="section-badge-pill">Enterprise Grade Foundation</span>
          <h2 className="section-main-heading">The 3 Pillars of Adaptive Billing</h2>
          <p className="section-subtext">Built specifically to solve the biggest challenges in Indian retail & multi-trade SaaS.</p>
        </div>

        <div className="pillars-container">
          <div className="pillar-item">
            <div className="pillar-num-badge">01</div>
            <div className="pillar-icon-box">📐</div>
            <h3 className="pillar-title">Pure Integer Math (No GST Drift)</h3>
            <p className="pillar-desc">
              All currency and taxes are stored and calculated in integers (paise & basis points). Prevents rounding discrepancies across CGST, SGST, IGST and ensures 100% audit-proof GSTR-1 filings.
            </p>
          </div>

          <div className="pillar-item">
            <div className="pillar-num-badge">02</div>
            <div className="pillar-icon-box">🛡️</div>
            <h3 className="pillar-title">Strict Multi-Tenant Isolation</h3>
            <p className="pillar-desc">
              Each registered store is isolated in a cryptographically scoped database container. Even with hundreds of stores, a business cannot see, query, or affect another store’s catalog, invoices, or revenue.
            </p>
          </div>

          <div className="pillar-item">
            <div className="pillar-num-badge">03</div>
            <div className="pillar-icon-box">⚡</div>
            <h3 className="pillar-title">Context-Adaptive POS Interface</h3>
            <p className="pillar-desc">
              One shared engine that adapts dynamically: Pharmacy gets Batch/Expiry/Prescriptions, Restaurant gets KOT/Tables, Apparel gets Size/Colour variants, and Wholesale gets Bulk Sacks and B2B Invoicing.
            </p>
          </div>
        </div>
      </section>

      {/* Core Features Showcase */}
      <section id="features" className="landing-features-showcase-section">
        <div className="section-header-centered">
          <span className="section-badge-pill">Powering Thousands of Counters</span>
          <h2 className="section-main-heading">Everything You Need to Run Your Store</h2>
          <p className="section-subtext">From barcode checkout to GSTR-1 reports, everything is integrated into one fast dashboard.</p>
        </div>

        <div className="features-showcase-grid">
          <div className="feature-card">
            <div className="feat-icon-bubble">⚡</div>
            <h4 className="feat-title">Sub-Second POS Counter</h4>
            <p className="feat-desc">Rapid barcode scanner integration, quick cash & UPI QR checkout, keyboard shortcuts, and 58mm/80mm thermal receipt printing.</p>
          </div>

          <div className="feature-card">
            <div className="feat-icon-bubble">📦</div>
            <h4 className="feat-title">Smart Batch & Expiry Tracking</h4>
            <p className="feat-desc">FEFO (First-Expiry-First-Out) inventory dispatching with automated alerts for near-expiry medicines, FMCG, and packaged items.</p>
          </div>

          <div className="feature-card">
            <div className="feat-icon-bubble">👥</div>
            <h4 className="feat-title">Customer Directory & Accounts</h4>
            <p className="feat-desc">Track customer balances, payment receipts, send instant WhatsApp bills, and manage wholesale buyers.</p>
          </div>

          <div className="feature-card">
            <div className="feat-icon-bubble">📊</div>
            <h4 className="feat-title">GSTR-1 & Financial Reports</h4>
            <p className="feat-desc">Instant sales summaries, cashier day-end shift closure totals, tax-breakdown reports (CGST/SGST/IGST), and CSV export for accountants.</p>
          </div>

          <div className="feature-card">
            <div className="feat-icon-bubble">🏢</div>
            <h4 className="feat-title">Multi-Store & Chain Management</h4>
            <p className="feat-desc">Own a grocery shop, pharmacy, and restaurant? Switch seamlessly between all your businesses from one unified login with zero cross-tenant contamination.</p>
          </div>

          <div className="feature-card">
            <div className="feat-icon-bubble">🔒</div>
            <h4 className="feat-title">Role-Based Cashier Security</h4>
            <p className="feat-desc">Enforce role-based access control. Cashiers can scan and print receipts, while profit margins, inventory costs, and reports require owner credentials.</p>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="landing-pricing-section">
        <div className="section-header-centered">
          <span className="section-badge-pill">Simple & Transparent</span>
          <h2 className="section-main-heading">Transparent Pricing for Growing Businesses</h2>
          <p className="section-subtext">No hidden fees, no per-transaction commissions. Upgrade as your store network expands.</p>
        </div>

        <div className="pricing-grid">
          <div className="pricing-card">
            <span className="pricing-tier-name">Free Starter</span>
            <div className="price-tag">
              <span className="price-currency">₹</span>
              <strong className="price-amount">0</strong>
              <span className="price-duration">/month</span>
            </div>
            <p className="pricing-desc">Perfect for single-counter retail shops and small kirana stores getting started.</p>
            <ul className="pricing-feature-list">
              <li>✓ Single Counter POS Billing</li>
              <li>✓ Up to 500 Inventory Items</li>
              <li>✓ Thermal Receipt Printing</li>
              <li>✓ 100% Integer GST Calculation</li>
              <li>✓ Customer Account Ledger</li>
            </ul>
            <button type="button" onClick={() => onNavigateRegister('grocery')} className="pricing-cta-btn secondary">
              Get Started Free
            </button>
          </div>

          <div className="pricing-card featured">
            <div className="pricing-popular-badge">MOST POPULAR</div>
            <span className="pricing-tier-name">Growth Pro</span>
            <div className="price-tag">
              <span className="price-currency">₹</span>
              <strong className="price-amount">999</strong>
              <span className="price-duration">/month</span>
            </div>
            <p className="pricing-desc">Ideal for busy supermarkets, pharmacies, apparel stores & restaurants.</p>
            <ul className="pricing-feature-list">
              <li>✓ Unlimited Counters & Devices</li>
              <li>✓ Unlimited Items & Barcodes</li>
              <li>✓ Batch & Expiry FEFO Tracking</li>
              <li>✓ Table Management & KOT Dispatch</li>
              <li>✓ Automated WhatsApp Invoicing</li>
              <li>✓ GSTR-1 Excel / CSV Reports</li>
              <li>✓ Cashier Role Permissions</li>
            </ul>
            <button type="button" onClick={() => onNavigateRegister('grocery')} className="pricing-cta-btn primary">
              Start Free 14-Day Trial
            </button>
          </div>

          <div className="pricing-card">
            <span className="pricing-tier-name">Multi-Store Enterprise</span>
            <div className="price-tag">
              <span className="price-currency">₹</span>
              <strong className="price-amount">2,499</strong>
              <span className="price-duration">/month</span>
            </div>
            <p className="pricing-desc">For retail chains, wholesale distributors & multi-brand store owners.</p>
            <ul className="pricing-feature-list">
              <li>✓ Up to 10 Stores / Outlets</li>
              <li>✓ Multi-Tenant Switcher Included</li>
              <li>✓ Centralized Master Catalog</li>
              <li>✓ Inter-Store Stock Movement</li>
              <li>✓ Custom Invoice Branding</li>
              <li>✓ Priority Phone & On-Site Support</li>
            </ul>
            <button type="button" onClick={() => onNavigateRegister('wholesale')} className="pricing-cta-btn secondary">
              Contact Sales
            </button>
          </div>
        </div>
      </section>

      {/* FAQ Accordion */}
      <section id="faq" className="landing-faq-section">
        <div className="section-header-centered">
          <span className="section-badge-pill">Common Questions</span>
          <h2 className="section-main-heading">Frequently Asked Questions</h2>
          <p className="section-subtext">Everything you need to know about our multi-trade billing platform.</p>
        </div>

        <div className="faq-accordion-list">
          {faqs.map((faq, idx) => {
            const isOpen = activeFaq === idx;
            return (
              <div
                key={idx}
                className={`faq-item ${isOpen ? 'open' : ''}`}
                onClick={() => toggleFaq(idx)}
              >
                <div className="faq-question-row">
                  <span className="faq-q-text">{faq.q}</span>
                  <span className="faq-toggle-icon">{isOpen ? '−' : '+'}</span>
                </div>
                {isOpen && (
                  <div className="faq-answer-pane">
                    <p>{faq.a}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* CTA Bottom Banner */}
      <section className="landing-cta-banner">
        <div className="cta-banner-content-split">
          <div className="cta-banner-left">
            <div className="cta-store-icon-bubble">
              🏪
            </div>
            <div className="cta-banner-text">
              <h2>Ready to Grow Your Business?</h2>
              <p>Join thousands of business owners who trust Adaptive Billing.</p>
            </div>
          </div>

          <div className="cta-banner-center-actions">
            <button
              type="button"
              onClick={() => onNavigateRegister('grocery')}
              className="banner-btn-primary"
            >
              Register Your Business →
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('faq')}
              className="banner-btn-secondary"
            >
              <span style={{ marginRight: '6px' }}>🎧</span> Contact Support
            </button>
          </div>

          <div className="cta-banner-stats">
            <div className="cta-stat-item">
              <span className="cta-stat-num">10K+</span>
              <span className="cta-stat-lbl">Happy Businesses</span>
            </div>
            <div className="cta-stat-item">
              <span className="cta-stat-num">50K+</span>
              <span className="cta-stat-lbl">Daily Transactions</span>
            </div>
            <div className="cta-stat-item">
              <span className="cta-stat-num">99.9%</span>
              <span className="cta-stat-lbl">Uptime</span>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="footer-container">
          <div className="footer-brand-col">
            <div className="footer-brand">
              <span className="footer-brand-icon">⚡</span>
              <span className="footer-brand-title">Adaptive Billing</span>
            </div>
            <p className="footer-brand-tagline">
              India-first cloud POS and billing operating system for retail, healthcare, hospitality, and wholesale businesses.
            </p>
            <div className="footer-status-indicator">
              <span className="status-dot green" />
              <span>All Systems Operational • GST 2026 Ready</span>
            </div>
          </div>

          <div className="footer-links-col">
            <h5 className="footer-col-heading">Business Types</h5>
            <ul className="footer-list">
              <li><button type="button" onClick={() => onNavigateRegister('grocery')}>Grocery & Supermarket</button></li>
              <li><button type="button" onClick={() => onNavigateRegister('pharmacy')}>Pharmacy & Medicals</button></li>
              <li><button type="button" onClick={() => onNavigateRegister('clothing')}>Clothing & Textiles</button></li>
              <li><button type="button" onClick={() => onNavigateRegister('restaurant')}>Restaurant & Cafe</button></li>
              <li><button type="button" onClick={() => onNavigateRegister('wholesale')}>Wholesale & Distribution</button></li>
            </ul>
          </div>

          <div className="footer-links-col">
            <h5 className="footer-col-heading">Platform</h5>
            <ul className="footer-list">
              <li><button type="button" onClick={() => scrollToSection('features')}>Core POS Features</button></li>
              <li><button type="button" onClick={() => scrollToSection('pricing')}>Pricing Plans</button></li>
              <li><button type="button" onClick={() => scrollToSection('faq')}>Help & FAQ</button></li>
              <li><button type="button" onClick={onNavigateLogin}>Merchant Sign In</button></li>
              <li><button type="button" onClick={() => onNavigateRegister('other')}>Other Trade Registration</button></li>
            </ul>
          </div>

          <div className="footer-links-col">
            <h5 className="footer-col-heading">Security & Trust</h5>
            <p className="footer-trust-text">
              Built with zero-trust multi-tenant isolation, cryptographic passwords, and 100% deterministic integer tax calculations.
            </p>
            <p className="footer-copy">© 2026 Adaptive Billing Platform. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};
