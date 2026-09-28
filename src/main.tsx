import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import AuthGate from './components/AuthGate';
import { registerPWA } from './registerPWA';

// Initialize PWA Service Worker
registerPWA();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </StrictMode>,
);
