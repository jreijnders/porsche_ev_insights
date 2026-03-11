/**
 * Shared utilities for Porsche Connect API routes
 * STATELESS: Session data is encoded/decoded from client requests
 */

// Porsche Connect API configuration (updated to match current mobile app flow)
export const CONFIG = {
  API_BASE_URL: 'https://api.ppa.porsche.com/app',
  X_CLIENT_ID: '09fcb5d8-d4ad-48e8-a0e8-a9c7cb1b9cbc',
  USER_AGENT: 'de.porsche.one/18.26.09-row+162630 (android)',
  AUTHORIZATION_SERVER: 'identity.porsche.com',
  CLIENT_ID: 'qIkoJqlAXvbj4R3j12ct3zdinPId0Zbl',
  REDIRECT_URI: 'https://security.porsche.com/auth/en-GB/app/callback'
};

// Decode session data from client
export function decodeSessionData(encoded) {
  try {
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

// Encode session data to send to client
export function encodeSessionData(data) {
  return Buffer.from(JSON.stringify(data)).toString('base64');
}

// Set CORS headers
export function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-id');
}

// Get session from request header and validate
export function getSession(req) {
  const sessionId = req.headers['x-session-id'];
  if (!sessionId) {
    return { error: 'Unauthorized', status: 401 };
  }

  const session = decodeSessionData(sessionId);
  if (!session) {
    return { error: 'Invalid session', status: 401 };
  }

  // Check if token is expired (with 60s buffer)
  if (Date.now() > session.expiresAt - 60000) {
    return { error: 'Token expired', needsRefresh: true, status: 401 };
  }

  return { session };
}

// Make authenticated request to Porsche API
export async function porscheApiRequest(session, endpoint) {
  const response = await fetch(`${CONFIG.API_BASE_URL}${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${session.accessToken}`,
      'User-Agent': CONFIG.USER_AGENT,
      'x-client-id': CONFIG.X_CLIENT_ID
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Porsche API error (${endpoint}):`, errorText);
    return { error: `API request failed: ${response.status}`, status: response.status };
  }

  return { data: await response.json() };
}
