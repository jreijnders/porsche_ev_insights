/**
 * The Porsche Connect login walk: a 5-step Auth0 PKCE flow against
 * identity.porsche.com, ported from api/porsche/login.js.
 *
 * PORTED, NOT IMPROVED (#9, #18). The step order, the redirect-follow limits,
 * the passkey-enrollment skip and the fallbacks for finding `state` are all
 * load-bearing and were arrived at empirically. If you are tempted to
 * simplify something here, read git log for 942c78e and af1aebd first.
 *
 * The one structural change from the original: instead of base64-encoding the
 * cookie jar and PKCE verifier into a blob handed to the browser, a captcha
 * pause returns `pending` state for the caller to keep server-side.
 */

import { AUTH_BASE_URL, CONFIG } from './config.js';
import {
  buildPKCEChallenge,
  extractUniversalLoginContext,
  generatePKCEVerifier,
  generateState,
  mergeCookies,
  readInputValue,
  readLegacyCaptchaSrc,
  resolveUrl,
} from './helpers.js';

/** State that must survive a captcha pause. Never sent to the browser. */
export interface PendingLogin {
  cookies: string;
  state: string;
  codeVerifier: string;
  email: string;
}

export interface PorscheTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  email: string;
}

export type LoginResult =
  | { kind: 'tokens'; tokens: PorscheTokens }
  | { kind: 'captcha'; image: string; pending: PendingLogin }
  | { kind: 'error'; status: number; message: string };

interface LoginInput {
  email: string;
  password: string;
  captchaCode?: string;
  /** Present when resuming after a captcha. */
  pending?: PendingLogin;
}

const jsonHeaders = { 'Content-Type': 'application/x-www-form-urlencoded' } as const;

function ua(cookies?: string): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': CONFIG.USER_AGENT };
  if (cookies) headers.Cookie = cookies;
  return headers;
}

export async function login(input: LoginInput): Promise<LoginResult> {
  const { email, password, captchaCode } = input;

  let cookies = input.pending?.cookies ?? '';
  let loginState = input.pending?.state ?? '';
  const codeVerifier = input.pending?.codeVerifier ?? generatePKCEVerifier();

  // ---- Step 1: initialise the authorization request with PKCE ------------
  // Skipped entirely when resuming a captcha, since we already hold cookies.
  if (!cookies) {
    const state = generateState();
    const authUrl = new URL(`${AUTH_BASE_URL}/authorize`);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', CONFIG.CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', CONFIG.REDIRECT_URI);
    authUrl.searchParams.set('scope', CONFIG.SCOPES.join(' '));
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('audience', 'https://api.porsche.com');
    authUrl.searchParams.set('response_mode', 'query');
    authUrl.searchParams.set('code_challenge', buildPKCEChallenge(codeVerifier));
    authUrl.searchParams.set('code_challenge_method', 'S256');

    const authResponse = await fetch(authUrl.toString(), {
      method: 'GET',
      headers: ua(),
      redirect: 'manual',
    });
    cookies = mergeCookies(cookies, authResponse);

    const location = resolveUrl(authResponse.headers.get('location'), AUTH_BASE_URL);
    let loginPageHtml = '';

    if (location) {
      // The redirect URL's `state` param is the most reliable source.
      try {
        const urlState = new URL(location).searchParams.get('state');
        if (urlState) loginState = urlState;
      } catch {
        /* ignore parse errors — other fallbacks below */
      }

      let loginPageUrl: string | null = location;
      let loginPageResponse: Response | undefined;
      for (let i = 0; i < 5 && loginPageUrl; i++) {
        loginPageResponse = await fetch(loginPageUrl, { headers: ua(cookies), redirect: 'manual' });
        cookies = mergeCookies(cookies, loginPageResponse);
        if (loginPageResponse.status === 302 || loginPageResponse.status === 301) {
          loginPageUrl = resolveUrl(loginPageResponse.headers.get('location'), AUTH_BASE_URL);
        } else {
          break;
        }
      }
      loginPageHtml = loginPageResponse ? await loginPageResponse.text() : '';
    } else {
      loginPageHtml = await authResponse.text();
    }

    // ACUL pages embed state in base64 JSON; fall back to a hidden input.
    const ulContext = extractUniversalLoginContext(loginPageHtml);
    if (ulContext?.state) {
      loginState = ulContext.state;
    } else if (!loginState) {
      loginState = readInputValue(loginPageHtml, 'state') ?? state;
    }
  }

  // ---- Step 2: submit the email (identifier-first) -----------------------
  const identifierBody: Record<string, string> = {
    state: loginState,
    username: email,
    'js-available': 'true',
    'webauthn-available': 'false',
    'is-brave': 'false',
    'webauthn-platform-available': 'false',
    action: 'default',
  };
  if (captchaCode) identifierBody.captcha = captchaCode;

  const identifierResponse = await fetch(`${AUTH_BASE_URL}/u/login/identifier`, {
    method: 'POST',
    headers: { ...jsonHeaders, ...ua(cookies) },
    body: new URLSearchParams(identifierBody).toString(),
    redirect: 'manual',
  });
  cookies = mergeCookies(cookies, identifierResponse);

  if (identifierResponse.status === 400) {
    const errorHtml = await identifierResponse.text();
    const errorContext = extractUniversalLoginContext(errorHtml);
    const captchaSrc = errorContext?.screen?.captcha?.image ?? readLegacyCaptchaSrc(errorHtml);

    if (captchaSrc) {
      return {
        kind: 'captcha',
        image: captchaSrc,
        pending: {
          cookies,
          state: errorContext?.transaction?.state ?? loginState,
          codeVerifier,
          email,
        },
      };
    }

    const message =
      errorContext?.screen?.errors?.[0]?.message ??
      errorContext?.screen?.error?.message ??
      'Invalid email address';
    return { kind: 'error', status: 400, message };
  }

  // ---- Step 2b: follow to the password page, collecting cookies ----------
  if (identifierResponse.status === 302) {
    let idRedirect = resolveUrl(identifierResponse.headers.get('location'), AUTH_BASE_URL);
    for (let i = 0; i < 5 && idRedirect; i++) {
      const idRedirectResp = await fetch(idRedirect, { headers: ua(cookies), redirect: 'manual' });
      cookies = mergeCookies(cookies, idRedirectResp);
      if (idRedirectResp.status === 302 || idRedirectResp.status === 301) {
        idRedirect = resolveUrl(idRedirectResp.headers.get('location'), AUTH_BASE_URL);
      } else {
        const pwPageHtml = await idRedirectResp.text();
        const pwState = readInputValue(pwPageHtml, 'state');
        if (pwState) loginState = pwState;
        break;
      }
    }
  }

  // ---- Step 3: submit the password ---------------------------------------
  const passwordResponse = await fetch(`${AUTH_BASE_URL}/u/login/password`, {
    method: 'POST',
    headers: { ...jsonHeaders, ...ua(cookies) },
    body: new URLSearchParams({
      state: loginState,
      username: email,
      password,
      action: 'default',
    }).toString(),
    redirect: 'manual',
  });
  cookies = mergeCookies(cookies, passwordResponse);

  if (passwordResponse.status === 400) {
    return { kind: 'error', status: 401, message: 'Invalid credentials' };
  }

  // ---- Step 4: follow redirects to the authorization code ----------------
  // May pass through a passkey-enrollment page that has to be declined.
  let codeLocation = resolveUrl(passwordResponse.headers.get('location'), AUTH_BASE_URL);
  let authCode: string | null = null;

  for (let i = 0; i < 15 && codeLocation && !authCode; i++) {
    if (codeLocation.includes('code=')) {
      try {
        authCode = new URL(codeLocation).searchParams.get('code');
      } catch {
        authCode = codeLocation.match(/[?&]code=([^&]+)/)?.[1] ?? null;
      }
      break;
    }

    const redirectResponse = await fetch(codeLocation, { headers: ua(cookies), redirect: 'manual' });
    cookies = mergeCookies(cookies, redirectResponse);

    if ([301, 302, 303].includes(redirectResponse.status)) {
      codeLocation = resolveUrl(redirectResponse.headers.get('location'), AUTH_BASE_URL);
      continue;
    }

    const pageHtml = await redirectResponse.text();
    const loginContext = extractUniversalLoginContext(pageHtml);
    const isPasskeyPrompt =
      loginContext !== null && (pageHtml.includes('passkey') || pageHtml.includes('webauthn'));

    if (!isPasskeyPrompt) break;

    const skipResponse = await fetch(codeLocation, {
      method: 'POST',
      headers: { ...jsonHeaders, ...ua(cookies) },
      body: new URLSearchParams({
        state: readInputValue(pageHtml, 'state') ?? loginState,
        action: 'abort-passkey-enrollment',
        'acul-sdk': '@auth0/auth0-acul-js@1.2.0',
      }).toString(),
      redirect: 'manual',
    });
    cookies = mergeCookies(cookies, skipResponse);
    codeLocation = resolveUrl(skipResponse.headers.get('location'), AUTH_BASE_URL);
  }

  if (!authCode) {
    return { kind: 'error', status: 401, message: 'Failed to obtain authorization code' };
  }

  // ---- Step 5: exchange the code for tokens (PKCE) -----------------------
  const tokens = await exchange({
    grant_type: 'authorization_code',
    client_id: CONFIG.CLIENT_ID,
    code: authCode,
    redirect_uri: CONFIG.REDIRECT_URI,
    code_verifier: codeVerifier,
  });

  if (!tokens) return { kind: 'error', status: 401, message: 'Failed to exchange token' };
  return { kind: 'tokens', tokens: { ...tokens, email } };
}

interface TokenPayload {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

async function exchange(
  body: Record<string, string>,
): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date } | null> {
  const response = await fetch(`${AUTH_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: { ...jsonHeaders, ...ua() },
    body: new URLSearchParams(body).toString(),
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as TokenPayload;
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? '',
    expiresAt: new Date(Date.now() + payload.expires_in * 1000),
  };
}

/** Distinguishes a rejected grant (never retry) from a transient failure. */
export class RefreshRejectedError extends Error {}

/**
 * Exchanges a refresh token. Throws `RefreshRejectedError` when Porsche
 * rejects the grant outright — that means re-authentication, and per the
 * rate-limit research (#4) it must NOT be retried: a login retry loop is what
 * got a documented Porsche account blocked.
 */
export async function refresh(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
  const response = await fetch(`${AUTH_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: { ...jsonHeaders, ...ua() },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CONFIG.CLIENT_ID,
      refresh_token: refreshToken,
    }).toString(),
  });

  if (response.status >= 400 && response.status < 500) {
    throw new RefreshRejectedError(`Refresh rejected (${response.status})`);
  }
  if (!response.ok) {
    throw new Error(`Refresh failed transiently (${response.status})`);
  }

  const payload = (await response.json()) as TokenPayload;
  return {
    accessToken: payload.access_token,
    // Porsche does not always rotate the refresh token; keep the old one.
    refreshToken: payload.refresh_token ?? refreshToken,
    expiresAt: new Date(Date.now() + payload.expires_in * 1000),
  };
}
