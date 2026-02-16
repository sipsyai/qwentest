import { HistoryItem } from '../types';

const STORAGE_KEY = 'forge_history';
const MAX_ITEMS = 100;

export const getHistory = (): HistoryItem[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
};

export const addHistoryItem = (item: Omit<HistoryItem, 'id'>) => {
  const history = getHistory();
  const newItem: HistoryItem = {
    ...item,
    id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  };
  history.unshift(newItem);
  // Keep only the most recent MAX_ITEMS
  if (history.length > MAX_ITEMS) {
    history.length = MAX_ITEMS;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  return newItem;
};

export const clearHistory = () => {
  localStorage.removeItem(STORAGE_KEY);
};

export const deleteHistoryItem = (id: string) => {
  const history = getHistory().filter(item => item.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
};

// Helper to log a chat completion request
export const logChatRequest = (
  model: string,
  promptPreview: string,
  responsePreview: string,
  durationMs: number,
  status: number,
  statusText: string,
  tokenEstimate: number
) => {
  addHistoryItem({
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
};

// Helper to log an embedding request
export const logEmbeddingRequest = (
  model: string,
  inputCount: number,
  durationMs: number,
  status: number,
  statusText: string,
  tokenCount: number
) => {
  addHistoryItem({
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
};
