/**
 * Vercel Serverless Function: POST /api/porsche/login
 * Handles Porsche Connect OAuth2 authentication (mobile app flow with PKCE)
 *
 * STATELESS APPROACH: All session data is encoded and sent to the client.
 * Client sends it back with each request. No server-side storage needed.
 */

import crypto from 'crypto';
import { JSDOM } from 'jsdom';

// Porsche Connect API configuration (updated to match current mobile app flow)
const CONFIG = {
  AUTHORIZATION_SERVER: 'identity.porsche.com',
  CLIENT_ID: 'qIkoJqlAXvbj4R3j12ct3zdinPId0Zbl',
  REDIRECT_URI: 'https://security.porsche.com/auth/en-GB/app/callback',
  USER_AGENT: 'de.porsche.one/18.26.09-row+162630 (android)',
  SCOPES: [
    'openid', 'profile', 'email', 'offline_access', 'mbb', 'ssodb',
    'badge', 'vin', 'dealers', 'cars', 'charging', 'manageCharging',
    'pid:user_profile.porscheid:read', 'pid:user_profile.vehicles:read'
  ]
};

// PKCE helpers
function generatePKCEVerifier() {
  return crypto.randomBytes(64).toString('base64url');
}

function buildPKCEChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

// Extract Auth0 universal login context from inline base64 JSON in HTML
function extractUniversalLoginContext(html) {
  const match = html.match(/atob\("([A-Za-z0-9+/=]+)"\)/);
  if (!match) return null;
  try {
    const payload = Buffer.from(match[1], 'base64').toString('utf-8');
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function generateState() {
  return Math.random().toString(36).substring(2, 15);
}

// Cookie jar: merges cookies by name so updated values replace old ones
function mergeCookies(existingCookieStr, response) {
  const jar = new Map();
  if (existingCookieStr) {
    for (const pair of existingCookieStr.split('; ')) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0) jar.set(pair.substring(0, eqIdx), pair);
    }
  }
  const setCookies = response.headers.getSetCookie?.() || [];
  for (const raw of setCookies) {
    const nameValue = raw.split(';')[0];
    const eqIdx = nameValue.indexOf('=');
    if (eqIdx > 0) jar.set(nameValue.substring(0, eqIdx), nameValue);
  }
  return Array.from(jar.values()).join('; ');
}

function resolveUrl(location, baseUrl) {
  if (!location) return null;
  if (location.startsWith('http://') || location.startsWith('https://')) {
    return location;
  }
  try {
    return new URL(location, baseUrl).toString();
  } catch {
    return null;
  }
}

// Encode session data to send to client (stateless tokens)
export function encodeSessionData(data) {
  return Buffer.from(JSON.stringify(data)).toString('base64');
}

// Decode session data from client
export function decodeSessionData(encoded) {
  try {
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-id');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, password, captchaCode, captchaSession } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  console.log(`[Auth] Starting login for ${email}${captchaCode ? ' (with captcha)' : ''}`);

  try {
    const authBaseUrl = `https://${CONFIG.AUTHORIZATION_SERVER}`;
    let cookies = '';
    let loginState = '';
    let codeVerifier = generatePKCEVerifier();

    // Check if this is a captcha retry - restore session from client
    if (captchaCode && captchaSession) {
      const sessionData = decodeSessionData(captchaSession);
      if (sessionData) {
        console.log('[Auth] Resuming captcha session from client data');
        cookies = sessionData.cookies;
        loginState = sessionData.state;
        codeVerifier = sessionData.codeVerifier || codeVerifier;
      } else {
        return res.status(400).json({ error: 'Invalid captcha session' });
      }
    }

    // Only do step 1 if we don't have cookies from a captcha session
    if (!cookies) {
      const state = generateState();
      const scope = CONFIG.SCOPES.join(' ');
      const codeChallenge = buildPKCEChallenge(codeVerifier);

      // Step 1: Initialize authorization request with PKCE
      const authUrl = new URL(`https://${CONFIG.AUTHORIZATION_SERVER}/authorize`);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', CONFIG.CLIENT_ID);
      authUrl.searchParams.set('redirect_uri', CONFIG.REDIRECT_URI);
      authUrl.searchParams.set('scope', scope);
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('audience', 'https://api.porsche.com');
      authUrl.searchParams.set('response_mode', 'query');
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');

      console.log(`[Auth] Step 1: Initiating OAuth with PKCE`);
      const authResponse = await fetch(authUrl.toString(), {
        method: 'GET',
        headers: { 'User-Agent': CONFIG.USER_AGENT },
        redirect: 'manual'
      });

      cookies = mergeCookies(cookies, authResponse);

      // Follow redirects to get to login page
      let location = resolveUrl(authResponse.headers.get('location'), authBaseUrl);
      let loginPageHtml = '';

      // Extract state from the redirect URL query params (most reliable method)
      if (location) {
        try {
          const redirectUrl = new URL(location);
          const urlState = redirectUrl.searchParams.get('state');
          if (urlState) {
            loginState = urlState;
          }
        } catch { /* ignore parse errors */ }

        // Follow redirect chain to the actual login page, collecting cookies at each hop
        let loginPageUrl = location;
        let loginPageResponse;
        for (let i = 0; i < 5; i++) {
          loginPageResponse = await fetch(loginPageUrl, {
            headers: {
              'User-Agent': CONFIG.USER_AGENT,
              'Cookie': cookies
            },
            redirect: 'manual'
          });
          cookies = mergeCookies(cookies, loginPageResponse);
          if (loginPageResponse.status === 302 || loginPageResponse.status === 301) {
            loginPageUrl = resolveUrl(loginPageResponse.headers.get('location'), authBaseUrl);
          } else {
            break;
          }
        }
        loginPageHtml = await loginPageResponse.text();
      } else {
        loginPageHtml = await authResponse.text();
      }

      // Always try universal login context (ACUL pages embed state in base64 JSON)
      const ulContext = extractUniversalLoginContext(loginPageHtml);
      if (ulContext?.state) {
        loginState = ulContext.state;
      } else if (!loginState) {
        const dom = new JSDOM(loginPageHtml);
        const stateInput = dom.window.document.querySelector('input[name="state"]');
        loginState = stateInput?.value || state;
      }
    }

    // Step 2: Submit email (identifier-first flow)
    const identifierUrl = `https://${CONFIG.AUTHORIZATION_SERVER}/u/login/identifier`;

    const identifierBody = {
      state: loginState,
      username: email,
      'js-available': 'true',
      'webauthn-available': 'false',
      'is-brave': 'false',
      'webauthn-platform-available': 'false',
      action: 'default'
    };

    if (captchaCode) {
      identifierBody.captcha = captchaCode;
    }

    const identifierResponse = await fetch(identifierUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': CONFIG.USER_AGENT,
        'Cookie': cookies
      },
      body: new URLSearchParams(identifierBody).toString(),
      redirect: 'manual'
    });

    cookies = mergeCookies(cookies, identifierResponse);

    if (identifierResponse.status === 400) {
      const errorHtml = await identifierResponse.text();
      const errorContext = extractUniversalLoginContext(errorHtml);

      // Check for captcha in ACUL context (new Auth0 Universal Login)
      const captchaFromContext = errorContext?.screen?.captcha?.image;
      // Also check legacy HTML captcha
      const dom = new JSDOM(errorHtml);
      const captchaImg = dom.window.document.querySelector('img[alt="captcha"]');
      const captchaSrc = captchaFromContext || captchaImg?.getAttribute('src');

      if (captchaSrc) {
        console.log(`[Auth] Captcha required`);
        const captchaPageState = errorContext?.transaction?.state || loginState;

        // Encode session data to send to client (stateless approach)
        const sessionData = encodeSessionData({
          cookies,
          state: captchaPageState,
          codeVerifier,
          email
        });

        return res.status(400).json({
          error: 'Captcha required',
          captchaRequired: true,
          captchaImage: captchaSrc,
          captchaSession: sessionData
        });
      }

      const errorMsg = errorContext?.screen?.errors?.[0]?.message
        || errorContext?.screen?.error?.message
        || 'Invalid email address';
      return res.status(400).json({ error: errorMsg });
    }

    // Step 2b: Follow redirect to password page (collects session cookies)
    if (identifierResponse.status === 302) {
      let idRedirect = resolveUrl(identifierResponse.headers.get('location'), authBaseUrl);
      for (let i = 0; i < 5 && idRedirect; i++) {
        const idRedirectResp = await fetch(idRedirect, {
          headers: { 'User-Agent': CONFIG.USER_AGENT, 'Cookie': cookies },
          redirect: 'manual'
        });
        cookies = mergeCookies(cookies, idRedirectResp);
        if (idRedirectResp.status === 302 || idRedirectResp.status === 301) {
          idRedirect = resolveUrl(idRedirectResp.headers.get('location'), authBaseUrl);
        } else {
          const pwPageHtml = await idRedirectResp.text();
          const pwDom = new JSDOM(pwPageHtml);
          const pwStateInput = pwDom.window.document.querySelector('input[name="state"]');
          if (pwStateInput?.value) {
            loginState = pwStateInput.value;
          }
          break;
        }
      }
    }

    // Step 3: Submit password
    const passwordUrl = `https://${CONFIG.AUTHORIZATION_SERVER}/u/login/password`;
    const passwordResponse = await fetch(passwordUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': CONFIG.USER_AGENT,
        'Cookie': cookies
      },
      body: new URLSearchParams({
        state: loginState,
        username: email,
        password: password,
        action: 'default'
      }).toString(),
      redirect: 'manual'
    });

    cookies = mergeCookies(cookies, passwordResponse);

    if (passwordResponse.status === 400) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Step 4: Follow redirects to get authorization code
    // This may include passkey enrollment pages that need to be skipped
    let codeLocation = resolveUrl(passwordResponse.headers.get('location'), authBaseUrl);
    let authCode = null;

    for (let i = 0; i < 15 && codeLocation && !authCode; i++) {
      if (codeLocation.includes('code=')) {
        try {
          const codeUrl = new URL(codeLocation);
          authCode = codeUrl.searchParams.get('code');
        } catch {
          const codeMatch = codeLocation.match(/[?&]code=([^&]+)/);
          if (codeMatch) authCode = codeMatch[1];
        }
        break;
      }

      const redirectResponse = await fetch(codeLocation, {
        headers: {
          'User-Agent': CONFIG.USER_AGENT,
          'Cookie': cookies
        },
        redirect: 'manual'
      });

      cookies = mergeCookies(cookies, redirectResponse);

      if (redirectResponse.status === 302 || redirectResponse.status === 301 || redirectResponse.status === 303) {
        codeLocation = resolveUrl(redirectResponse.headers.get('location'), authBaseUrl);
      } else {
        // Got an HTML page - check if it's a passkey enrollment prompt
        const pageHtml = await redirectResponse.text();
        const loginContext = extractUniversalLoginContext(pageHtml);

        if (loginContext && (pageHtml.includes('passkey') || pageHtml.includes('webauthn'))) {
          console.log('[Auth] Passkey enrollment page detected, skipping...');
          const dom = new JSDOM(pageHtml);
          const stateInput = dom.window.document.querySelector('input[name="state"]');
          const passkeyState = stateInput?.value || loginState;

          const skipResponse = await fetch(codeLocation, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'User-Agent': CONFIG.USER_AGENT,
              'Cookie': cookies
            },
            body: new URLSearchParams({
              state: passkeyState,
              action: 'abort-passkey-enrollment',
              'acul-sdk': '@auth0/auth0-acul-js@1.2.0'
            }).toString(),
            redirect: 'manual'
          });

          cookies = mergeCookies(cookies, skipResponse);
          codeLocation = resolveUrl(skipResponse.headers.get('location'), authBaseUrl);
        } else {
          break;
        }
      }
    }

    if (!authCode) {
      return res.status(401).json({ error: 'Failed to obtain authorization code' });
    }

    // Step 5: Exchange code for tokens (with PKCE code_verifier)
    const tokenUrl = `https://${CONFIG.AUTHORIZATION_SERVER}/oauth/token`;
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': CONFIG.USER_AGENT
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CONFIG.CLIENT_ID,
        code: authCode,
        redirect_uri: CONFIG.REDIRECT_URI,
        code_verifier: codeVerifier
      }).toString()
    });

    if (!tokenResponse.ok) {
      return res.status(401).json({ error: 'Failed to exchange token' });
    }

    const tokens = await tokenResponse.json();

    // STATELESS: Encode tokens and send to client
    const sessionData = encodeSessionData({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + (tokens.expires_in * 1000),
      email
    });

    res.json({
      sessionId: sessionData,
      expiresIn: tokens.expires_in
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Authentication failed: ' + error.message });
  }
}
