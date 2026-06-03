import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import './global.css';

const root = document.getElementById('root')!;
createRoot(root).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
