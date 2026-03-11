/**
 * Porsche Connect API Proxy Server
 *
 * This server handles OAuth2 authentication with Porsche Connect
 * and proxies API requests to avoid CORS issues in the browser.
 */

import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Token persistence file path
const TOKEN_FILE = path.join(__dirname, '.tokens.json');

// Porsche Connect API configuration (updated to match current mobile app flow)
const CONFIG = {
  AUTHORIZATION_SERVER: 'identity.porsche.com',
  API_BASE_URL: 'https://api.ppa.porsche.com/app',
  CLIENT_ID: 'qIkoJqlAXvbj4R3j12ct3zdinPId0Zbl',
  X_CLIENT_ID: '09fcb5d8-d4ad-48e8-a0e8-a9c7cb1b9cbc',
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

// Trip statistics measurement keys
const TRIP_STATISTICS = [
  'TRIP_STATISTICS_CYCLIC',
  'TRIP_STATISTICS_LONG_TERM',
  'TRIP_STATISTICS_LONG_TERM_HISTORY',
  'TRIP_STATISTICS_SHORT_TERM_HISTORY',
  'TRIP_STATISTICS_CYCLIC_HISTORY',
  'TRIP_STATISTICS_SHORT_TERM'
];

// Vehicle measurements for overview
const MEASUREMENTS = [
  'BATTERY_LEVEL', 'E_RANGE', 'MILEAGE', 'GPS_LOCATION',
  'CHARGING_SUMMARY', 'CHARGING_RATE', 'LOCK_STATE_VEHICLE'
];

// All available measurements (from pyporscheconnectapi)
const ALL_MEASUREMENTS = [
  // Battery & Charging
  'BATTERY_LEVEL', 'BATTERY_CHARGING_STATE', 'E_RANGE', 'RANGE',
  'CHARGING_SUMMARY', 'CHARGING_RATE', 'CHARGING_PROFILES', 'CHARGING_SETTINGS',
  // Vehicle Status
  'MILEAGE', 'GPS_LOCATION', 'LOCK_STATE_VEHICLE', 'PARKING_BRAKE', 'PARKING_LIGHT',
  // Doors & Lids
  'OPEN_STATE_DOOR_FRONT_LEFT', 'OPEN_STATE_DOOR_FRONT_RIGHT',
  'OPEN_STATE_DOOR_REAR_LEFT', 'OPEN_STATE_DOOR_REAR_RIGHT',
  'OPEN_STATE_LID_FRONT', 'OPEN_STATE_LID_REAR',
  'OPEN_STATE_WINDOW_FRONT_LEFT', 'OPEN_STATE_WINDOW_FRONT_RIGHT',
  'OPEN_STATE_WINDOW_REAR_LEFT', 'OPEN_STATE_WINDOW_REAR_RIGHT',
  'OPEN_STATE_SUNROOF', 'OPEN_STATE_SUNROOF_REAR', 'OPEN_STATE_TOP', 'OPEN_STATE_SPOILER',
  'OPEN_STATE_CHARGE_FLAP_LEFT', 'OPEN_STATE_CHARGE_FLAP_RIGHT', 'OPEN_STATE_SERVICE_FLAP',
  // Tire Pressure
  'TIRE_PRESSURE',
  // Climate
  'CLIMATIZER_STATE', 'HEATING_STATE', 'HVAC_STATE',
  // Service
  'MAIN_SERVICE_RANGE', 'MAIN_SERVICE_TIME',
  'INTERMEDIATE_SERVICE_RANGE', 'INTERMEDIATE_SERVICE_TIME',
  'OIL_SERVICE_RANGE', 'OIL_SERVICE_TIME',
  'OIL_LEVEL_CURRENT', 'OIL_LEVEL_MAX', 'OIL_LEVEL_MIN_WARNING',
  'SERVICE_PREDICTIONS',
  // Fuel (for hybrids)
  'FUEL_LEVEL', 'FUEL_RESERVE',
  // Security & Alarm
  'ALARM_STATE', 'THEFT_STATE', 'GLOBAL_PRIVACY_MODE',
  // Misc
  'DEPARTURES', 'TIMERS', 'BLEID_DDADATA', 'PAIRING_CODE',
  'REMOTE_ACCESS_AUTHORIZATION', 'VTS_MODES', 'ACV_STATE',
  'PRED_PRECON_LOCATION_EXCEPTIONS', 'PRED_PRECON_USER_SETTINGS'
];

// In-memory token storage (in production, use Redis or database)
const tokenStore = new Map();

// Temporary storage for captcha sessions (cookies needed for retry)
const captchaSessionStore = new Map();

// Load persisted tokens on startup
function loadTokens() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      for (const [sessionId, session] of Object.entries(data)) {
        // Only load tokens that haven't expired (with 5 min buffer)
        if (session.expiresAt > Date.now() + 300000) {
          tokenStore.set(sessionId, session);
          console.log(`[Tokens] Restored session for ${session.email}`);
        } else if (session.refreshToken) {
          // Token expired but has refresh token - still load it, will refresh on use
          tokenStore.set(sessionId, session);
          console.log(`[Tokens] Restored expired session for ${session.email} (will refresh)`);
        }
      }
      console.log(`[Tokens] Loaded ${tokenStore.size} session(s) from disk`);
    }
  } catch (e) {
    console.warn('[Tokens] Failed to load tokens:', e.message);
  }
}

// Save tokens to disk
function saveTokens() {
  try {
    const data = Object.fromEntries(tokenStore);
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.warn('[Tokens] Failed to save tokens:', e.message);
  }
}

// Load tokens on startup
loadTokens();

// CORS configuration for development proxy server
// NOTE: This server is for LOCAL DEVELOPMENT ONLY and is never deployed to production.
// Production builds are static files served from GitHub Pages without this server.
// Allowing local network IPs (192.168.x.x, 10.x.x.x) enables testing from mobile devices.
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    // Allow localhost and private network IPs for mobile testing
    if (origin.match(/^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+):\d+$/)) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));
app.use(express.json());

// Helper to generate random state for OAuth
function generateState() {
  return Math.random().toString(36).substring(2, 15);
}

// Cookie jar: merges cookies by name so updated values replace old ones
function mergeCookies(existingCookieStr, response) {
  const jar = new Map();
  // Parse existing cookies
  if (existingCookieStr) {
    for (const pair of existingCookieStr.split('; ')) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0) jar.set(pair.substring(0, eqIdx), pair);
    }
  }
  // Merge new Set-Cookie headers (overwrite by name)
  const setCookies = response.headers.raw()['set-cookie'] || [];
  for (const raw of setCookies) {
    const nameValue = raw.split(';')[0];
    const eqIdx = nameValue.indexOf('=');
    if (eqIdx > 0) jar.set(nameValue.substring(0, eqIdx), nameValue);
  }
  return Array.from(jar.values()).join('; ');
}

// Helper to resolve potentially relative URLs
function resolveUrl(location, baseUrl) {
  if (!location) return null;
  if (location.startsWith('http://') || location.startsWith('https://')) {
    return location;
  }
  // Relative URL - resolve against base
  try {
    return new URL(location, baseUrl).toString();
  } catch {
    return null;
  }
}

// OAuth2 Authentication endpoint (updated for mobile app flow with PKCE)
app.post('/api/auth/login', async (req, res) => {
  const { email, password, captchaCode, captchaState } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  console.log(`[Auth] Starting login for ${email}${captchaCode ? ' (with captcha)' : ''}`);

  try {
    const authBaseUrl = `https://${CONFIG.AUTHORIZATION_SERVER}`;
    let cookies = '';
    let loginState = '';
    let codeVerifier = generatePKCEVerifier();

    // Check if this is a captcha retry (we have stored cookies)
    if (captchaCode && captchaState) {
      const storedSession = captchaSessionStore.get(captchaState);
      if (storedSession) {
        console.log('[Auth] Resuming captcha session with stored cookies');
        cookies = storedSession.cookies;
        loginState = captchaState;
        codeVerifier = storedSession.codeVerifier || codeVerifier;
        captchaSessionStore.delete(captchaState);
      } else {
        console.log('[Auth] No stored session for captcha state, starting fresh');
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

      console.log(`[Auth] Step 1 response: ${authResponse.status}`);
      cookies = mergeCookies(cookies, authResponse);

      // Follow redirects to get to login page
      let location = resolveUrl(authResponse.headers.get('location'), authBaseUrl);
      console.log(`[Auth] Redirect to: ${location}`);
      let loginPageHtml = '';

      // Extract state from the redirect URL query params (most reliable method)
      if (location) {
        try {
          const redirectUrl = new URL(location);
          const urlState = redirectUrl.searchParams.get('state');
          if (urlState) {
            loginState = urlState;
            console.log(`[Auth] Extracted state from redirect URL`);
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
          console.log(`[Auth] Login page fetch ${i}: status=${loginPageResponse.status}`);
          if (loginPageResponse.status === 302 || loginPageResponse.status === 301) {
            loginPageUrl = resolveUrl(loginPageResponse.headers.get('location'), authBaseUrl);
            console.log(`[Auth] Login page redirect to: ${loginPageUrl}`);
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
      if (ulContext) {
        console.log(`[Auth] Universal login context keys: ${Object.keys(ulContext).join(', ')}`);
        if (ulContext.state) {
          console.log(`[Auth] UL context state: ${ulContext.state.substring(0, 30)}...`);
          console.log(`[Auth] URL state: ${loginState.substring(0, 30)}...`);
          loginState = ulContext.state;
          console.log(`[Auth] Using state from universal login context`);
        }
      } else {
        console.log(`[Auth] No universal login context found, checking hidden input...`);
        if (!loginState) {
          const dom = new JSDOM(loginPageHtml);
          const stateInput = dom.window.document.querySelector('input[name="state"]');
          loginState = stateInput?.value || state;
          console.log(`[Auth] Extracted state from ${stateInput ? 'hidden input' : 'generated fallback'}`);
        }
      }
    }

    // Step 2: Submit email (identifier-first flow)
    const effectiveState = captchaState || loginState;

    console.log(`[Auth] Step 2: Submitting email${captchaCode ? ' with captcha' : ''} (state: ${effectiveState.substring(0, 20)}...)`);
    const identifierUrl = `https://${CONFIG.AUTHORIZATION_SERVER}/u/login/identifier`;

    const identifierBody = {
      state: effectiveState,
      username: email,
      'js-available': 'true',
      'webauthn-available': 'false',
      'is-brave': 'false',
      'webauthn-platform-available': 'false',
      action: 'default'
    };

    // Add captcha if provided
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
    console.log(`[Auth] Step 2 response: ${identifierResponse.status}`);

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
        console.log(`[Auth] Captcha required (source: ${captchaFromContext ? 'ACUL context' : 'HTML img'})`);

        // Extract state from the error page context (may differ from original)
        const captchaPageState = errorContext?.transaction?.state || effectiveState;

        captchaSessionStore.set(captchaPageState, {
          cookies,
          email,
          codeVerifier,
          timestamp: Date.now()
        });

        // Clean up old captcha sessions (older than 5 minutes)
        for (const [key, value] of captchaSessionStore.entries()) {
          if (Date.now() - value.timestamp > 300000) {
            captchaSessionStore.delete(key);
          }
        }

        return res.status(400).json({
          error: 'Captcha required',
          captchaRequired: true,
          captchaImage: captchaSrc,
          captchaState: captchaPageState
        });
      }

      // No captcha — check for other errors in context
      const errorMsg = errorContext?.screen?.errors?.[0]?.message
        || errorContext?.screen?.error?.message
        || 'Invalid email address';
      console.log(`[Auth] Step 2 error: ${errorMsg}`);
      return res.status(400).json({ error: errorMsg });
    }

    // Step 2b: Follow redirect to password page (collects session cookies)
    if (identifierResponse.status === 302) {
      let idRedirect = resolveUrl(identifierResponse.headers.get('location'), authBaseUrl);
      console.log(`[Auth] Step 2b: Following identifier redirect to: ${idRedirect}`);
      for (let i = 0; i < 5 && idRedirect; i++) {
        const idRedirectResp = await fetch(idRedirect, {
          headers: { 'User-Agent': CONFIG.USER_AGENT, 'Cookie': cookies },
          redirect: 'manual'
        });
        cookies = mergeCookies(cookies, idRedirectResp);
        if (idRedirectResp.status === 302 || idRedirectResp.status === 301) {
          idRedirect = resolveUrl(idRedirectResp.headers.get('location'), authBaseUrl);
          console.log(`[Auth] Step 2b redirect ${i+1}: ${idRedirect}`);
        } else {
          const pwPageHtml = await idRedirectResp.text();
          const pwDom = new JSDOM(pwPageHtml);
          const pwStateInput = pwDom.window.document.querySelector('input[name="state"]');
          if (pwStateInput?.value) {
            console.log(`[Auth] Step 2b: Updated state from password page`);
            loginState = pwStateInput.value;
          }
          break;
        }
      }
    }

    // Step 3: Submit password
    console.log(`[Auth] Step 3: Submitting password`);
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
    console.log(`[Auth] Step 3 response: ${passwordResponse.status}`);

    if (passwordResponse.status === 400) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Step 4: Follow redirects to get authorization code
    // This may include passkey enrollment pages that need to be skipped
    let codeLocation = resolveUrl(passwordResponse.headers.get('location'), authBaseUrl);
    console.log(`[Auth] Step 4: Following redirects, starting at: ${codeLocation}`);
    let authCode = null;

    for (let i = 0; i < 15 && codeLocation && !authCode; i++) {
      // Check if this URL contains the authorization code
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
        console.log(`[Auth] Step 4 redirect ${i+1}: ${codeLocation}`);
      } else {
        // Got an HTML page - check if it's a passkey enrollment prompt
        const pageHtml = await redirectResponse.text();
        const loginContext = extractUniversalLoginContext(pageHtml);

        if (loginContext && (pageHtml.includes('passkey') || pageHtml.includes('webauthn'))) {
          console.log('[Auth] Passkey enrollment page detected, skipping...');

          // Extract state from the context or the page
          const dom = new JSDOM(pageHtml);
          const stateInput = dom.window.document.querySelector('input[name="state"]');
          const passkeyState = stateInput?.value || loginState;

          // Skip passkey enrollment
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
          console.log(`[Auth] Passkey skip redirect: ${codeLocation}`);
        } else {
          console.log(`[Auth] Step 4: Got non-redirect page at ${codeLocation}`);
          console.log(`[Auth] Page snippet: ${pageHtml.substring(0, 200)}`);
          break;
        }
      }
    }

    if (!authCode) {
      console.log(`[Auth] Failed to obtain auth code. Last location: ${codeLocation}`);
      return res.status(401).json({ error: 'Failed to obtain authorization code' });
    }

    console.log(`[Auth] Got authorization code, exchanging for tokens`);

    // Step 5: Exchange code for tokens (with PKCE code_verifier)
    const tokenUrl = `https://${CONFIG.AUTHORIZATION_SERVER}/oauth/token`;
    const tokenBody = {
      grant_type: 'authorization_code',
      client_id: CONFIG.CLIENT_ID,
      code: authCode,
      redirect_uri: CONFIG.REDIRECT_URI,
      code_verifier: codeVerifier
    };

    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': CONFIG.USER_AGENT
      },
      body: new URLSearchParams(tokenBody).toString()
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', errorText);
      return res.status(401).json({ error: 'Failed to exchange token' });
    }

    const tokens = await tokenResponse.json();

    // Generate a session ID and store tokens
    const sessionId = Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
    tokenStore.set(sessionId, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + (tokens.expires_in * 1000),
      email
    });
    saveTokens(); // Persist to disk

    res.json({
      sessionId,
      expiresIn: tokens.expires_in
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Authentication failed: ' + error.message });
  }
});

// Refresh token endpoint
app.post('/api/auth/refresh', async (req, res) => {
  const { sessionId } = req.body;
  const session = tokenStore.get(sessionId);

  if (!session?.refreshToken) {
    return res.status(401).json({ error: 'Invalid session' });
  }

  try {
    const tokenUrl = `https://${CONFIG.AUTHORIZATION_SERVER}/oauth/token`;
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': CONFIG.USER_AGENT
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: CONFIG.CLIENT_ID,
        refresh_token: session.refreshToken
      }).toString()
    });

    if (!tokenResponse.ok) {
      tokenStore.delete(sessionId);
      saveTokens(); // Persist deletion
      return res.status(401).json({ error: 'Token refresh failed' });
    }

    const tokens = await tokenResponse.json();

    // Update stored tokens
    session.accessToken = tokens.access_token;
    session.refreshToken = tokens.refresh_token || session.refreshToken;
    session.expiresAt = Date.now() + (tokens.expires_in * 1000);
    tokenStore.set(sessionId, session);
    saveTokens(); // Persist to disk

    res.json({
      expiresIn: tokens.expires_in
    });

  } catch (error) {
    console.error('Refresh error:', error);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

// Middleware to check auth
function requireAuth(req, res, next) {
  const sessionId = req.headers['x-session-id'];
  const session = tokenStore.get(sessionId);

  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Check if token is expired (with 60s leeway)
  if (Date.now() > session.expiresAt - 60000) {
    return res.status(401).json({ error: 'Token expired', needsRefresh: true });
  }

  req.session = session;
  next();
}

// Get vehicles list
app.get('/api/vehicles', requireAuth, async (req, res) => {
  try {
    const response = await fetch(`${CONFIG.API_BASE_URL}/connect/v1/vehicles`, {
      headers: {
        'Authorization': `Bearer ${req.session.accessToken}`,
        'User-Agent': CONFIG.USER_AGENT,
        'x-client-id': CONFIG.X_CLIENT_ID
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Vehicles API error:', errorText);
      return res.status(response.status).json({ error: 'Failed to fetch vehicles' });
    }

    const vehicles = await response.json();

    // Log vehicle info for each vehicle
    console.log('\n========== VEHICLE INFO ==========');
    for (const vehicle of vehicles) {
      console.log('VIN:', vehicle.vin);
      console.log('Model Name:', vehicle.modelName);
      console.log('Model Type:', JSON.stringify(vehicle.modelType, null, 2));
      console.log('System Info:', JSON.stringify(vehicle.systemInfo, null, 2));
      console.log('Color:', vehicle.color);
      console.log('Connect:', JSON.stringify(vehicle.connect, null, 2));
      console.log('Vehicle User Type:', vehicle.vehicleUserType);
      console.log('Grey Connect Store URL:', vehicle.greyConnectStoreURL);
      console.log('Timestamp:', vehicle.timestamp);
      console.log('Commands:', vehicle.commands?.map(c => c.id || c).join(', '));
      console.log('Measurements:', vehicle.measurements?.map(m => m.key || m).join(', '));
      console.log('All keys:', Object.keys(vehicle));
      console.log('-----------------------------------');
    }
    console.log('===================================\n');

    res.json(vehicles);

  } catch (error) {
    console.error('Vehicles error:', error);
    res.status(500).json({ error: 'Failed to fetch vehicles' });
  }
});

// Get vehicle overview (status, battery, location, etc.)
app.get('/api/vehicles/:vin/overview', requireAuth, async (req, res) => {
  const { vin } = req.params;

  try {
    const measurements = MEASUREMENTS.map(m => `mf=${m}`).join('&');
    const response = await fetch(
      `${CONFIG.API_BASE_URL}/connect/v1/vehicles/${vin}?${measurements}`,
      {
        headers: {
          'Authorization': `Bearer ${req.session.accessToken}`,
          'User-Agent': CONFIG.USER_AGENT,
          'x-client-id': CONFIG.X_CLIENT_ID
        }
      }
    );

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch vehicle overview' });
    }

    const data = await response.json();

    // Log overview measurements
    console.log('\n========== VEHICLE OVERVIEW ==========');
    console.log('VIN:', data.vin);
    if (data.measurements) {
      for (const m of data.measurements) {
        console.log(`${m.key}:`, JSON.stringify(m.value, null, 2));
      }
    }
    console.log('=======================================\n');

    res.json(data);

  } catch (error) {
    console.error('Overview error:', error);
    res.status(500).json({ error: 'Failed to fetch vehicle overview' });
  }
});

// Get trip statistics
app.get('/api/vehicles/:vin/trips', requireAuth, async (req, res) => {
  const { vin } = req.params;
  // type parameter available for future filtering: 'short' or 'long'

  try {
    const measurements = TRIP_STATISTICS.map(m => `mf=${m}`).join('&');
    const response = await fetch(
      `${CONFIG.API_BASE_URL}/connect/v1/vehicles/${vin}?${measurements}`,
      {
        headers: {
          'Authorization': `Bearer ${req.session.accessToken}`,
          'User-Agent': CONFIG.USER_AGENT,
          'x-client-id': CONFIG.X_CLIENT_ID
        }
      }
    );

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch trips' });
    }

    const data = await response.json();

    // Log the response structure for debugging
    console.log('[Trips] API response keys:', Object.keys(data));
    if (data.measurements) {
      console.log('[Trips] Measurements found:', data.measurements.map(m => m.key));
      for (const m of data.measurements) {
        if (m.value?.list) {
          console.log(`[Trips] ${m.key} has ${m.value.list.length} entries in list`);
          if (m.value.list.length > 0) {
            console.log(`[Trips] ${m.key} first entry:`, JSON.stringify(m.value.list[0], null, 2));
          }
        } else if (m.value?.entries) {
          console.log(`[Trips] ${m.key} has ${m.value.entries.length} entries`);
        } else if (m.value) {
          console.log(`[Trips] ${m.key} value:`, JSON.stringify(m.value, null, 2).slice(0, 500));
        }
      }
    } else {
      console.log('[Trips] Full response:', JSON.stringify(data, null, 2).slice(0, 2000));
    }

    res.json(data);

  } catch (error) {
    console.error('Trips error:', error);
    res.status(500).json({ error: 'Failed to fetch trips' });
  }
});

// Get full vehicle status (all measurements)
app.get('/api/vehicles/:vin/status', requireAuth, async (req, res) => {
  const { vin } = req.params;

  try {
    const measurements = ALL_MEASUREMENTS.map(m => `mf=${m}`).join('&');
    const response = await fetch(
      `${CONFIG.API_BASE_URL}/connect/v1/vehicles/${vin}?${measurements}`,
      {
        headers: {
          'Authorization': `Bearer ${req.session.accessToken}`,
          'User-Agent': CONFIG.USER_AGENT,
          'x-client-id': CONFIG.X_CLIENT_ID
        }
      }
    );

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch vehicle status' });
    }

    const data = await response.json();

    // Log comprehensive vehicle status
    console.log('\n' + '='.repeat(60));
    console.log('              FULL VEHICLE STATUS');
    console.log('='.repeat(60));
    console.log('VIN:', data.vin);
    console.log('Model:', data.modelName);
    console.log('-'.repeat(60));

    if (data.measurements) {
      // Group measurements by category for cleaner output
      const battery = [];
      const doors = [];
      const tires = [];
      const climate = [];
      const service = [];
      const other = [];

      for (const m of data.measurements) {
        if (m.key.includes('BATTERY') || m.key.includes('CHARGING') || m.key.includes('E_RANGE') || m.key === 'RANGE') {
          battery.push(m);
        } else if (m.key.includes('OPEN_STATE') || m.key.includes('LOCK_STATE')) {
          doors.push(m);
        } else if (m.key.includes('TIRE')) {
          tires.push(m);
        } else if (m.key.includes('CLIMAT') || m.key.includes('HEATING') || m.key.includes('HVAC')) {
          climate.push(m);
        } else if (m.key.includes('SERVICE') || m.key.includes('OIL')) {
          service.push(m);
        } else {
          other.push(m);
        }
      }

      const formatValue = (val) => {
        const str = JSON.stringify(val, null, 2);
        return str ? str.replace(/\n/g, '\n    ') : 'null';
      };

      if (battery.length > 0) {
        console.log('\n📋 BATTERY & CHARGING:');
        for (const m of battery) {
          console.log(`  ${m.key}:`, formatValue(m.value));
        }
      }

      if (doors.length > 0) {
        console.log('\n🚪 DOORS, WINDOWS & LIDS:');
        for (const m of doors) {
          console.log(`  ${m.key}:`, JSON.stringify(m.value) || 'null');
        }
      }

      if (tires.length > 0) {
        console.log('\n🛞 TIRE PRESSURE:');
        for (const m of tires) {
          console.log(`  ${m.key}:`, formatValue(m.value));
        }
      }

      if (climate.length > 0) {
        console.log('\n❄️ CLIMATE:');
        for (const m of climate) {
          console.log(`  ${m.key}:`, JSON.stringify(m.value) || 'null');
        }
      }

      if (service.length > 0) {
        console.log('\n🔧 SERVICE:');
        for (const m of service) {
          console.log(`  ${m.key}:`, JSON.stringify(m.value) || 'null');
        }
      }

      if (other.length > 0) {
        console.log('\n📍 OTHER:');
        for (const m of other) {
          const val = JSON.stringify(m.value) || 'null';
          // Truncate very long values
          console.log(`  ${m.key}:`, val.length > 200 ? val.slice(0, 200) + '...' : val);
        }
      }
    }

    console.log('\n' + '='.repeat(60) + '\n');

    res.json(data);

  } catch (error) {
    console.error('Status error:', error);
    res.status(500).json({ error: 'Failed to fetch vehicle status' });
  }
});

// Get vehicle capabilities
app.get('/api/vehicles/:vin/capabilities', requireAuth, async (req, res) => {
  const { vin } = req.params;

  try {
    const response = await fetch(
      `${CONFIG.API_BASE_URL}/connect/v1/vehicles/${vin}/capabilities`,
      {
        headers: {
          'Authorization': `Bearer ${req.session.accessToken}`,
          'User-Agent': CONFIG.USER_AGENT,
          'x-client-id': CONFIG.X_CLIENT_ID
        }
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.log('\n' + '='.repeat(60));
      console.log('              VEHICLE CAPABILITIES');
      console.log('='.repeat(60));
      console.log('  ⚠️  Capabilities endpoint not available for this vehicle');
      console.log('  (This is normal - not all vehicles/regions support this)');
      console.log('='.repeat(60) + '\n');
      return res.status(response.status).json({ error: 'Capabilities not available', details: errorText });
    }

    const data = await response.json();

    console.log('\n' + '='.repeat(60));
    console.log('              VEHICLE CAPABILITIES');
    console.log('='.repeat(60));
    console.log(JSON.stringify(data, null, 2));
    console.log('='.repeat(60) + '\n');

    res.json(data);

  } catch (error) {
    console.error('Capabilities error:', error);
    res.status(500).json({ error: 'Failed to fetch capabilities' });
  }
});

// Get vehicle pictures
app.get('/api/vehicles/:vin/pictures', requireAuth, async (req, res) => {
  const { vin } = req.params;

  try {
    const response = await fetch(
      `${CONFIG.API_BASE_URL}/connect/v1/vehicles/${vin}/pictures`,
      {
        headers: {
          'Authorization': `Bearer ${req.session.accessToken}`,
          'User-Agent': CONFIG.USER_AGENT,
          'x-client-id': CONFIG.X_CLIENT_ID
        }
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Pictures API error:', errorText);
      return res.status(response.status).json({ error: 'Failed to fetch pictures' });
    }

    const data = await response.json();

    console.log('\n' + '='.repeat(60));
    console.log('              VEHICLE PICTURES');
    console.log('='.repeat(60));
    if (Array.isArray(data)) {
      for (const pic of data) {
        console.log(`  ${pic.view || pic.perspective || 'unknown'}:`, pic.url || pic);
      }
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
    console.log('='.repeat(60) + '\n');

    res.json(data);

  } catch (error) {
    console.error('Pictures error:', error);
    res.status(500).json({ error: 'Failed to fetch pictures' });
  }
});

// Logout endpoint
app.post('/api/auth/logout', (req, res) => {
  const { sessionId } = req.body;
  const session = tokenStore.get(sessionId);
  if (session) {
    console.log(`[Auth] Logging out ${session.email}`);
  }
  tokenStore.delete(sessionId);
  saveTokens(); // Persist deletion
  res.json({ success: true });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Bind to 0.0.0.0 to allow access from other devices on the local network (e.g., mobile testing)
// This is safe as this server is for LOCAL DEVELOPMENT ONLY and is never deployed.
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Porsche Connect proxy server running on port ${PORT} (all interfaces)`);
  console.log(`API endpoints:`);
  console.log(`  POST /api/auth/login - Authenticate with Porsche Connect`);
  console.log(`  POST /api/auth/refresh - Refresh access token`);
  console.log(`  GET  /api/vehicles - List vehicles`);
  console.log(`  GET  /api/vehicles/:vin/overview - Get vehicle status (basic)`);
  console.log(`  GET  /api/vehicles/:vin/status - Get full vehicle status (all measurements)`);
  console.log(`  GET  /api/vehicles/:vin/capabilities - Get vehicle capabilities`);
  console.log(`  GET  /api/vehicles/:vin/pictures - Get vehicle pictures`);
  console.log(`  GET  /api/vehicles/:vin/trips - Get trip statistics`);
});
