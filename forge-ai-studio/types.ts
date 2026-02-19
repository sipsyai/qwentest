export interface Model {
  id: string;
  name: string;
  provider: string;
  size: string;
  quantization: string;
  format: string;
  lastModified: string;
  parameters: string;
  contextWindow: number;
  vram: string;
  description: string;
  tags: string[];
}

export interface HistoryItem {
  id: string;
  method: 'POST' | 'GET';
  endpoint: string;
  model: string;
  timestamp: string;
  duration: string;
  tokens: number;
  status: number;
  statusText: string;
  preview: string;
  workflowId?: string | null;
  workflowName?: string | null;
  workflowStep?: number | null;
}

export interface HistoryItemDetail extends HistoryItem {
  requestPayload: {
    messages: { role: string; content: string }[];
    params: Record<string, any>;
    rag?: { enabled: boolean; topK: number; threshold: number; sources: string[]; contextCount: number };
    workflow?: { id: string; name: string; step: number };
  } | null;
  responsePayload: {
    text: string;
    truncated: boolean;
  } | null;
}

export interface EmbeddingSession {
  id: string;
  model: string;
  dimensions: number;
  tokens: number;
  totalVectors: number;
  status: 'COMPLETED' | 'PROCESSING';
}

export enum View {
  DASHBOARD = 'dashboard',
  PLAYGROUND = 'playground',
  MODELS = 'models',
  MODEL_DETAILS = 'model_details',
  DATASETS = 'datasets',
  HISTORY = 'history',
  SETTINGS = 'settings',
  EMBEDDINGS = 'embeddings'
}
