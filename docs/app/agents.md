# Agents

## Overview
Agents are saved Playground configurations (model, parameters, system prompt, RAG settings) that can be re-executed directly from the Agents page without navigating back to Playground.

## Key Features

### Template Variables
Prompt templates support `{{varName}}` syntax for dynamic variable injection.
- Variables are auto-detected on save via `extractVariables()` utility
- `{{context}}` is reserved for RAG context injection and excluded from variable detection
- Each variable gets a label and optional default value

### Direct Execution (Run Modal)
Agents with a `promptTemplate` can be executed directly:
1. Click "Run" on agent card
2. Fill in variable inputs (pre-populated with defaults)
3. Streaming response with markdown rendering + think tag support
4. Copy output / Stop generation controls

Legacy agents (without `promptTemplate`) navigate to Playground with pre-loaded config.

### History Tracking
Agent runs are logged to `request_history` with:
- `agent` field: agent name
- `variables` field: variable key-value pairs used in the run

## API Endpoints

### POST /api/kb/agents/{id}/run
Execute an agent with variable substitution.

**Request Body:**
```json
{
  "variables": { "topic": "machine learning", "style": "formal" },
  "stream": true
}
```

**Response:** SSE stream (same format as vLLM chat completions)

**Pipeline:**
1. Load agent config from DB
2. Substitute `{{varName}}` in promptTemplate with provided variables
3. If RAG enabled: embed query, search pgvector, inject context
4. Proxy to vLLM chat completions (streaming)
5. Log to request_history with agent name + variables

### Existing CRUD Endpoints
- `GET /api/kb/agents` - List all agents
- `GET /api/kb/agents/{id}` - Get single agent
- `POST /api/kb/agents` - Create agent
- `PUT /api/kb/agents/{id}` - Update agent
- `DELETE /api/kb/agents/{id}` - Delete agent

## Database Table: saved_agents

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Agent name |
| description | TEXT | Agent description |
| config | JSONB | Full agent configuration (model, params, prompts, RAG, variables) |
| created_at | TIMESTAMPTZ | Creation timestamp |
| updated_at | TIMESTAMPTZ | Last update timestamp |

## Frontend Files
- `pages/Agents.tsx` - Agent cards + Run modal UI
- `services/agentsApi.ts` - Types, CRUD, extractVariables(), runAgent() SSE client
