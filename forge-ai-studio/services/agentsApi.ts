// Agents API Client

const KB_BASE = '/api/kb';

// --- Interfaces ---

export interface AgentVariable {
  name: string;
  label: string;
  defaultValue: string;
}

export interface AgentConfig {
  systemPrompt: string;
  selectedModel: string;
  stream: boolean;
  thinking: boolean;
  jsonMode: boolean;
  temperature: number;
  topP: number;
  topK: number;
  maxTokens: number;
  presencePenalty: number;
  frequencyPenalty: number;
  repetitionPenalty: number;
  seed: string;
  stopSequences: string;
  ragEnabled: boolean;
  ragTopK: number;
  ragThreshold: number;
  ragSources: string[];
  promptTemplate: string;
  variables: AgentVariable[];
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  config: AgentConfig;
  created_at: string;
  updated_at: string;
}

export interface AgentCreate {
  name: string;
  description?: string;
  config: AgentConfig;
}

export interface AgentUpdate {
  name?: string;
  description?: string;
  config?: AgentConfig;
}

// --- CRUD ---

export async function getAgents(): Promise<{ data: Agent[]; total: number }> {
  const res = await fetch(`${KB_BASE}/agents`);
  if (!res.ok) throw new Error(`Failed to list agents: ${res.status}`);
  return res.json();
}

export async function getAgent(id: string): Promise<Agent> {
  const res = await fetch(`${KB_BASE}/agents/${id}`);
  if (!res.ok) throw new Error(`Failed to get agent: ${res.status}`);
  return res.json();
}

export async function createAgent(data: AgentCreate): Promise<Agent> {
  const res = await fetch(`${KB_BASE}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to create agent: ${res.status}`);
  return res.json();
}

export async function updateAgent(id: string, data: AgentUpdate): Promise<Agent> {
  const res = await fetch(`${KB_BASE}/agents/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to update agent: ${res.status}`);
  return res.json();
}

export async function deleteAgent(id: string): Promise<void> {
  const res = await fetch(`${KB_BASE}/agents/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete agent: ${res.status}`);
}

// --- Variable extraction ---

export function extractVariables(template: string): string[] {
  const matches = template.matchAll(/\{\{(\w+)\}\}/g);
  const vars = new Set<string>();
  for (const m of matches) {
    if (m[1] !== 'context') vars.add(m[1]);
  }
  return [...vars];
}

// --- Run Agent (SSE stream) ---

export async function runAgent(
  agentId: string,
  variables: Record<string, string>,
  onChunk: (chunk: string) => void,
  onComplete: () => void,
  onError: (err: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const res = await fetch(`${KB_BASE}/agents/${agentId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variables, stream: true }),
      signal,
    });

    if (!res.ok) {
      const text = await res.text();
      onError(`Server error ${res.status}: ${text}`);
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      onError('No response body');
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') {
          onComplete();
          return;
        }
        try {
          const parsed = JSON.parse(payload);
          if (parsed.error) {
            onError(parsed.error);
            return;
          }
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) onChunk(delta);
        } catch {
          // skip non-JSON lines
        }
      }
    }
    onComplete();
  } catch (err: any) {
    if (err.name === 'AbortError') return;
    onError(err.message || 'Unknown error');
  }
}
