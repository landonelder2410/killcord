import { Suspense }       from 'react';
import Link               from 'next/link';
import type { Metadata } from 'next';
import { SuccessContent }  from './SuccessContent';

export const metadata: Metadata = {
  title: 'Welcome to Killcord — Your License Key',
  description: 'Your 7-day free trial is active. Copy your unique license key to start using Killcord.',
};

function Loading() {
  return (
    <div className="success-wrap">
      <div className="success-spinner" aria-label="Loading" />
      <p className="success-status">Loading your license key…</p>
    </div>
  );
}

export default function SuccessPage() {
  return (
    <>
      <nav className="nav">
        <div className="nav-inner">
          <Link className="logo" href="/" style={{ textDecoration: 'none' }}>⟁ Killcord</Link>
        </div>
      </nav>

      <main className="success-page">
        <Suspense fallback={<Loading />}>
          <SuccessContent />
        </Suspense>
      </main>
    </>
  );
}
