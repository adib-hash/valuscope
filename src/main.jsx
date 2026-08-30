import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

// Recharts appends an off-screen text-measurement span to <body> that leaks
// its last-measured label ("0.0x") into the accessibility tree on every page.
// Hide it from assistive tech the moment it appears.
const hideMeasurementSpan = new MutationObserver(() => {
  const el = document.getElementById('recharts_measurement_span');
  if (el && !el.hasAttribute('aria-hidden')) el.setAttribute('aria-hidden', 'true');
});
hideMeasurementSpan.observe(document.body, { childList: true });
