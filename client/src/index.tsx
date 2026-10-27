import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { MobileScanner } from './components/MobileScanner';
import { CustomerDisplay } from './components/CustomerDisplay';
import './index.css';

// Safety error listener to prevent silent blank screens on mobile devices
window.addEventListener('error', (e) => {
  console.error('Uncaught error:', e.error || e.message);
  const container = document.getElementById('root');
  if (container && (!container.children.length || container.innerHTML.trim() === '')) {
    container.innerHTML = `
      <div style="padding:24px;background:#0f172a;color:#f8fafc;font-family:sans-serif;min-height:100vh;box-sizing:border-box;">
        <h2 style="color:#f87171;margin-top:0;">Scanner Loading Notice</h2>
        <p style="color:#cbd5e1;line-height:1.5;">${e.message || 'An unexpected issue occurred while initializing the scanner.'}</p>
        <button onclick="window.location.reload()" style="background:#4f46e5;color:#fff;border:none;padding:10px 18px;border-radius:8px;font-weight:700;cursor:pointer;margin-top:12px;">Reload Page</button>
      </div>
    `;
  }
});

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  const urlParams = new URLSearchParams(window.location.search);
  const isScanner = window.location.pathname.startsWith('/scanner') || urlParams.get('mode') === 'scanner' || urlParams.has('scanner');
  const isCfd = window.location.pathname.startsWith('/customer-display') || window.location.pathname.startsWith('/cfd') || urlParams.get('mode') === 'cfd' || urlParams.has('cfd');
  const sessionId = urlParams.get('session') || 'pos-counter-1';
  const counterId = urlParams.get('counter') || 'counter-1';

  if (isScanner) {
    root.render(<MobileScanner sessionId={sessionId} />);
  } else if (isCfd) {
    root.render(<CustomerDisplay counterId={counterId} />);
  } else {
    root.render(<App />);
  }
}
