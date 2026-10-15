import { OAuth2Client } from 'google-auth-library';

// Verify a Google id_token and extract the stable profile fields. The backend
// is the authority: signature, audience, expiration and issuer are all checked
// by google-auth-library before we accept the identity (spec section 12).
export function makeGoogleVerifier({ clientId }) {
  if (!clientId) {
    throw new Error('GOOGLE_CLIENT_ID is not configured');
  }
  const client = new OAuth2Client(clientId);
  return async function verifyGoogleIdToken(idToken) {
    const ticket = await client.verifyIdToken({ idToken, audience: clientId });
    const p = ticket.getPayload();
    if (!p || !p.sub) throw new Error('Google token payload missing sub');
    return {
      sub: p.sub, // stable Google identifier (primary key for upsert)
      email: p.email || '',
      name: p.name || '',
      picture: p.picture || '',
      emailVerified: !!p.email_verified,
    };
  };
}
