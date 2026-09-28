'use client';
import { useState } from 'react';
import Link from 'next/link';
import { LoaderCircle } from 'lucide-react';
import BrandLogo from './brand-logo';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { MIN_PASSWORD, passwordProblem } from '@/lib/workbench/credentials';

/** Google requires its own mark on the button, at its own proportions. */
function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden focusable="false">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.2-.4-4.7H24v8.9h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.1-3.8 6.6-9.4 6.6-16.3z" />
      <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.5v5.7C8.1 41.2 15.5 46 24 46z" />
      <path fill="#FBBC05" d="M11.8 28.3c-.4-1.3-.7-2.7-.7-4.3s.2-2.9.7-4.3v-5.7H4.5C2.9 17.2 2 20.5 2 24s.9 6.8 2.5 9.7l7.3-5.4z" />
      <path fill="#EA4335" d="M24 10.7c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.1 29.9 2 24 2 15.5 2 8.1 6.8 4.5 14.3l7.3 5.7c1.7-5.2 6.5-9.3 12.2-9.3z" />
    </svg>
  );
}

/** The callback redirects here with ?error=... when Google sign-in fails; those
 *  two codes are ours, anything else is already a sentence for the reader. */
function googleError(code: string) {
  if (!code) return '';
  if (code === 'google') return 'Google sign-in was cancelled.';
  if (code === 'state') return 'That sign-in link expired. Try again.';
  return code;
}
export default function AuthForm({
  mode,
  next,
  google = false,
  error: initialError = '',
}: {
  mode: 'login' | 'signup';
  next: string;
  google?: boolean;
  error?: string;
}) {
  const signup = mode === 'signup';
  const [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [error, setError] = useState(googleError(initialError)),
    [busy, setBusy] = useState(false);
  // Shown while typing, but never used to decide whether to submit: the server
  // applies the same rules and is the only check that counts.
  const hint = signup && password ? passwordProblem(password) : null;

  async function submit(event: React.SyntheticEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          signup ? { name, email, password, next } : { email, password, next },
        ),
      });
      const data = (await response.json()) as { next?: string; error?: string };
      if (!response.ok) throw Error(data.error ?? 'Something went wrong.');
      // A full navigation, not a router push: the session cookie has to be on
      // the document request for the workspace to render signed in.
      window.location.assign(data.next ?? next);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <Link href="/" className="auth-brand">
        <BrandLogo size={30} />
        <span>Foundry</span>
      </Link>
      <form className="auth-card" onSubmit={submit}>
        <h1>{signup ? 'Create your workspace' : 'Sign in'}</h1>
        <p className="auth-subtitle">
          {signup
            ? 'Your workflows, runs, and connected accounts stay private to this account.'
            : 'Welcome back. Pick up where your workflows left off.'}
        </p>
        {google && (
          <>
            <a
              className="auth-google"
              href={`/api/auth/google${next && next !== '/app' ? `?next=${encodeURIComponent(next)}` : ''}`}
            >
              <GoogleMark />
              Continue with Google
            </a>
            <div className="auth-divider">
              <span>or</span>
            </div>
          </>
        )}
        {signup && (
          <label htmlFor="auth-name">
            <span>Name</span>
            <Input
              id="auth-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              maxLength={80}
              required
            />
          </label>
        )}
        <label htmlFor="auth-email">
          <span>Email</span>
          <Input
            id="auth-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            maxLength={254}
            required
          />
        </label>
        <label htmlFor="auth-password">
          <span>Password</span>
          <Input
            id="auth-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={signup ? 'new-password' : 'current-password'}
            maxLength={200}
            required
          />
          {signup && (
            <small className={hint ? 'auth-hint problem' : 'auth-hint'}>
              {hint ?? `At least ${MIN_PASSWORD} characters. A short phrase works well.`}
            </small>
          )}
        </label>
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy} className="auth-submit">
          {busy && <LoaderCircle size={15} className="spin" />}
          {signup ? 'Create account' : 'Sign in'}
        </Button>
        <p className="auth-switch">
          {signup ? 'Already have an account? ' : 'New here? '}
          <Link
            href={`${signup ? '/login' : '/signup'}${next && next !== '/app' ? `?next=${encodeURIComponent(next)}` : ''}`}
          >
            {signup ? 'Sign in' : 'Create an account'}
          </Link>
        </p>
      </form>
    </main>
  );
}
