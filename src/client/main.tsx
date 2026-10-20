import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/app.css';
import { Play } from './pages/Play';
import { Board } from './pages/Board';
import { Console } from './pages/Console';
import { Home } from './pages/Home';

function Router() {
  const p = window.location.pathname.replace(/\/+$/, '') || '/';
  if (p.startsWith('/play')) return <Play />;
  if (p.startsWith('/board')) return <Board />;
  if (p.startsWith('/console')) return <Console />;
  return <Home />;
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Router />
  </React.StrictMode>,
);
