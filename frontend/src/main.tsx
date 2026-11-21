import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth';
import { OverlayProvider } from './components/Overlays';
import './styles/tokens.css';
import './styles/components.css';
import './styles/base.css';
import './styles/public.css';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <OverlayProvider>
          <App />
        </OverlayProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
