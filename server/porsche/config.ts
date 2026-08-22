/**
 * Porsche Connect configuration, carried over verbatim from
 * api/porsche/_utils.js and api/porsche/login.js.
 *
 * These values impersonate the Android app. They are the reason the flow works
 * at all — do not "tidy" them. When Porsche next changes the flow, this is the
 * first place to look.
 */
export const CONFIG = {
  API_BASE_URL: 'https://api.ppa.porsche.com/app',
  X_CLIENT_ID: '09fcb5d8-d4ad-48e8-a0e8-a9c7cb1b9cbc',
  USER_AGENT: 'de.porsche.one/18.26.09-row+162630 (android)',
  AUTHORIZATION_SERVER: 'identity.porsche.com',
  CLIENT_ID: 'qIkoJqlAXvbj4R3j12ct3zdinPId0Zbl',
  REDIRECT_URI: 'https://security.porsche.com/auth/en-GB/app/callback',
  SCOPES: [
    'openid', 'profile', 'email', 'offline_access', 'mbb', 'ssodb',
    'badge', 'vin', 'dealers', 'cars', 'charging', 'manageCharging',
    'pid:user_profile.porscheid:read', 'pid:user_profile.vehicles:read',
  ],
} as const;

export const AUTH_BASE_URL = `https://${CONFIG.AUTHORIZATION_SERVER}`;
