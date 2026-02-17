// History API - PostgreSQL persistence with localStorage fallback

import { HistoryItem } from '../types';

const KB_BASE = '/api/kb';
const LS_KEY = 'forge_history';
let dbAvailable = false;

// --- localStorage fallback helpers ---

function readLocalStorageHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// --- Public API ---

export async function getHistory(page = 1, limit = 100): Promise<{ data: HistoryItem[]; total: number }> {
  try {
    const res = await fetch(`${KB_BASE}/history?page=${page}&limit=${limit}`);
    if (!res.ok) throw new Error('fetch failed');
    const json = await res.json();
    dbAvailable = true;
    return {
      data: json.data.map((item: any) => ({
        id: item.id,
        method: item.method,
        endpoint: item.endpoint,
        model: item.model,
        timestamp: item.timestamp,
        duration: item.duration,
        tokens: item.tokens,
        status: item.status,
        statusText: item.status_text,
        preview: item.preview,
      })),
      total: json.total,
    };
  } catch {
    dbAvailable = false;
    const all = readLocalStorageHistory();
    const start = (page - 1) * limit;
    return { data: all.slice(start, start + limit), total: all.length };
  }
}

export async function addHistoryItem(item: Omit<HistoryItem, 'id'>): Promise<HistoryItem> {
  const newItem: HistoryItem = {
    ...item,
    id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  };

  try {
    const res = await fetch(`${KB_BASE}/history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: newItem.id,
        method: newItem.method,
        endpoint: newItem.endpoint,
        model: newItem.model,
        timestamp: newItem.timestamp,
        duration: newItem.duration,
        tokens: newItem.tokens,
        status: newItem.status,
        status_text: newItem.statusText,
        preview: newItem.preview,
      }),
    });
    if (res.ok) dbAvailable = true;
  } catch {
    // fallback: write to localStorage
    dbAvailable = false;
    const history = readLocalStorageHistory();
    history.unshift(newItem);
    if (history.length > 100) history.length = 100;
    localStorage.setItem(LS_KEY, JSON.stringify(history));
  }

  return newItem;
}

export async function deleteHistoryItem(id: string): Promise<void> {
  try {
    await fetch(`${KB_BASE}/history/${id}`, { method: 'DELETE' });
  } catch {
    // fallback
    const history = readLocalStorageHistory().filter(item => item.id !== id);
    localStorage.setItem(LS_KEY, JSON.stringify(history));
  }
}

export async function clearHistory(): Promise<void> {
  try {
    await fetch(`${KB_BASE}/history`, { method: 'DELETE' });
  } catch {
    localStorage.removeItem(LS_KEY);
  }
}

// --- Convenience loggers (same signatures as old history.ts) ---

export async function logChatRequest(
  model: string,
  promptPreview: string,
  responsePreview: string,
  durationMs: number,
  status: number,
  statusText: string,
  tokenEstimate: number,
): Promise<void> {
  await addHistoryItem({
    method: 'POST',
    endpoint: '/v1/chat/completions',
    model,
    timestamp: new Date().toLocaleString(),
    duration: durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`,
    tokens: tokenEstimate,
    status,
    statusText,
    preview: responsePreview.slice(0, 150),
  });
}

export async function logEmbeddingRequest(
  model: string,
  inputCount: number,
  durationMs: number,
  status: number,
  statusText: string,
  tokenCount: number,
): Promise<void> {
  await addHistoryItem({
    method: 'POST',
    endpoint: '/v1/embeddings',
    model,
    timestamp: new Date().toLocaleString(),
    duration: durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`,
    tokens: tokenCount,
    status,
    statusText,
    preview: `Generated embeddings for ${inputCount} input(s)`,
  });
}

// --- One-time migration from localStorage ---

export async function migrateHistoryFromLocalStorage(): Promise<void> {
  if (localStorage.getItem('forge_history_migrated') === 'true') return;

  const localHistory = readLocalStorageHistory();
  if (localHistory.length === 0) {
    localStorage.setItem('forge_history_migrated', 'true');
    return;
  }

  try {
    const items = localHistory.map(item => ({
      id: item.id,
      method: item.method,
      endpoint: item.endpoint,
      model: item.model,
      timestamp: item.timestamp,
      duration: item.duration,
      tokens: item.tokens,
      status: item.status,
      status_text: item.statusText,
      preview: item.preview,
    }));

    const res = await fetch(`${KB_BASE}/history/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(items),
    });

    if (res.ok) {
      localStorage.setItem('forge_history_migrated', 'true');
    }
  } catch {
    // Migration failed — will retry next boot
  }
}
