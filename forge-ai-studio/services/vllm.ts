import { Model } from '../types';
import {
  getChatBaseUrl,
  getEmbedBaseUrl,
  getChatFallbackUrl,
  getEmbedFallbackUrl,
  getApiKey,
} from './settingsApi';

// --- Config: re-exported from settingsApi (DB-backed + cache) ---
export {
  getChatBaseUrl,
  getEmbedBaseUrl,
  getChatFallbackUrl,
  getEmbedFallbackUrl,
  getApiKey,
  getBaseUrl,
  setConfig,
} from './settingsApi';

// --- Fallback fetch helper ---

async function fetchWithFallback(url: string, fallbackUrl: string, options: RequestInit): Promise<Response> {
  try {
    return await fetch(url, options);
  } catch (err) {
    if (!fallbackUrl || fallbackUrl === url) throw err;
    if (!(err instanceof TypeError)) throw err;
    if (options.signal?.aborted) throw err;
    console.warn(`[fallback] ${url} failed, retrying with ${fallbackUrl}`);
    return await fetch(fallbackUrl, options);
  }
}

// --- Fetch models from vLLM chat server ---

export const fetchVLLMModels = async (): Promise<Model[]> => {
  const baseUrl = getChatBaseUrl();
  const fallbackUrl = getChatFallbackUrl();
  const apiKey = getApiKey();

  const options: RequestInit = {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  };
  const response = await fetchWithFallback(
    `${baseUrl}/models`,
    fallbackUrl ? `${fallbackUrl}/models` : '',
    options
  );

  if (!response.ok) throw new Error(`Server returned ${response.status} ${response.statusText}`);

  const data = await response.json();

  if (!data || !data.data || !Array.isArray(data.data)) {
    console.warn("Unexpected API response format:", data);
    return [];
  }

  return data.data.map((m: any) => ({
    id: m.id,
    name: m.id,
    provider: 'vLLM Hosted',
    size: 'N/A',
    quantization: 'N/A',
    format: 'Safetensors/Pytorch',
    lastModified: new Date(m.created * 1000).toLocaleDateString(),
    parameters: 'Unknown',
    contextWindow: m.max_model_len || 8192,
    vram: 'Dynamic',
    description: `Hosted model: ${m.object}`,
    tags: ['VLLM', 'CHAT']
  }));
};

// --- Fetch embedding models from vLLM embed server ---

export const fetchEmbedModels = async (): Promise<string[]> => {
  const baseUrl = getEmbedBaseUrl();
  const fallbackUrl = getEmbedFallbackUrl();
  const apiKey = getApiKey();

  try {
    const options: RequestInit = {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    };
    const response = await fetchWithFallback(
      `${baseUrl}/models`,
      fallbackUrl ? `${fallbackUrl}/models` : '',
      options
    );

    if (!response.ok) return [];
    const data = await response.json();
    if (!data?.data) return [];
    return data.data.map((m: any) => m.id);
  } catch {
    return [];
  }
};

// --- Chat Completion Stream with AbortController ---

export interface ChatCompletionParams {
  temperature: number;
  top_p: number;
  max_tokens: number;
  top_k?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  repetition_penalty?: number;
  seed?: number | null;
  stop?: string[];
  response_format?: { type: string };
  chat_template_kwargs?: Record<string, any>;
}

export const streamChatCompletion = async (
  modelId: string,
  messages: { role: string; content: string }[],
  params: ChatCompletionParams,
  onChunk: (chunk: string) => void,
  onComplete: () => void,
  onError: (err: any) => void,
  signal?: AbortSignal
) => {
  const baseUrl = getChatBaseUrl();
  const fallbackUrl = getChatFallbackUrl();
  const apiKey = getApiKey();

  try {
    const body: any = {
      model: modelId,
      messages,
      temperature: params.temperature,
      top_p: params.top_p,
      max_tokens: params.max_tokens,
      stream: true,
    };

    // Optional params - only include if set
    if (params.top_k !== undefined && params.top_k > 0) body.top_k = params.top_k;
    if (params.presence_penalty !== undefined && params.presence_penalty !== 0) body.presence_penalty = params.presence_penalty;
    if (params.frequency_penalty !== undefined && params.frequency_penalty !== 0) body.frequency_penalty = params.frequency_penalty;
    if (params.repetition_penalty !== undefined && params.repetition_penalty !== 1) body.repetition_penalty = params.repetition_penalty;
    if (params.seed !== undefined && params.seed !== null) body.seed = params.seed;
    if (params.stop && params.stop.length > 0) body.stop = params.stop;
    if (params.response_format) body.response_format = params.response_format;
    if (params.chat_template_kwargs) body.chat_template_kwargs = params.chat_template_kwargs;

    const response = await fetchWithFallback(
      `${baseUrl}/chat/completions`,
      fallbackUrl ? `${fallbackUrl}/chat/completions` : '',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      }
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      throw new Error(`API Error ${response.status}: ${errText}`);
    }
    if (!response.body) throw new Error('No response body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let done = false;
    let buffer = '';

    while (!done) {
      const { value, done: readerDone } = await reader.read();
      done = readerDone;
      if (value) {
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep the last potentially incomplete line in buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const jsonStr = trimmed.slice(6);
            if (jsonStr === '[DONE]') {
              onComplete();
              return;
            }
            try {
              const json = JSON.parse(jsonStr);
              const content = json.choices?.[0]?.delta?.content || '';
              if (content) onChunk(content);
            } catch {
              // Ignore parse errors for partial chunks
            }
          }
        }
      }
    }
    onComplete();
  } catch (error: any) {
    if (error.name === 'AbortError') {
      onComplete();
      return;
    }
    onError(error);
  }
};

// --- Generate Embeddings ---

export interface EmbeddingResult {
  object: string;
  embedding: number[];
  index: number;
}

export interface EmbeddingResponse {
  model: string;
  data: EmbeddingResult[];
  usage: { prompt_tokens: number; total_tokens: number };
}

export const generateEmbeddings = async (
  model: string,
  input: string[],
  signal?: AbortSignal
): Promise<EmbeddingResponse> => {
  const baseUrl = getEmbedBaseUrl();
  const fallbackUrl = getEmbedFallbackUrl();
  const apiKey = getApiKey();

  const response = await fetchWithFallback(
    `${baseUrl}/embeddings`,
    fallbackUrl ? `${fallbackUrl}/embeddings` : '',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, input }),
      signal,
    }
  );

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    throw new Error(`Embedding API Error ${response.status}: ${errText}`);
  }

  return response.json();
};
