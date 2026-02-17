// History API - PostgreSQL persistence (no localStorage)

import { HistoryItem, HistoryItemDetail } from '../types';

const KB_BASE = '/api/kb';

const RESPONSE_TEXT_CAP = 50_000;

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

export async function getHistoryItem(id: string): Promise<HistoryItemDetail | null> {
  try {
    const res = await fetch(`${KB_BASE}/history/${id}`);
    if (!res.ok) return null;
    const item = await res.json();
    return {
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
      requestPayload: item.request_payload ?? null,
      responsePayload: item.response_payload ?? null,
    };
  } catch {
    return null;
  }
}

interface AddHistoryOptions {
  requestPayload?: Record<string, any>;
  responsePayload?: Record<string, any>;
}

export async function addHistoryItem(item: Omit<HistoryItem, 'id'>, options?: AddHistoryOptions): Promise<HistoryItem> {
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
        request_payload: options?.requestPayload ?? null,
        response_payload: options?.responsePayload ?? null,
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

export async function logChatRequest(log: {
  model: string;
  promptPreview: string;
  responsePreview: string;
  durationMs: number;
  status: number;
  statusText: string;
  tokenEstimate: number;
  messages?: { role: string; content: string }[];
  params?: Record<string, any>;
  fullResponse?: string;
  ragConfig?: { enabled: boolean; topK: number; threshold: number; sources: string[]; contextCount: number };
}): Promise<void> {
  const fullText = log.fullResponse ?? '';
  const truncated = fullText.length > RESPONSE_TEXT_CAP;
  const cappedText = truncated ? fullText.slice(0, RESPONSE_TEXT_CAP) : fullText;

  await addHistoryItem(
    {
      method: 'POST',
      endpoint: '/v1/chat/completions',
      model: log.model,
      timestamp: new Date().toLocaleString(),
      duration: log.durationMs < 1000 ? `${log.durationMs}ms` : `${(log.durationMs / 1000).toFixed(1)}s`,
      tokens: log.tokenEstimate,
      status: log.status,
      statusText: log.statusText,
      preview: log.responsePreview.slice(0, 150),
    },
    {
      requestPayload: log.messages
        ? {
            messages: log.messages,
            params: log.params ?? {},
            ...(log.ragConfig ? { rag: log.ragConfig } : {}),
          }
        : undefined,
      responsePayload: log.fullResponse !== undefined
        ? { text: cappedText, truncated }
        : undefined,
    }
  );
}

export async function logEmbeddingRequest(log: {
  model: string;
  inputCount: number;
  durationMs: number;
  status: number;
  statusText: string;
  tokenCount: number;
  inputs?: string[];
  dimensions?: number;
  totalVectors?: number;
}): Promise<void> {
  await addHistoryItem(
    {
      method: 'POST',
      endpoint: '/v1/embeddings',
      model: log.model,
      timestamp: new Date().toLocaleString(),
      duration: log.durationMs < 1000 ? `${log.durationMs}ms` : `${(log.durationMs / 1000).toFixed(1)}s`,
      tokens: log.tokenCount,
      status: log.status,
      statusText: log.statusText,
      preview: `Generated embeddings for ${log.inputCount} input(s)`,
    },
    {
      requestPayload: log.inputs
        ? {
            messages: log.inputs.map(t => ({ role: 'input', content: t })),
            params: { model: log.model, inputCount: log.inputCount },
          }
        : undefined,
      responsePayload: log.dimensions !== undefined
        ? {
            text: `Generated ${log.totalVectors ?? log.inputCount} vectors with ${log.dimensions} dimensions. Total tokens: ${log.tokenCount}.`,
            truncated: false,
          }
        : undefined,
    }
  );
}
