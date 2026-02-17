// Settings API - In-memory cache + PostgreSQL persistence with localStorage fallback

const KB_BASE = '/api/kb';

// --- In-memory cache ---
let settingsCache: Record<string, string> = {};
let dbAvailable = false;

// --- Default values ---
const DEFAULTS: Record<string, string> = {
  forge_chat_url: '/api/chat',
  forge_embed_url: '/api/embed',
  forge_chat_fallback_url: '',
  forge_embed_fallback_url: '',
  forge_api_key: 'EMPTY',
  ds_api_url: '/api/strapi',
  ds_api_token: '',
  ds_endpoint: 'knowledge-bases',
};

// --- localStorage helpers ---
function readLocalStorage(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of Object.keys(DEFAULTS)) {
    const val = localStorage.getItem(key);
    if (val !== null) result[key] = val;
  }
  return result;
}

function writeLocalStorage(settings: Record<string, string>) {
  for (const [key, value] of Object.entries(settings)) {
    localStorage.setItem(key, value);
  }
}

// --- Init: migrate + fetch from DB ---
export async function initSettings(): Promise<void> {
  // 1. Load from localStorage as initial values
  const localData = readLocalStorage();
  settingsCache = { ...DEFAULTS, ...localData };

  try {
    // 2. Migrate localStorage → DB (one-time, idempotent)
    const migrated = localStorage.getItem('forge_settings_migrated');
    if (!migrated && Object.keys(localData).length > 0) {
      await fetch(`${KB_BASE}/settings/migrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: localData }),
      });
      localStorage.setItem('forge_settings_migrated', 'true');
    }

    // 3. Fetch from DB (source of truth)
    const res = await fetch(`${KB_BASE}/settings`);
    if (res.ok) {
      const data = await res.json();
      settingsCache = { ...DEFAULTS, ...data.settings };
      dbAvailable = true;
      // Sync back to localStorage as backup
      writeLocalStorage(settingsCache);
    }
  } catch {
    // DB unreachable → keep localStorage values in cache
    dbAvailable = false;
  }
}

// --- Sync getters (from cache) ---
export const getChatBaseUrl = (): string => settingsCache.forge_chat_url || DEFAULTS.forge_chat_url;
export const getEmbedBaseUrl = (): string => settingsCache.forge_embed_url || DEFAULTS.forge_embed_url;
export const getChatFallbackUrl = (): string => settingsCache.forge_chat_fallback_url || '';
export const getEmbedFallbackUrl = (): string => settingsCache.forge_embed_fallback_url || '';
export const getApiKey = (): string => settingsCache.forge_api_key || DEFAULTS.forge_api_key;
export const getDsApiUrl = (): string => settingsCache.ds_api_url || DEFAULTS.ds_api_url;
export const getDsApiToken = (): string => settingsCache.ds_api_token || '';
export const getDsEndpoint = (): string => settingsCache.ds_endpoint || DEFAULTS.ds_endpoint;

// Legacy compat
export const getBaseUrl = getChatBaseUrl;

// Get all settings (sync, from cache)
export const getAllSettings = (): Record<string, string> => ({ ...settingsCache });

// --- Async setters (DB + cache + localStorage) ---

export async function setConfig(
  chatUrl: string,
  embedUrl: string,
  key: string,
  chatFallback?: string,
  embedFallback?: string,
): Promise<void> {
  const updates: Record<string, string> = {
    forge_chat_url: chatUrl,
    forge_embed_url: embedUrl,
    forge_api_key: key,
    forge_chat_fallback_url: chatFallback || '',
    forge_embed_fallback_url: embedFallback || '',
  };
  await updateSettings(updates);
}

export async function updateSettings(updates: Record<string, string>): Promise<void> {
  // Update cache immediately
  Object.assign(settingsCache, updates);
  // Always write to localStorage as backup
  writeLocalStorage(updates);

  if (dbAvailable) {
    try {
      await fetch(`${KB_BASE}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: updates }),
      });
    } catch {
      // DB write failed — localStorage already has the values
    }
  }
}
