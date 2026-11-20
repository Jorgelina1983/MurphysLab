import type { OkxCredentials } from '../feed/okxTrade';
import { loadJson } from './storage';

/** Where the demo key is kept in this browser. Demo keys only: the secret is stored as typed. */
export const OKX_KEYS = 'murphy-signal-lab.okx-demo.v1';
export const NO_KEYS: OkxCredentials = { apiKey: '', secret: '', passphrase: '' };

/** The demo key saved from the Orden tab, or `null` when there is none. */
export function loadDemoKeys(): OkxCredentials | null {
  const c = { ...NO_KEYS, ...loadJson<Partial<OkxCredentials>>(OKX_KEYS, {}) };
  return c.apiKey && c.secret && c.passphrase ? c : null;
}
