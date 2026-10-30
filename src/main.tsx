import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';
import { ToastProvider } from './ui/Toast';
import { KeysProvider } from './useKeys';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <KeysProvider>
        <App />
      </KeysProvider>
    </ToastProvider>
  </StrictMode>,
);
