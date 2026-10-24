import { useState, FormEvent } from 'react';
import { signIn } from '../auth';
import { BrandMark } from '../icons';

/** Cognito's raw error names mean nothing to NGO staff; map the common ones to plain language. */
function friendlyError(err: unknown): string {
  const name = err instanceof Error ? err.name : '';
  if (name === 'NotAuthorizedException' || name === 'UserNotFoundException') {
    return 'Incorrect email or password.';
  }
  if (name === 'PasswordResetRequiredException') {
    return 'Your password needs to be reset. Ask an admin for help.';
  }
  return err instanceof Error ? err.message : 'Sign-in failed';
}

export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(username, password);
      onSignedIn();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-shell">
      <section className="login-hero">
        <div className="brand">
          <BrandMark size={40} />
          <span className="brand-name">Feed the Needy</span>
        </div>
        <div className="login-pitch">
          <h1>Surplus food, rescued before it goes to waste.</h1>
          <p>
            Donors and drivers only ever use WhatsApp. This board is where the team watches every pickup and
            steps in when one gets stuck.
          </p>
        </div>
        <ol className="login-steps">
          <li>
            <span>01</span>Donor messages
          </li>
          <li>
            <span>02</span>Nearest driver picks up
          </li>
          <li>
            <span>03</span>Dropped at a fridge
          </li>
        </ol>
      </section>

      <section className="login-form-col">
        <form className="login-form" onSubmit={handleSubmit}>
          <div>
            <h2>Sign in</h2>
            <p className="muted">For invited NGO staff only.</p>
          </div>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="you@example.org"
              required
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <button className="btn btn-leaf btn-lg" type="submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
          {error && (
            <p className="banner banner-error" role="alert">
              {error}
            </p>
          )}
          <p className="muted-sm">No account? Ask an admin to invite you.</p>
        </form>
      </section>
    </div>
  );
}
