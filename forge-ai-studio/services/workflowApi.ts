// Workflow API Client — Pipeline builder for chaining agents

const KB_BASE = '/api/kb';

// --- Interfaces ---

export interface WorkflowStep {
  id: string;
  agentId: string;
  agentName: string;
  /** Maps variable names to values or references:
   *  - literal string: used as-is
   *  - "{{prev_output}}": output of previous step
   *  - "{{step:step_id}}": output of a specific step by ID
   */
  variableMappings: Record<string, string>;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  created_at: string;
  updated_at: string;
}

export interface WorkflowCreate {
  name: string;
  description?: string;
  steps: WorkflowStep[];
}

export interface WorkflowUpdate {
  name?: string;
  description?: string;
  steps?: WorkflowStep[];
}

// --- CRUD ---

export async function getWorkflows(): Promise<{ data: Workflow[]; total: number }> {
  const res = await fetch(`${KB_BASE}/workflows`);
  if (!res.ok) throw new Error(`Failed to list workflows: ${res.status}`);
  return res.json();
}

export async function getWorkflow(id: string): Promise<Workflow> {
  const res = await fetch(`${KB_BASE}/workflows/${id}`);
  if (!res.ok) throw new Error(`Failed to get workflow: ${res.status}`);
  return res.json();
}

export async function createWorkflow(data: WorkflowCreate): Promise<Workflow> {
  const res = await fetch(`${KB_BASE}/workflows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to create workflow: ${res.status}`);
  return res.json();
}

export async function updateWorkflow(id: string, data: WorkflowUpdate): Promise<Workflow> {
  const res = await fetch(`${KB_BASE}/workflows/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to update workflow: ${res.status}`);
  return res.json();
}

export async function deleteWorkflow(id: string): Promise<void> {
  const res = await fetch(`${KB_BASE}/workflows/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete workflow: ${res.status}`);
}

// --- Run Workflow (SSE stream) ---

export interface WorkflowRunCallbacks {
  onStepStart?: (data: { step_id: string; index: number; agent_name: string; agent_id: string }) => void;
  onStepStream?: (data: { step_id: string; index: number; content: string }) => void;
  onStepDone?: (data: { step_id: string; index: number; output_preview: string; output_length: number }) => void;
  onStepError?: (data: { step_id: string; index: number; error: string }) => void;
  // Agentic sub-events within a step
  onStepToolCall?: (data: { step_id: string; step_index: number; tool: string; args: any; call_id: string }) => void;
  onStepToolResult?: (data: { step_id: string; step_index: number; tool: string; result: string }) => void;
  onWorkflowDone?: (data: { total_steps: number }) => void;
  onError?: (msg: string) => void;
  onComplete?: () => void;
}

export async function runWorkflow(
  workflowId: string,
  variables: Record<string, string>,
  callbacks: WorkflowRunCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const res = await fetch(`${KB_BASE}/workflows/${workflowId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variables }),
      signal,
    });

    if (!res.ok) {
      const text = await res.text();
      callbacks.onError?.(`Server error ${res.status}: ${text}`);
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      callbacks.onError?.('No response body');
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

          if (currentEventType) {
            switch (currentEventType) {
              case 'step_start':
                callbacks.onStepStart?.(parsed);
                break;
              case 'step_stream':
                callbacks.onStepStream?.(parsed);
                break;
              case 'step_done':
                callbacks.onStepDone?.(parsed);
                break;
              case 'step_error':
                callbacks.onStepError?.(parsed);
                break;
              case 'step_tool_call':
                callbacks.onStepToolCall?.(parsed);
                break;
              case 'step_tool_result':
                callbacks.onStepToolResult?.(parsed);
                break;
              case 'workflow_done':
                callbacks.onWorkflowDone?.(parsed);
                break;
            }
            currentEventType = '';
            continue;
          }
        } catch {
          // skip
        }
      }
    }
    callbacks.onComplete?.();
  } catch (err: any) {
    if (err.name === 'AbortError') return;
    callbacks.onError?.(err.message || 'Unknown error');
  }
}
