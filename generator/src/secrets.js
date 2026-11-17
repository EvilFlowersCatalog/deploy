/**
 * Secrets for .env, made with WebCrypto (browser or Node). Nothing leaves the machine.
 * Alphanumeric only, so the values survive URLs, Docker Compose, kubectl and htpasswd.
 */

/** Keys `npm run configure` generates once and then keeps from an existing .env. */
export const SECRET_KEYS = ['SECRET_KEY', 'SECURED_VIEW_JWK', 'PGPASSWORD', 'ELVIRA_READIUM_PASSWORD', 'EVILFLOWERS_EMBEDDING_API_KEY'];

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function randomString(length, cryptoImpl = globalThis.crypto) {
  const out = [];
  const bytes = new Uint8Array(length * 2);
  while (out.length < length) {
    cryptoImpl.getRandomValues(bytes);
    for (const b of bytes) {
      // 248 = 4 × 62: drop the top values so every character is equally likely.
      if (b < 248 && out.length < length) out.push(ALPHABET[b % 62]);
    }
  }
  return out.join('');
}

/** An RSA private key as the JWK the catalog signs tokens with (SECURED_VIEW_JWK). */
export async function rsaJwk(cryptoImpl = globalThis.crypto) {
  const pair = await cryptoImpl.subtle.generateKey(
    {name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'},
    true,
    ['sign', 'verify'],
  );
  const {kty, n, e, d, p, q, dp, dq, qi} = await cryptoImpl.subtle.exportKey('jwk', pair.privateKey);
  return JSON.stringify({kty, n, e, d, p, q, dp, dq, qi});
}

/** An htpasswd line in the {SHA} scheme, which the Readium servers read. */
export async function htpasswd(user, password, cryptoImpl = globalThis.crypto) {
  const digest = new Uint8Array(await cryptoImpl.subtle.digest('SHA-1', new TextEncoder().encode(password)));
  return `${user}:{SHA}${btoa(String.fromCharCode(...digest))}`;
}

/**
 * Fresh secrets, with `keep` (an existing .env's values) taking precedence, and the htpasswd line
 * for the readium password that results.
 */
export async function generateSecrets(cryptoImpl = globalThis.crypto, keep = {}) {
  const fresh = {
    SECRET_KEY: randomString(50, cryptoImpl),
    SECURED_VIEW_JWK: await rsaJwk(cryptoImpl),
    PGPASSWORD: randomString(32, cryptoImpl),
    ELVIRA_READIUM_PASSWORD: randomString(32, cryptoImpl),
    EVILFLOWERS_EMBEDDING_API_KEY: randomString(48, cryptoImpl),
  };
  const secrets = {};
  for (const k of SECRET_KEYS) {
    secrets[k] = keep[k] && keep[k] !== 'change-me' ? keep[k] : fresh[k];
  }
  secrets.READIUM_HTPASSWD = await htpasswd('evilflowers', secrets.ELVIRA_READIUM_PASSWORD, cryptoImpl);
  return secrets;
}
