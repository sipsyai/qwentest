// Agents API Client - Agentic Architecture

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
  ragSourceAliases?: Record<string, string>;
  promptTemplate: string;
  variables: AgentVariable[];
  // Agentic fields
  agentMode: 'simple' | 'react' | 'plan-execute';
  enabledTools: string[];
  maxIterations: number;
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

export interface ToolInfo {
  name: string;
  description: string;
}

// --- Agent Step types for execution viewer ---

export type AgentStepType =
  | 'agent_start'
  | 'iteration_start'
  | 'tool_call'
  | 'tool_result'
  | 'final_answer_start'
  | 'stream'
  | 'agent_done'
  | 'error';

export interface AgentStep {
  type: AgentStepType;
  data: any;
  timestamp: number;
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

// --- Available Tools ---

export async function getAvailableTools(): Promise<ToolInfo[]> {
  const res = await fetch(`${KB_BASE}/agents/tools`);
  if (!res.ok) throw new Error(`Failed to list tools: ${res.status}`);
  const data = await res.json();
  return data.tools;
}

// --- Variable extraction ---

export function extractVariables(template: string, ragAliasValues?: string[]): string[] {
  const reserved = new Set(['context', ...(ragAliasValues ?? [])]);
  const matches = template.matchAll(/\{\{(\w+)\}\}/g);
  const vars = new Set<string>();
  for (const m of matches) {
    if (!reserved.has(m[1])) vars.add(m[1]);
  }
  return [...vars];
}

// --- Run Agent (SSE stream - backward compatible for simple mode) ---

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

// --- Run Agent (Agentic mode with typed SSE events) ---

export interface AgentRunCallbacks {
  onAgentStart?: (data: { mode: string; max_iterations: number; tools: string[] }) => void;
  onIterationStart?: (data: { iteration: number }) => void;
  onToolCall?: (data: { iteration: number; tool: string; args: any; call_id: string }) => void;
  onToolResult?: (data: { iteration: number; tool: string; call_id: string; result: string }) => void;
  onFinalAnswerStart?: (data: { iteration: number }) => void;
  onStream?: (data: { content: string }) => void;
  onAgentDone?: (data: { iterations: number; tools_used: string[]; total_tool_calls: number }) => void;
  onError?: (data: { message: string }) => void;
  // Fallback for simple mode chunks
  onChunk?: (chunk: string) => void;
  onComplete?: () => void;
}

export async function runAgentAgentic(
  agentId: string,
  variables: Record<string, string>,
  callbacks: AgentRunCallbacks,
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
      callbacks.onError?.({ message: `Server error ${res.status}: ${text}` });
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      callbacks.onError?.({ message: 'No response body' });
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let currentEventType = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        // SSE event type line
        if (line.startsWith('event: ')) {
          currentEventType = line.slice(7).trim();
          continue;
        }

        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();

        if (payload === '[DONE]') {
          callbacks.onComplete?.();
          return;
        }

        try {
          const parsed = JSON.parse(payload);

          if (parsed.error) {
            callbacks.onError?.({ message: parsed.error });
            return;
          }

          // Route by event type (agentic mode)
          if (currentEventType) {
            switch (currentEventType) {
              case 'agent_start':
                callbacks.onAgentStart?.(parsed);
                break;
              case 'iteration_start':
                callbacks.onIterationStart?.(parsed);
                break;
              case 'tool_call':
                callbacks.onToolCall?.(parsed);
                break;
              case 'tool_result':
                callbacks.onToolResult?.(parsed);
                break;
              case 'final_answer_start':
                callbacks.onFinalAnswerStart?.(parsed);
                break;
              case 'stream':
                callbacks.onStream?.(parsed);
                break;
              case 'agent_done':
                callbacks.onAgentDone?.(parsed);
                break;
              case 'error':
                callbacks.onError?.(parsed);
                break;
            }
            currentEventType = '';
            continue;
          }

          // Fallback: simple mode (standard OpenAI streaming format)
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            callbacks.onChunk?.(delta);
            callbacks.onStream?.({ content: delta });
          }
        } catch {
          // skip non-JSON lines
        }
      }
    }
    callbacks.onComplete?.();
  } catch (err: any) {
    if (err.name === 'AbortError') return;
    callbacks.onError?.({ message: err.message || 'Unknown error' });
  }
}
