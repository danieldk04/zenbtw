/**
 * Google Indexing API client.
 * Zelfde service account JWT pattern als gsc-client.js.
 * Scope: https://www.googleapis.com/auth/indexing
 * Requires: GOOGLE_SERVICE_ACCOUNT_JSON env var
 */

import { createSign } from 'crypto';

const INDEXING_SCOPE = 'https://www.googleapis.com/auth/indexing';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const INDEXING_API = 'https://indexing.googleapis.com/v3/urlNotifications:publish';

function b64url(obj) {
  return Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)).toString('base64url');
}

async function getAccessToken(key) {
  const now = Math.floor(Date.now() / 1000);
  const header  = { alg: 'RS256', typ: 'JWT' };
  const payload = { iss: key.client_email, scope: INDEXING_SCOPE, aud: TOKEN_URL, exp: now + 3600, iat: now };
  const unsigned = `${b64url(header)}.${b64url(payload)}`;
  const sign = createSign('RSA-SHA256');
  sign.update(unsigned);
  const jwt = `${unsigned}.${sign.sign(key.private_key, 'base64url')}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt })
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Indexing token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

export function available() {
  return !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
}

/**
 * Meld URL-updates aan Google Indexing API.
 * Google crawlt deze URLs prioritair de volgende dag.
 */
export async function notifyUrlUpdated(urls) {
  if (!available()) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON niet ingesteld');
  if (!urls.length) return { success: 0, failed: 0 };

  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const key = JSON.parse(keyJson);
  const token = await getAccessToken(key);

  let success = 0;
  let failed = 0;

  for (const url of urls) {
    try {
      const res = await fetch(INDEXING_API, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url, type: 'URL_UPDATED' })
      });

      if (res.ok) {
        success++;
      } else {
        const txt = await res.text();
        console.warn(`Indexing push mislukt voor ${url}: ${res.status} ${txt.slice(0, 100)}`);
        failed++;
      }
    } catch (err) {
      console.warn(`Indexing push error ${url}: ${err.message}`);
      failed++;
    }
  }

  return { success, failed };
}
