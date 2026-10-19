import { CognitoIdentityProviderClient, InitiateAuthCommand } from '@aws-sdk/client-cognito-identity-provider';

const REGION = import.meta.env.VITE_AWS_REGION as string;
const USER_POOL_CLIENT_ID = import.meta.env.VITE_USER_POOL_CLIENT_ID as string;
const client = new CognitoIdentityProviderClient({ region: REGION });

let idToken: string | null = typeof localStorage !== 'undefined' ? localStorage.getItem('idToken') : null;

export function getIdToken(): string | null {
  return idToken;
}

export async function signIn(username: string, password: string): Promise<void> {
  const res = await client.send(
    new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: USER_POOL_CLIENT_ID,
      AuthParameters: { USERNAME: username, PASSWORD: password },
    }),
  );
  const token = res.AuthenticationResult?.IdToken;
  if (!token) throw new Error('Sign-in failed: no ID token returned');
  idToken = token;
  localStorage.setItem('idToken', token);
}

export function signOut(): void {
  idToken = null;
  localStorage.removeItem('idToken');
}
