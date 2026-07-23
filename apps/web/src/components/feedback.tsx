import { AlertTriangle, CircleDot, Clock3, Info, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';

export function EmptyQueue() {
  return (
    <div className="empty-queue">
      <Clock3 aria-hidden="true" />
      <p>No one is waiting. Add the first ticket.</p>
    </div>
  );
}

export function About() {
  return (
    <main className="page-shell about-page">
      <section className="page-intro">
        <p className="eyebrow">About</p>
        <h1>Queueing without accounts</h1>
      </section>
      <section className="about-copy">
        <Info aria-hidden="true" />
        <p>
          Your name cards and display preferences stay on this device. A name is shown publicly on
          the board but is self-asserted, not verified identity.
        </p>
        <p>
          Queues reset with each arcade’s local day. Live status tells you when the board is
          receiving new updates.
        </p>
      </section>
    </main>
  );
}

export function LoadingState({ label }: { label: string }) {
  return (
    <div aria-live="polite" className="loading-state">
      <span aria-hidden="true" className="loading-indicator" />
      {label}
    </div>
  );
}

export function LoadingPage({ label }: { label: string }) {
  return (
    <main className="page-shell">
      <LoadingState label={label} />
    </main>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="error-state" role="alert">
      <AlertTriangle aria-hidden="true" />
      <p>{message}</p>
      <button className="secondary-button" onClick={onRetry} type="button">
        <RefreshCw aria-hidden="true" /> Try again
      </button>
    </section>
  );
}

export function ErrorPage({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className="page-shell">
      <ErrorState message={message} onRetry={onRetry} />
    </main>
  );
}

export function NotFound() {
  return (
    <main className="page-shell">
      <section className="error-state">
        <CircleDot aria-hidden="true" />
        <p>This page does not exist.</p>
        <Link className="secondary-button" to="/">
          Back to locations
        </Link>
      </section>
    </main>
  );
}
