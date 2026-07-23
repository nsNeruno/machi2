import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, useLocation } from 'react-router-dom';

import { App } from './app';
import { AdminApp } from './admin/admin-app';
import './styles.css';

const queryClient = new QueryClient();

/** The admin console and the public board share one bundle but never one shell. */
function Root() {
  const location = useLocation();
  return location.pathname.startsWith('/admin') ? <AdminApp /> : <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Root />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
