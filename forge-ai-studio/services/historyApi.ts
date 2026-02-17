// History API - PostgreSQL persistence (no localStorage)

import { HistoryItem } from '../types';

const KB_BASE = '/api/kb';

// --- Public API ---

export async function getHistory(page = 1, limit = 100): Promise<{ data: HistoryItem[]; total: number }> {
  try {
    const res = await fetch(`${KB_BASE}/history?page=${page}&limit=${limit}`);
    if (!res.ok) throw new Error('fetch failed');
    const json = await res.json();
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
    return { data: [], total: 0 };
  }
}

export async function addHistoryItem(item: Omit<HistoryItem, 'id'>): Promise<HistoryItem> {
  const newItem: HistoryItem = {
    ...item,
    id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  };

  try {
    await fetch(`${KB_BASE}/history`, {
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
  } catch {
    // DB write failed — item lost for this request
  }

  return newItem;
}

export async function deleteHistoryItem(id: string): Promise<void> {
  try {
    await fetch(`${KB_BASE}/history/${id}`, { method: 'DELETE' });
  } catch {
    // ignore
  }
}

export async function clearHistory(): Promise<void> {
  try {
    await fetch(`${KB_BASE}/history`, { method: 'DELETE' });
  } catch {
    // ignore
  }
}

// --- Convenience loggers ---

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
