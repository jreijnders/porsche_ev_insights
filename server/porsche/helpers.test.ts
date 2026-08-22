import { describe, expect, it } from 'vitest';

import {
  buildPKCEChallenge,
  extractUniversalLoginContext,
  mergeCookies,
  readInputValue,
  readLegacyCaptchaSrc,
  resolveUrl,
} from './helpers.js';

/** Builds a Response whose getSetCookie() returns the given headers. */
function withSetCookie(values: string[]): Response {
  const headers = new Headers();
  for (const v of values) headers.append('set-cookie', v);
  return new Response(null, { headers });
}

describe('buildPKCEChallenge', () => {
  it('matches the RFC 7636 S256 test vector', () => {
    // RFC 7636 appendix B: verifier -> challenge
    expect(buildPKCEChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});

describe('mergeCookies', () => {
  it('adds new cookies to an empty jar', () => {
    expect(mergeCookies('', withSetCookie(['a=1; Path=/', 'b=2; HttpOnly']))).toBe('a=1; b=2');
  });

  it('replaces a cookie of the same name rather than duplicating it', () => {
    const merged = mergeCookies('a=1; b=2', withSetCookie(['a=99; Path=/']));
    expect(merged).toBe('a=99; b=2');
    expect(merged.split('; ').filter((c) => c.startsWith('a='))).toHaveLength(1);
  });

  it('keeps existing cookies when the response sets none', () => {
    expect(mergeCookies('a=1; b=2', new Response(null))).toBe('a=1; b=2');
  });
});

describe('resolveUrl', () => {
  it('passes absolute URLs through', () => {
    expect(resolveUrl('https://example.com/x', 'https://base.test')).toBe('https://example.com/x');
  });

  it('resolves a relative location against the base', () => {
    expect(resolveUrl('/u/login/password', 'https://identity.porsche.com')).toBe(
      'https://identity.porsche.com/u/login/password',
    );
  });

  it('returns null for a missing location', () => {
    expect(resolveUrl(null, 'https://base.test')).toBeNull();
  });
});

describe('extractUniversalLoginContext', () => {
  it('decodes the base64 JSON out of an atob() call', () => {
    const context = { state: 'abc123', screen: { captcha: { image: 'data:image/png;base64,AAA' } } };
    const encoded = Buffer.from(JSON.stringify(context)).toString('base64');
    const html = `<script>var ctx = JSON.parse(atob("${encoded}"));</script>`;
    expect(extractUniversalLoginContext(html)).toEqual(context);
  });

  it('returns null when the page has no context', () => {
    expect(extractUniversalLoginContext('<html><body>nope</body></html>')).toBeNull();
  });

  it('returns null rather than throwing on undecodable payloads', () => {
    expect(extractUniversalLoginContext('atob("bm90IGpzb24=")')).toBeNull();
  });
});

describe('readInputValue', () => {
  it('reads a hidden state input', () => {
    expect(readInputValue('<input name="state" value="s-42">', 'state')).toBe('s-42');
  });

  it('returns null when absent', () => {
    expect(readInputValue('<input name="other" value="x">', 'state')).toBeNull();
  });
});

describe('readLegacyCaptchaSrc', () => {
  it('finds the legacy captcha image', () => {
    expect(readLegacyCaptchaSrc('<img alt="captcha" src="/c.png">')).toBe('/c.png');
  });

  it('returns null when there is no captcha', () => {
    expect(readLegacyCaptchaSrc('<img alt="logo" src="/l.png">')).toBeNull();
  });
});
