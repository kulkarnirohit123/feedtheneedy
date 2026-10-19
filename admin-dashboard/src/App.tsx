import { useState } from 'react';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { getIdToken } from './auth';

export function App() {
  const [signedIn, setSignedIn] = useState(!!getIdToken());

  if (!signedIn) {
    return <Login onSignedIn={() => setSignedIn(true)} />;
  }
  return <Dashboard onSignedOut={() => setSignedIn(false)} />;
}
