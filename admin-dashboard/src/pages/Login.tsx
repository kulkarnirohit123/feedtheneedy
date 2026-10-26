import { useState, FormEvent } from 'react';
import { signIn } from '../auth';

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
    <div className="site">
      <header className="masthead">
        <div className="masthead-inner">
          <span className="wordmark">Feed the Needy</span>
          <span className="masthead-sub">Pickup dispatch</span>
        </div>
      </header>

      <main className="login">
        <form className="login-form" onSubmit={handleSubmit}>
          <div>
            <h1>Sign in</h1>
            <p className="lede">
              The dispatch board is for Feed the Needy staff. Donors and drivers don't need an account; they use
              WhatsApp.
            </p>
          </div>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
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
          <button className="btn btn-dark btn-block" type="submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <p className="login-foot muted">Need access? Ask an admin to add you.</p>
        </form>
      </main>
    </div>
  );
}
