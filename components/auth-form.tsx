'use client';
import { useState } from 'react';
import Link from 'next/link';
import { LoaderCircle } from 'lucide-react';
import BrandLogo from './brand-logo';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { MIN_PASSWORD, passwordProblem } from '@/lib/workbench/credentials';

export default function AuthForm({
  mode,
  next,
}: {
  mode: 'login' | 'signup';
  next: string;
}) {
  const signup = mode === 'signup';
  const [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
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
