import { useState, FormEvent } from 'react';
import { signIn } from '../auth';

export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await signIn(username, password);
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    }
  }

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Feed the Needy</h1>
        <p className="login-tagline">Dispatch board — invited members only</p>
        <label>
          Email
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Email" />
        </label>
        <label>
          Password
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            placeholder="Password"
          />
        </label>
        <button className="btn btn-primary" type="submit">
          Sign in
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
    </div>
  );
}
