import { randomBytes }                from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join }                        from 'node:path';

// ── Types ──────────────────────────────────────────────────────────────────

export interface LicenseRecord {
  key:        string;
  sessionId:  string;
  customerId: string;
  email:      string;
  tier:       string;
  status:     'pending' | 'active' | 'revoked';
  trialEnd:   number | null;
  createdAt:  number;
}

export interface LicenseStore {
  byKey:     Record<string, LicenseRecord>;
  bySession: Record<string, string>;  // sessionId → key
}

// ── State ──────────────────────────────────────────────────────────────────

const STATE_FILE = join(process.cwd(), '.killcord-licenses.json');

let store: LicenseStore = { byKey: {}, bySession: {} };

// ── Key generation ─────────────────────────────────────────────────────────

export function generateLicenseKey(): string {
  return `kc_${randomBytes(32).toString('hex')}`;
}

// ── CRUD ───────────────────────────────────────────────────────────────────

export function createLicense(record: Omit<LicenseRecord, 'createdAt'>): LicenseRecord {
  const full: LicenseRecord = { ...record, createdAt: Date.now() };
  store.byKey[full.key]         = full;
  store.bySession[full.sessionId] = full.key;
  return full;
}

export function getLicenseByKey(key: string): LicenseRecord | undefined {
  return store.byKey[key];
}

export function getLicenseBySession(sessionId: string): LicenseRecord | undefined {
  const key = store.bySession[sessionId];
  return key ? store.byKey[key] : undefined;
}

export function setLicenseStatus(key: string, status: LicenseRecord['status']): boolean {
  const rec = store.byKey[key];
  if (!rec) return false;
  rec.status = status;
  return true;
}

// ── IPC sync ───────────────────────────────────────────────────────────────
// Workers receive the full store snapshot from the primary after each update.

export function getLicenseStore(): LicenseStore {
  return store;
}

export function setLicenseStore(snapshot: LicenseStore): void {
  store = snapshot;
}

// ── Persistence ────────────────────────────────────────────────────────────

export function loadLicenseState(): void {
  try {
    const raw    = readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<LicenseStore>;
    store.byKey     = parsed.byKey     ?? {};
    store.bySession = parsed.bySession ?? {};
    const count = Object.keys(store.byKey).length;
    if (count > 0) console.log(`[killcord] Loaded ${count} license record(s) from disk.`);
  } catch {
    // File doesn't exist on first run — start fresh
  }
}

export function saveLicenseState(): void {
  try {
    writeFileSync(STATE_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.error('[killcord] Failed to save license state:', err);
  }
}
