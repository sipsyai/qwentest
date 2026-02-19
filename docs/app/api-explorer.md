# API Explorer

Interactive API endpoint testing page for Forge AI Studio.

## Features

- **35 endpoints** across 11 categories: Chat, Embeddings, Models, Tokenizer, Health, KB Documents, Datasets, Dataset Records, Agents, Workflows, History
- Request builder with method badge, URL, and editable JSON body
- JSON syntax coloring (single-pass regex colorizer)
- SSE streaming support for chat/agent endpoints
- Response panel with status code, timing, and formatted output
- URL-based endpoint routing: `/api-explorer/:endpointId`
- Category sidebar with endpoint count badges
- Search/filter across all endpoints

## Files

| File | Description |
|------|-------------|
| `pages/ApiExplorer.tsx` | Page component (891 lines) |
| `services/apiCatalog.ts` | Endpoint catalog definitions (914 lines) |
| `test-api-explorer-endpoints.py` | 47-test validation suite |

## Routes

- `/api-explorer` — Main page (first endpoint auto-selected)
- `/api-explorer/:endpointId` — Direct link to specific endpoint
