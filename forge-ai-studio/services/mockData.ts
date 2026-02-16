import { Model, HistoryItem, EmbeddingSession } from '../types';

export const MOCK_MODELS: Model[] = [
  {
    id: 'Qwen/Qwen3-4B',
    name: 'Qwen3-4B',
    provider: 'Qwen (Alibaba)',
    size: '~8 GB',
    quantization: 'FP16',
    format: 'Safetensors',
    lastModified: 'Recently',
    parameters: '4B',
    contextWindow: 32768,
    vram: '~8 GB',
    description: 'Qwen3 4B parameter model with thinking mode support. Optimized for chat and reasoning.',
    tags: ['QWEN', 'CHAT', 'THINKING']
  },
  {
    id: 'nomic-ai/nomic-embed-text-v1.5',
    name: 'nomic-embed-text-v1.5',

    provider: 'Nomic AI',
    size: '~0.5 GB',
    quantization: 'FP16',
    format: 'Safetensors',
    lastModified: 'Recently',
    parameters: '137M',
    contextWindow: 8192,
    vram: '~1 GB',
    description: 'Open-source text embedding model with 768 dimensions. Great for semantic search and RAG.',
    tags: ['NOMIC', 'EMBEDDING']
  }
];

export const MOCK_HISTORY: HistoryItem[] = [
  {
    id: 'req_mock_1',
    method: 'POST',
    endpoint: '/v1/chat/completions',
    model: 'Qwen/Qwen3-4B',
    timestamp: new Date().toLocaleString(),
    duration: '1.2s',
    tokens: 512,
    status: 200,
    statusText: 'OK',
    preview: 'Merhaba! Size nasil yardimci olabilirim?'
  },
  {
    id: 'req_mock_2',
    method: 'POST',
    endpoint: '/v1/embeddings',
    model: 'nomic-embed-text-v1.5',
    timestamp: new Date().toLocaleString(),
    duration: '85ms',
    tokens: 42,
    status: 200,
    statusText: 'OK',
    preview: 'Generated embeddings for 4 input(s)'
  }
];

export const MOCK_EMBEDDING_SESSION: EmbeddingSession = {
  id: 'sess_1',
  model: 'nomic-embed-text-v1.5',
  dimensions: 768,
  tokens: 42,
  totalVectors: 4,
  status: 'COMPLETED'
};

export const MOCK_VECTORS = [
  { val: 0.0213 }, { val: -0.1042 }, { val: 0.0967 }, { val: -0.0012 },
  { val: 0.0861 }, { val: 0.6342 }, { val: -0.0521 }, { val: 0.0123 },
  { val: 0.1102 }, { val: -0.0763 }, { val: 0.0441 }, { val: 0.0234 },
  { val: -0.5288 }, { val: 0.0672 }, { val: 0.0552 }, { val: -0.0092 },
  { val: 0.0432 }, { val: 0.0121 }, { val: -0.0345 }, { val: 0.0221 }
];
