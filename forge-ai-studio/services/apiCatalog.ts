// API Catalog — Endpoint definitions for API Explorer
// Source of truth: kb-service/main.py + vLLM proxy endpoints

// --- Types ---

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
export type ParamLocation = 'path' | 'query' | 'body';
export type ResponseType = 'json' | 'sse' | 'text';

export interface ParamDef {
  name: string;
  location: ParamLocation;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
  description: string;
  default?: any;
  example?: any;
}

export interface SseEventDef {
  event: string;
  description: string;
  dataShape?: string;
}

export interface EndpointDef {
  id: string;
  method: HttpMethod;
  path: string;
  summary: string;
  description: string;
  category: string;
  tags: string[];
  params: ParamDef[];
  responseType: ResponseType;
  exampleRequest?: any;
  exampleResponse?: any;
  sseEvents?: SseEventDef[];
  outputKey?: string;
  aiNotes?: string;
}

export interface CategoryDef {
  key: string;
  label: string;
  icon: string;
  description: string;
}

// --- Categories ---

export const CATEGORIES: CategoryDef[] = [
  { key: 'documents', label: 'KB Documents', icon: 'FileText', description: 'Knowledge Base document CRUD (pgvector)' },
  { key: 'search', label: 'Search', icon: 'Search', description: 'Semantic + hybrid (BM25 + RRF) search' },
  { key: 'stats', label: 'KB Stats', icon: 'BarChart3', description: 'Knowledge Base statistics and maintenance' },
  { key: 'settings', label: 'Settings', icon: 'Settings', description: 'Application settings persistence' },
  { key: 'history', label: 'History', icon: 'History', description: 'Request history tracking' },
  { key: 'datasets', label: 'Datasets', icon: 'Database', description: 'External data source connectors' },
  { key: 'records', label: 'Dataset Records', icon: 'FileJson', description: 'Saved dataset records management' },
  { key: 'agents', label: 'Agents', icon: 'Bot', description: 'Agent CRUD + execution (simple/ReAct)' },
  { key: 'workflows', label: 'Workflows', icon: 'GitBranch', description: 'Multi-step pipeline orchestration' },
  { key: 'chat', label: 'Chat Completions', icon: 'MessageSquare', description: 'vLLM chat/text completion endpoints' },
  { key: 'embeddings', label: 'Embeddings', icon: 'Cpu', description: 'vLLM embedding generation' },
];

// --- Method badge colors ---

export const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  POST: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  PUT: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  DELETE: 'bg-red-500/20 text-red-400 border-red-500/30',
};

// --- Endpoints ---

export const ENDPOINTS: EndpointDef[] = [

  // ==================== KB Documents ====================

  {
    id: 'kb-documents-add',
    method: 'POST',
    path: '/api/kb/documents',
    summary: 'Add documents with embeddings',
    description: 'Batch insert documents into the Knowledge Base. Each document must include pre-computed embedding vectors. Duplicates (same md5 of text) are silently skipped.',
    category: 'documents',
    tags: ['kb', 'documents', 'insert', 'batch', 'embeddings'],
    responseType: 'json',
    params: [
      { name: 'documents', location: 'body', type: 'array', required: true, description: 'Array of documents with text, embedding, source, source_label', example: [{ text: 'Sample document', embedding: [0.1, 0.2, 0.3], source: 'manual', source_label: 'Test' }] },
    ],
    exampleRequest: {
      documents: [
        { text: 'How to reset your password: Go to Settings > Security > Reset Password', embedding: [0.01, 0.02, 0.03], source: 'manual', source_label: 'ITSM KB' },
      ],
    },
    exampleResponse: { message: 'Added 1 documents', count: 1 },
    outputKey: 'count',
    aiNotes: 'Embeddings must be pre-computed via /api/embed/embeddings before calling this. The embedding dimension must match the pgvector index (768 for nomic-embed-text).',
  },
  {
    id: 'kb-documents-list',
    method: 'GET',
    path: '/api/kb/documents',
    summary: 'List documents (paginated)',
    description: 'Retrieve KB documents with optional source/source_label filtering. Returns documents without embedding vectors for performance.',
    category: 'documents',
    tags: ['kb', 'documents', 'list', 'paginated'],
    responseType: 'json',
    params: [
      { name: 'source', location: 'query', type: 'string', required: false, description: 'Filter by source type', example: 'manual' },
      { name: 'source_label', location: 'query', type: 'string', required: false, description: 'Filter by source label', example: 'ITSM KB' },
      { name: 'page', location: 'query', type: 'number', required: false, description: 'Page number (1-based)', default: 1 },
      { name: 'limit', location: 'query', type: 'number', required: false, description: 'Items per page (1-200)', default: 50 },
    ],
    exampleResponse: {
      data: [{ id: 'uuid', text: 'Document text...', source: 'manual', source_label: 'ITSM KB', created_at: '2025-01-01T00:00:00' }],
      total: 150, page: 1, limit: 50,
    },
    outputKey: 'data',
  },
  {
    id: 'kb-documents-delete',
    method: 'DELETE',
    path: '/api/kb/documents/{doc_id}',
    summary: 'Delete a single document',
    description: 'Remove a document from the Knowledge Base by its UUID. Returns 404 if not found.',
    category: 'documents',
    tags: ['kb', 'documents', 'delete'],
    responseType: 'json',
    params: [
      { name: 'doc_id', location: 'path', type: 'string', required: true, description: 'Document UUID' },
    ],
    exampleResponse: { message: 'Document deleted' },
  },
  {
    id: 'kb-documents-bulk-delete',
    method: 'POST',
    path: '/api/kb/documents/bulk-delete',
    summary: 'Bulk delete documents',
    description: 'Delete multiple documents by their UUIDs in a single request.',
    category: 'documents',
    tags: ['kb', 'documents', 'delete', 'bulk'],
    responseType: 'json',
    params: [
      { name: 'ids', location: 'body', type: 'array', required: true, description: 'Array of document UUIDs to delete', example: ['uuid-1', 'uuid-2'] },
    ],
    exampleRequest: { ids: ['uuid-1', 'uuid-2'] },
    exampleResponse: { deleted: 2 },
    outputKey: 'deleted',
  },

  // ==================== Search ====================

  {
    id: 'kb-search',
    method: 'POST',
    path: '/api/kb/search',
    summary: 'Semantic search (pgvector cosine)',
    description: 'Search the Knowledge Base using a pre-computed embedding vector. Returns ranked results above the similarity threshold. Supports optional source_label filtering.',
    category: 'search',
    tags: ['kb', 'search', 'semantic', 'pgvector', 'cosine'],
    responseType: 'json',
    params: [
      { name: 'embedding', location: 'body', type: 'array', required: true, description: 'Query embedding vector (768-dim for nomic-embed-text)' },
      { name: 'top_k', location: 'body', type: 'number', required: false, description: 'Max results to return', default: 5 },
      { name: 'threshold', location: 'body', type: 'number', required: false, description: 'Minimum cosine similarity (0-1)', default: 0.3 },
      { name: 'sources', location: 'body', type: 'array', required: false, description: 'Filter by source_label values' },
    ],
    exampleRequest: { embedding: [0.01, 0.02, 0.03], top_k: 5, threshold: 0.3, sources: ['ITSM KB'] },
    exampleResponse: {
      results: [{ id: 'uuid', text: 'Password reset guide...', source: 'manual', source_label: 'ITSM KB', similarity: 0.87, created_at: '2025-01-01T00:00:00' }],
      search_time_ms: 12,
    },
    outputKey: 'results',
    aiNotes: 'Chain tip: First call /api/embed/embeddings to get the query vector, then pipe it here. The "sources" field filters by source_label, not source.',
  },

  // ==================== KB Stats ====================

  {
    id: 'kb-stats',
    method: 'GET',
    path: '/api/kb/stats',
    summary: 'Get KB statistics',
    description: 'Returns total document count, per-source breakdown, and distinct source labels. Useful for monitoring KB health.',
    category: 'stats',
    tags: ['kb', 'stats', 'count', 'sources'],
    responseType: 'json',
    params: [],
    exampleResponse: { total: 250, sources: { manual: 100, dataset: 150 }, source_labels: ['ITSM KB', 'Form Templates'] },
    outputKey: 'total',
  },
  {
    id: 'kb-clear',
    method: 'DELETE',
    path: '/api/kb/clear',
    summary: 'Clear all KB documents',
    description: 'Permanently deletes ALL documents from the Knowledge Base. This is irreversible.',
    category: 'stats',
    tags: ['kb', 'clear', 'delete', 'all', 'dangerous'],
    responseType: 'json',
    params: [],
    exampleResponse: { message: 'Cleared 250 documents', count: 250 },
    aiNotes: 'DESTRUCTIVE: This deletes every document. Use GET /api/kb/stats first to verify the count before clearing.',
  },

  // ==================== Settings ====================

  {
    id: 'settings-get',
    method: 'GET',
    path: '/api/kb/settings',
    summary: 'Get all settings',
    description: 'Returns all application settings as key-value pairs from PostgreSQL.',
    category: 'settings',
    tags: ['settings', 'config', 'preferences'],
    responseType: 'json',
    params: [],
    exampleResponse: { settings: { forge_chat_url: '/api/chat', forge_embed_url: '/api/embed', forge_model: 'Qwen/Qwen3-4B' } },
    outputKey: 'settings',
  },
  {
    id: 'settings-update',
    method: 'PUT',
    path: '/api/kb/settings',
    summary: 'Update settings',
    description: 'Upsert application settings. Existing keys are updated, new keys are created. Returns the full settings object after update.',
    category: 'settings',
    tags: ['settings', 'config', 'update', 'upsert'],
    responseType: 'json',
    params: [
      { name: 'settings', location: 'body', type: 'object', required: true, description: 'Key-value pairs to upsert', example: { forge_model: 'Qwen/Qwen3-4B' } },
    ],
    exampleRequest: { settings: { forge_model: 'Qwen/Qwen3-4B' } },
    exampleResponse: { settings: { forge_chat_url: '/api/chat', forge_model: 'Qwen/Qwen3-4B' } },
  },

  // ==================== History ====================

  {
    id: 'history-list',
    method: 'GET',
    path: '/api/kb/history',
    summary: 'List request history',
    description: 'Paginated list of API request history. Supports filtering by source type (standalone vs workflow).',
    category: 'history',
    tags: ['history', 'requests', 'log', 'paginated'],
    responseType: 'json',
    params: [
      { name: 'page', location: 'query', type: 'number', required: false, description: 'Page number', default: 1 },
      { name: 'limit', location: 'query', type: 'number', required: false, description: 'Items per page (1-200)', default: 50 },
      { name: 'source', location: 'query', type: 'string', required: false, description: 'Filter: "standalone" or "workflow"' },
    ],
    exampleResponse: {
      data: [{ id: 'req_123', method: 'POST', endpoint: '/v1/chat/completions', model: 'Qwen/Qwen3-4B', timestamp: '02/19/2026, 01:30:00 PM', duration: '1.2s', tokens: 512, status: 200, status_text: 'OK', preview: 'Hello...', created_at: '2026-02-19T13:30:00' }],
      total: 100, page: 1, limit: 50,
    },
    outputKey: 'data',
  },
  {
    id: 'history-add',
    method: 'POST',
    path: '/api/kb/history',
    summary: 'Add a history item',
    description: 'Insert a single request history entry with optional request/response payloads and workflow context.',
    category: 'history',
    tags: ['history', 'add', 'log'],
    responseType: 'json',
    params: [
      { name: 'id', location: 'body', type: 'string', required: true, description: 'Unique history item ID' },
      { name: 'method', location: 'body', type: 'string', required: true, description: 'HTTP method' },
      { name: 'endpoint', location: 'body', type: 'string', required: true, description: 'API endpoint path' },
      { name: 'model', location: 'body', type: 'string', required: true, description: 'Model used' },
      { name: 'timestamp', location: 'body', type: 'string', required: true, description: 'Formatted timestamp' },
      { name: 'duration', location: 'body', type: 'string', required: true, description: 'Request duration' },
      { name: 'tokens', location: 'body', type: 'number', required: false, description: 'Token count', default: 0 },
      { name: 'status', location: 'body', type: 'number', required: true, description: 'HTTP status code' },
      { name: 'status_text', location: 'body', type: 'string', required: false, description: 'Status text' },
      { name: 'preview', location: 'body', type: 'string', required: false, description: 'Response preview' },
      { name: 'request_payload', location: 'body', type: 'object', required: false, description: 'Full request payload' },
      { name: 'response_payload', location: 'body', type: 'object', required: false, description: 'Full response payload' },
    ],
    exampleRequest: { id: 'req_001', method: 'POST', endpoint: '/v1/chat/completions', model: 'Qwen/Qwen3-4B', timestamp: '02/19/2026, 01:30:00 PM', duration: '1.2s', status: 200 },
    exampleResponse: { message: 'History item added', count: 1 },
  },
  {
    id: 'history-bulk-add',
    method: 'POST',
    path: '/api/kb/history/bulk',
    summary: 'Bulk add history items',
    description: 'Insert multiple history entries in one request. Duplicates (by ID) are silently skipped.',
    category: 'history',
    tags: ['history', 'bulk', 'batch'],
    responseType: 'json',
    params: [
      { name: '(body)', location: 'body', type: 'array', required: true, description: 'Array of HistoryItemInput objects' },
    ],
    exampleRequest: [{ id: 'req_001', method: 'POST', endpoint: '/v1/chat/completions', model: 'Qwen/Qwen3-4B', timestamp: '02/19/2026', duration: '1s', status: 200 }],
    exampleResponse: { message: 'Bulk inserted 1 history items', count: 1 },
  },
  {
    id: 'history-detail',
    method: 'GET',
    path: '/api/kb/history/{item_id}',
    summary: 'Get history item detail',
    description: 'Returns a single history item with full request/response payloads (including messages, params, RAG config). Response text capped at 50K chars.',
    category: 'history',
    tags: ['history', 'detail', 'payload'],
    responseType: 'json',
    params: [
      { name: 'item_id', location: 'path', type: 'string', required: true, description: 'History item ID' },
    ],
    exampleResponse: {
      id: 'req_123', method: 'POST', endpoint: '/v1/chat/completions', model: 'Qwen/Qwen3-4B',
      timestamp: '02/19/2026', duration: '1.2s', tokens: 512, status: 200, status_text: 'OK',
      preview: 'Hello...', created_at: '2026-02-19T13:30:00',
      request_payload: { messages: [{ role: 'user', content: 'Hello' }] },
      response_payload: { text: 'Hello! How can I help?', truncated: false },
    },
    outputKey: 'response_payload',
  },
  {
    id: 'history-delete-one',
    method: 'DELETE',
    path: '/api/kb/history/{item_id}',
    summary: 'Delete a history item',
    description: 'Remove a single history entry by ID.',
    category: 'history',
    tags: ['history', 'delete'],
    responseType: 'json',
    params: [
      { name: 'item_id', location: 'path', type: 'string', required: true, description: 'History item ID' },
    ],
    exampleResponse: { message: 'History item deleted' },
  },
  {
    id: 'history-clear',
    method: 'DELETE',
    path: '/api/kb/history',
    summary: 'Clear all history',
    description: 'Permanently deletes ALL request history entries.',
    category: 'history',
    tags: ['history', 'clear', 'delete', 'all'],
    responseType: 'json',
    params: [],
    exampleResponse: { message: 'Cleared 100 history items', count: 100 },
    aiNotes: 'DESTRUCTIVE: Deletes all history. Cannot be undone.',
  },

  // ==================== Datasets ====================

  {
    id: 'datasets-list',
    method: 'GET',
    path: '/api/kb/datasets',
    summary: 'List all datasets',
    description: 'Returns all configured dataset sources with their API connection details and extraction config.',
    category: 'datasets',
    tags: ['datasets', 'list', 'sources'],
    responseType: 'json',
    params: [],
    exampleResponse: {
      data: [{ id: 'uuid', name: 'Strapi Forms', url: 'http://192.168.1.8:1337/api/forms', method: 'GET', token: '', headers: {}, array_path: 'data', extract_fields: ['id', 'attributes.name'], raw_data: null, created_at: '2026-01-01T00:00:00', updated_at: '2026-01-01T00:00:00' }],
      total: 3,
    },
    outputKey: 'data',
  },
  {
    id: 'datasets-create',
    method: 'POST',
    path: '/api/kb/datasets',
    summary: 'Create a dataset',
    description: 'Register a new external data source with its API URL, auth, and field extraction config. Supports both API and manual JSON paste modes.',
    category: 'datasets',
    tags: ['datasets', 'create', 'api', 'connector'],
    responseType: 'json',
    params: [
      { name: 'name', location: 'body', type: 'string', required: true, description: 'Dataset name' },
      { name: 'url', location: 'body', type: 'string', required: false, description: 'API URL to fetch data from' },
      { name: 'method', location: 'body', type: 'string', required: false, description: 'HTTP method', default: 'GET' },
      { name: 'token', location: 'body', type: 'string', required: false, description: 'Bearer token for auth' },
      { name: 'headers', location: 'body', type: 'object', required: false, description: 'Custom headers' },
      { name: 'array_path', location: 'body', type: 'string', required: false, description: 'JSONPath to array in response (e.g. "data")' },
      { name: 'extract_fields', location: 'body', type: 'array', required: false, description: 'Fields to extract from each item' },
      { name: 'raw_data', location: 'body', type: 'object', required: false, description: 'Manual JSON data (no API needed)' },
    ],
    exampleRequest: { name: 'My API', url: 'https://api.example.com/items', method: 'GET', array_path: 'data', extract_fields: ['id', 'name'] },
    exampleResponse: { id: 'uuid', name: 'My API', url: 'https://api.example.com/items', method: 'GET', token: '', headers: {}, array_path: 'data', extract_fields: ['id', 'name'], raw_data: null, created_at: '2026-01-01T00:00:00', updated_at: '2026-01-01T00:00:00' },
  },
  {
    id: 'datasets-get',
    method: 'GET',
    path: '/api/kb/datasets/{ds_id}',
    summary: 'Get a dataset',
    description: 'Returns a single dataset by ID with full connection and extraction config.',
    category: 'datasets',
    tags: ['datasets', 'get', 'detail'],
    responseType: 'json',
    params: [
      { name: 'ds_id', location: 'path', type: 'string', required: true, description: 'Dataset UUID' },
    ],
    exampleResponse: { id: 'uuid', name: 'My API', url: 'https://api.example.com', method: 'GET', token: '', headers: {}, array_path: 'data', extract_fields: [], raw_data: null, created_at: '2026-01-01T00:00:00', updated_at: '2026-01-01T00:00:00' },
  },
  {
    id: 'datasets-update',
    method: 'PUT',
    path: '/api/kb/datasets/{ds_id}',
    summary: 'Update a dataset',
    description: 'Partially update a dataset. Only provided fields are modified.',
    category: 'datasets',
    tags: ['datasets', 'update', 'patch'],
    responseType: 'json',
    params: [
      { name: 'ds_id', location: 'path', type: 'string', required: true, description: 'Dataset UUID' },
      { name: 'name', location: 'body', type: 'string', required: false, description: 'New name' },
      { name: 'url', location: 'body', type: 'string', required: false, description: 'New URL' },
      { name: 'method', location: 'body', type: 'string', required: false, description: 'New HTTP method' },
      { name: 'array_path', location: 'body', type: 'string', required: false, description: 'New array path' },
      { name: 'extract_fields', location: 'body', type: 'array', required: false, description: 'New extract fields' },
    ],
    exampleRequest: { name: 'Updated Name' },
    exampleResponse: { id: 'uuid', name: 'Updated Name', url: 'https://api.example.com', method: 'GET', token: '', headers: {}, array_path: '', extract_fields: [], raw_data: null, created_at: '2026-01-01T00:00:00', updated_at: '2026-02-01T00:00:00' },
  },
  {
    id: 'datasets-delete',
    method: 'DELETE',
    path: '/api/kb/datasets/{ds_id}',
    summary: 'Delete a dataset',
    description: 'Delete a dataset and all its associated records (cascade delete).',
    category: 'datasets',
    tags: ['datasets', 'delete', 'cascade'],
    responseType: 'json',
    params: [
      { name: 'ds_id', location: 'path', type: 'string', required: true, description: 'Dataset UUID' },
    ],
    exampleResponse: { message: 'Dataset deleted (records cascade-deleted)' },
    aiNotes: 'This also deletes all dataset_records associated with the dataset.',
  },
  {
    id: 'datasets-fetch',
    method: 'POST',
    path: '/api/kb/datasets/{ds_id}/fetch',
    summary: 'Fetch data from dataset URL',
    description: 'Server-side proxy fetch: makes an HTTP request to the dataset URL using stored auth config and returns the response. Avoids CORS issues.',
    category: 'datasets',
    tags: ['datasets', 'fetch', 'proxy', 'cors'],
    responseType: 'json',
    params: [
      { name: 'ds_id', location: 'path', type: 'string', required: true, description: 'Dataset UUID' },
      { name: 'body', location: 'body', type: 'object', required: false, description: 'Optional POST body for the remote API' },
    ],
    exampleRequest: {},
    exampleResponse: { status: 200, data: { items: [{ id: 1, name: 'Item 1' }] }, elapsed_ms: 145 },
    outputKey: 'data',
  },

  // ==================== Dataset Records ====================

  {
    id: 'records-list',
    method: 'GET',
    path: '/api/kb/dataset-records',
    summary: 'List records (paginated)',
    description: 'Paginated list of saved dataset records with optional dataset_id filtering.',
    category: 'records',
    tags: ['records', 'list', 'paginated'],
    responseType: 'json',
    params: [
      { name: 'dataset_id', location: 'query', type: 'string', required: false, description: 'Filter by dataset UUID' },
      { name: 'page', location: 'query', type: 'number', required: false, description: 'Page number', default: 1 },
      { name: 'limit', location: 'query', type: 'number', required: false, description: 'Items per page (1-200)', default: 50 },
    ],
    exampleResponse: {
      data: [{ id: 'uuid', dataset_id: 'ds-uuid', data: { name: 'Test' }, json_path: '$', label: '', created_at: '2026-01-01T00:00:00' }],
      total: 100, page: 1, limit: 50,
    },
    outputKey: 'data',
  },
  {
    id: 'records-list-all',
    method: 'GET',
    path: '/api/kb/dataset-records/all',
    summary: 'List all records (no pagination)',
    description: 'Returns ALL records for a dataset without pagination. Used for embedding pipelines where every record is needed.',
    category: 'records',
    tags: ['records', 'list', 'all', 'embedding'],
    responseType: 'json',
    params: [
      { name: 'dataset_id', location: 'query', type: 'string', required: true, description: 'Dataset UUID' },
    ],
    exampleResponse: {
      data: [{ id: 'uuid', dataset_id: 'ds-uuid', data: { name: 'Test' }, json_path: '$', label: '', created_at: '2026-01-01T00:00:00' }],
      total: 500, page: 1, limit: 500,
    },
    outputKey: 'data',
    aiNotes: 'Use this for batch embedding operations. Regular list endpoint has pagination limits.',
  },
  {
    id: 'records-bulk-create',
    method: 'POST',
    path: '/api/kb/dataset-records',
    summary: 'Bulk create records',
    description: 'Insert multiple dataset records in a single request. Duplicates (same dataset_id + md5 of data) are silently skipped.',
    category: 'records',
    tags: ['records', 'create', 'bulk', 'batch'],
    responseType: 'json',
    params: [
      { name: 'records', location: 'body', type: 'array', required: true, description: 'Array of records with dataset_id, data, json_path, label' },
    ],
    exampleRequest: { records: [{ dataset_id: 'ds-uuid', data: { name: 'Test', value: 42 }, json_path: '$', label: 'sample' }] },
    exampleResponse: { message: 'Saved 1 records', count: 1 },
    outputKey: 'count',
  },
  {
    id: 'records-delete',
    method: 'DELETE',
    path: '/api/kb/dataset-records/{record_id}',
    summary: 'Delete a record',
    description: 'Delete a single dataset record by its UUID.',
    category: 'records',
    tags: ['records', 'delete'],
    responseType: 'json',
    params: [
      { name: 'record_id', location: 'path', type: 'string', required: true, description: 'Record UUID' },
    ],
    exampleResponse: { message: 'Record deleted' },
  },
  {
    id: 'records-bulk-delete',
    method: 'POST',
    path: '/api/kb/dataset-records/bulk-delete',
    summary: 'Bulk delete records',
    description: 'Delete multiple records by their UUIDs in a single request.',
    category: 'records',
    tags: ['records', 'delete', 'bulk'],
    responseType: 'json',
    params: [
      { name: 'ids', location: 'body', type: 'array', required: true, description: 'Array of record UUIDs to delete' },
    ],
    exampleRequest: { ids: ['uuid-1', 'uuid-2'] },
    exampleResponse: { deleted: 2 },
    outputKey: 'deleted',
  },

  // ==================== Agents ====================

  {
    id: 'agents-list',
    method: 'GET',
    path: '/api/kb/agents',
    summary: 'List all agents',
    description: 'Returns all saved agents with their full config (model, prompt, RAG settings, agentic mode, tools).',
    category: 'agents',
    tags: ['agents', 'list'],
    responseType: 'json',
    params: [],
    exampleResponse: {
      data: [{ id: 'uuid', name: 'ITSM Chatbot', description: 'IT help desk agent', config: { selectedModel: 'Qwen/Qwen3-4B', agentMode: 'react' }, created_at: '2026-01-01T00:00:00', updated_at: '2026-01-01T00:00:00' }],
      total: 5,
    },
    outputKey: 'data',
  },
  {
    id: 'agents-create',
    method: 'POST',
    path: '/api/kb/agents',
    summary: 'Create an agent',
    description: 'Create a new agent with name, description, and full config (model, prompt template, variables, RAG, agentic mode, tools).',
    category: 'agents',
    tags: ['agents', 'create'],
    responseType: 'json',
    params: [
      { name: 'name', location: 'body', type: 'string', required: true, description: 'Agent name' },
      { name: 'description', location: 'body', type: 'string', required: false, description: 'Agent description' },
      { name: 'config', location: 'body', type: 'object', required: true, description: 'Full agent config (model, prompts, params, RAG, tools)' },
    ],
    exampleRequest: {
      name: 'My Agent',
      description: 'Test agent',
      config: { selectedModel: 'Qwen/Qwen3-4B', promptTemplate: 'Answer: {{question}}', systemPrompt: 'You are helpful.', agentMode: 'simple', variables: [{ name: 'question', label: 'Question', defaultValue: '' }], temperature: 0.7, topP: 0.9, maxTokens: 2048, enabledTools: [], maxIterations: 10 },
    },
    exampleResponse: { id: 'uuid', name: 'My Agent', description: 'Test agent', config: {}, created_at: '2026-01-01T00:00:00', updated_at: '2026-01-01T00:00:00' },
  },
  {
    id: 'agents-tools',
    method: 'GET',
    path: '/api/kb/agents/tools',
    summary: 'List available tools',
    description: 'Returns all available tools that can be enabled for ReAct agents. Each tool has a name and description.',
    category: 'agents',
    tags: ['agents', 'tools', 'react'],
    responseType: 'json',
    params: [],
    exampleResponse: { tools: [{ name: 'kb_search', description: 'Search the Knowledge Base' }, { name: 'delegate_agent', description: 'Delegate to another agent' }] },
    outputKey: 'tools',
  },
  {
    id: 'agents-get',
    method: 'GET',
    path: '/api/kb/agents/{agent_id}',
    summary: 'Get an agent',
    description: 'Returns a single agent with its full config.',
    category: 'agents',
    tags: ['agents', 'get', 'detail'],
    responseType: 'json',
    params: [
      { name: 'agent_id', location: 'path', type: 'string', required: true, description: 'Agent UUID' },
    ],
    exampleResponse: { id: 'uuid', name: 'My Agent', description: '', config: {}, created_at: '2026-01-01T00:00:00', updated_at: '2026-01-01T00:00:00' },
  },
  {
    id: 'agents-update',
    method: 'PUT',
    path: '/api/kb/agents/{agent_id}',
    summary: 'Update an agent',
    description: 'Partially update an agent. Only provided fields are modified.',
    category: 'agents',
    tags: ['agents', 'update'],
    responseType: 'json',
    params: [
      { name: 'agent_id', location: 'path', type: 'string', required: true, description: 'Agent UUID' },
      { name: 'name', location: 'body', type: 'string', required: false, description: 'New name' },
      { name: 'description', location: 'body', type: 'string', required: false, description: 'New description' },
      { name: 'config', location: 'body', type: 'object', required: false, description: 'New config (full replace)' },
    ],
    exampleRequest: { name: 'Updated Agent Name' },
    exampleResponse: { id: 'uuid', name: 'Updated Agent Name', description: '', config: {}, created_at: '2026-01-01T00:00:00', updated_at: '2026-02-01T00:00:00' },
  },
  {
    id: 'agents-delete',
    method: 'DELETE',
    path: '/api/kb/agents/{agent_id}',
    summary: 'Delete an agent',
    description: 'Permanently delete an agent by UUID.',
    category: 'agents',
    tags: ['agents', 'delete'],
    responseType: 'json',
    params: [
      { name: 'agent_id', location: 'path', type: 'string', required: true, description: 'Agent UUID' },
    ],
    exampleResponse: { message: 'Agent deleted' },
  },
  {
    id: 'agents-run',
    method: 'POST',
    path: '/api/kb/agents/{agent_id}/run',
    summary: 'Run an agent (SSE stream)',
    description: 'Execute an agent with variable substitution. Returns SSE events for streaming output. Simple mode returns OpenAI-format stream chunks. ReAct mode returns typed events (agent_start, tool_call, tool_result, stream, agent_done).',
    category: 'agents',
    tags: ['agents', 'run', 'execute', 'sse', 'stream', 'react'],
    responseType: 'sse',
    params: [
      { name: 'agent_id', location: 'path', type: 'string', required: true, description: 'Agent UUID' },
      { name: 'variables', location: 'body', type: 'object', required: false, description: 'Variable values for prompt template', example: { question: 'How to reset password?' } },
      { name: 'stream', location: 'body', type: 'boolean', required: false, description: 'Override stream setting (null = use agent config default)' },
    ],
    exampleRequest: { variables: { question: 'How do I reset my password?' }, stream: true },
    sseEvents: [
      { event: 'agent_start', description: 'Agent execution started', dataShape: '{ mode, max_iterations, tools[] }' },
      { event: 'iteration_start', description: 'New ReAct iteration', dataShape: '{ iteration }' },
      { event: 'tool_call', description: 'Agent calling a tool', dataShape: '{ iteration, tool, args, call_id }' },
      { event: 'tool_result', description: 'Tool returned a result', dataShape: '{ iteration, tool, call_id, result }' },
      { event: 'final_answer_start', description: 'Agent producing final answer', dataShape: '{ iteration }' },
      { event: 'stream', description: 'Streaming text content', dataShape: '{ content }' },
      { event: 'agent_done', description: 'Agent completed', dataShape: '{ iterations, tools_used[], total_tool_calls }' },
      { event: 'error', description: 'Error occurred', dataShape: '{ message }' },
    ],
    outputKey: 'full_text',
    aiNotes: 'For simple mode: SSE data lines are standard OpenAI chat/completions streaming format. For ReAct mode: typed event lines with structured JSON data. The stream ends with "data: [DONE]".',
  },

  // ==================== Workflows ====================

  {
    id: 'workflows-list',
    method: 'GET',
    path: '/api/kb/workflows',
    summary: 'List all workflows',
    description: 'Returns all saved workflows with their step definitions.',
    category: 'workflows',
    tags: ['workflows', 'list', 'pipeline'],
    responseType: 'json',
    params: [],
    exampleResponse: {
      data: [{ id: 'uuid', name: 'ITSM Pipeline', description: 'Multi-step ITSM flow', steps: [], created_at: '2026-01-01T00:00:00', updated_at: '2026-01-01T00:00:00' }],
      total: 2,
    },
    outputKey: 'data',
  },
  {
    id: 'workflows-create',
    method: 'POST',
    path: '/api/kb/workflows',
    summary: 'Create a workflow',
    description: 'Create a new multi-step workflow pipeline. Steps define agent chain with variable mappings.',
    category: 'workflows',
    tags: ['workflows', 'create', 'pipeline'],
    responseType: 'json',
    params: [
      { name: 'name', location: 'body', type: 'string', required: true, description: 'Workflow name' },
      { name: 'description', location: 'body', type: 'string', required: false, description: 'Workflow description' },
      { name: 'steps', location: 'body', type: 'array', required: false, description: 'Pipeline step definitions' },
    ],
    exampleRequest: { name: 'My Pipeline', description: 'Test workflow', steps: [{ id: 'step_0', agentId: 'agent-uuid', variableMappings: {} }] },
    exampleResponse: { id: 'uuid', name: 'My Pipeline', description: 'Test workflow', steps: [], created_at: '2026-01-01T00:00:00', updated_at: '2026-01-01T00:00:00' },
  },
  {
    id: 'workflows-get',
    method: 'GET',
    path: '/api/kb/workflows/{wf_id}',
    summary: 'Get a workflow',
    description: 'Returns a single workflow with full step definitions.',
    category: 'workflows',
    tags: ['workflows', 'get', 'detail'],
    responseType: 'json',
    params: [
      { name: 'wf_id', location: 'path', type: 'string', required: true, description: 'Workflow UUID' },
    ],
    exampleResponse: { id: 'uuid', name: 'Pipeline', description: '', steps: [], created_at: '2026-01-01T00:00:00', updated_at: '2026-01-01T00:00:00' },
  },
  {
    id: 'workflows-update',
    method: 'PUT',
    path: '/api/kb/workflows/{wf_id}',
    summary: 'Update a workflow',
    description: 'Partially update a workflow. Only provided fields are modified.',
    category: 'workflows',
    tags: ['workflows', 'update'],
    responseType: 'json',
    params: [
      { name: 'wf_id', location: 'path', type: 'string', required: true, description: 'Workflow UUID' },
      { name: 'name', location: 'body', type: 'string', required: false, description: 'New name' },
      { name: 'description', location: 'body', type: 'string', required: false, description: 'New description' },
      { name: 'steps', location: 'body', type: 'array', required: false, description: 'New step definitions' },
    ],
    exampleRequest: { name: 'Updated Pipeline' },
    exampleResponse: { id: 'uuid', name: 'Updated Pipeline', description: '', steps: [], created_at: '2026-01-01T00:00:00', updated_at: '2026-02-01T00:00:00' },
  },
  {
    id: 'workflows-delete',
    method: 'DELETE',
    path: '/api/kb/workflows/{wf_id}',
    summary: 'Delete a workflow',
    description: 'Permanently delete a workflow by UUID.',
    category: 'workflows',
    tags: ['workflows', 'delete'],
    responseType: 'json',
    params: [
      { name: 'wf_id', location: 'path', type: 'string', required: true, description: 'Workflow UUID' },
    ],
    exampleResponse: { message: 'Workflow deleted' },
  },
  {
    id: 'workflows-run',
    method: 'POST',
    path: '/api/kb/workflows/{wf_id}/run',
    summary: 'Run a workflow (SSE stream)',
    description: 'Execute a workflow pipeline. Steps run sequentially, each step\'s output piped to the next via variable mappings. Returns SSE events for all steps.',
    category: 'workflows',
    tags: ['workflows', 'run', 'execute', 'sse', 'stream', 'pipeline'],
    responseType: 'sse',
    params: [
      { name: 'wf_id', location: 'path', type: 'string', required: true, description: 'Workflow UUID' },
      { name: 'variables', location: 'body', type: 'object', required: false, description: 'Runtime input variables for {{input:key}} mappings', example: { query: 'test input' } },
    ],
    exampleRequest: { variables: { query: 'How to reset password?' } },
    sseEvents: [
      { event: 'step_start', description: 'Pipeline step started', dataShape: '{ step_id, index, agent_name, agent_id }' },
      { event: 'step_stream', description: 'Step streaming content', dataShape: '{ step_id, index, content }' },
      { event: 'step_done', description: 'Step completed', dataShape: '{ step_id, index, output_preview, output_length }' },
      { event: 'step_error', description: 'Step failed', dataShape: '{ step_id, index, error }' },
      { event: 'workflow_done', description: 'All steps completed', dataShape: '{ total_steps, step_outputs }' },
    ],
    outputKey: 'step_outputs',
    aiNotes: 'Variable mappings: "{{prev_output}}" pipes previous step output, "{{step:step_id}}" references specific step, "{{input:key}}" uses runtime variables.',
  },

  // ==================== Chat Completions (vLLM) ====================

  {
    id: 'chat-models',
    method: 'GET',
    path: '/api/chat/models',
    summary: 'List chat models',
    description: 'Returns available models from the vLLM chat server (port 8010). OpenAI-compatible format.',
    category: 'chat',
    tags: ['chat', 'models', 'vllm', 'openai'],
    responseType: 'json',
    params: [],
    exampleResponse: { object: 'list', data: [{ id: 'Qwen/Qwen3-4B', object: 'model', created: 1700000000, owned_by: 'vllm' }] },
    outputKey: 'data',
  },
  {
    id: 'chat-completions',
    method: 'POST',
    path: '/api/chat/chat/completions',
    summary: 'Chat completion (stream)',
    description: 'OpenAI-compatible chat completion endpoint. Supports streaming via SSE. Qwen3 supports thinking mode via chat_template_kwargs.enable_thinking.',
    category: 'chat',
    tags: ['chat', 'completion', 'stream', 'sse', 'openai', 'qwen3', 'thinking'],
    responseType: 'sse',
    params: [
      { name: 'model', location: 'body', type: 'string', required: true, description: 'Model ID (e.g. Qwen/Qwen3-4B)', example: 'Qwen/Qwen3-4B' },
      { name: 'messages', location: 'body', type: 'array', required: true, description: 'Chat messages array [{role, content}]', example: [{ role: 'user', content: 'Hello' }] },
      { name: 'temperature', location: 'body', type: 'number', required: false, description: 'Sampling temperature (0-2)', default: 0.7 },
      { name: 'top_p', location: 'body', type: 'number', required: false, description: 'Top-p nucleus sampling', default: 0.9 },
      { name: 'max_tokens', location: 'body', type: 'number', required: false, description: 'Max tokens to generate', default: 2048 },
      { name: 'stream', location: 'body', type: 'boolean', required: false, description: 'Enable SSE streaming', default: true },
      { name: 'top_k', location: 'body', type: 'number', required: false, description: 'Top-k sampling (0=disabled)' },
      { name: 'presence_penalty', location: 'body', type: 'number', required: false, description: 'Presence penalty (-2 to 2)' },
      { name: 'frequency_penalty', location: 'body', type: 'number', required: false, description: 'Frequency penalty (-2 to 2)' },
      { name: 'repetition_penalty', location: 'body', type: 'number', required: false, description: 'Repetition penalty (1.0=disabled)' },
      { name: 'seed', location: 'body', type: 'number', required: false, description: 'Random seed for reproducibility' },
      { name: 'stop', location: 'body', type: 'array', required: false, description: 'Stop sequences' },
      { name: 'response_format', location: 'body', type: 'object', required: false, description: 'Format: {type:"json_object"} for JSON mode' },
      { name: 'chat_template_kwargs', location: 'body', type: 'object', required: false, description: 'Template kwargs: {enable_thinking: true} for Qwen3 thinking' },
    ],
    exampleRequest: {
      model: 'Qwen/Qwen3-4B',
      messages: [{ role: 'system', content: 'You are a helpful assistant.' }, { role: 'user', content: 'Hello, what is 2+2?' }],
      temperature: 0.7, max_tokens: 1024, stream: true,
      chat_template_kwargs: { enable_thinking: false },
    },
    sseEvents: [
      { event: '(data line)', description: 'Standard SSE "data: {json}" format', dataShape: '{ choices: [{ delta: { content } }] }' },
      { event: '[DONE]', description: 'Stream complete signal', dataShape: '"data: [DONE]"' },
    ],
    aiNotes: 'When streaming, response comes as "data: {json}\\n\\n" lines. The content is in choices[0].delta.content. Stream ends with "data: [DONE]". For Qwen3 thinking mode, set chat_template_kwargs.enable_thinking=true — the model wraps its reasoning in <think>...</think> tags.',
  },
  {
    id: 'text-completions',
    method: 'POST',
    path: '/api/chat/completions',
    summary: 'Text completion (legacy)',
    description: 'OpenAI-compatible text completion endpoint (non-chat). Takes a raw prompt string instead of messages array.',
    category: 'chat',
    tags: ['completions', 'text', 'legacy', 'vllm'],
    responseType: 'json',
    params: [
      { name: 'model', location: 'body', type: 'string', required: true, description: 'Model ID' },
      { name: 'prompt', location: 'body', type: 'string', required: true, description: 'Raw text prompt' },
      { name: 'max_tokens', location: 'body', type: 'number', required: false, description: 'Max tokens', default: 256 },
      { name: 'temperature', location: 'body', type: 'number', required: false, description: 'Temperature', default: 0.7 },
      { name: 'stream', location: 'body', type: 'boolean', required: false, description: 'Enable streaming', default: false },
    ],
    exampleRequest: { model: 'Qwen/Qwen3-4B', prompt: 'The capital of France is', max_tokens: 50, temperature: 0.7 },
    exampleResponse: { id: 'cmpl-123', object: 'text_completion', choices: [{ text: ' Paris.', index: 0, finish_reason: 'stop' }], usage: { prompt_tokens: 6, completion_tokens: 3, total_tokens: 9 } },
    outputKey: 'choices',
  },

  // ==================== Embeddings (vLLM) ====================

  {
    id: 'embed-models',
    method: 'GET',
    path: '/api/embed/models',
    summary: 'List embedding models',
    description: 'Returns available models from the vLLM embedding server (port 8011).',
    category: 'embeddings',
    tags: ['embeddings', 'models', 'vllm'],
    responseType: 'json',
    params: [],
    exampleResponse: { object: 'list', data: [{ id: 'nomic-ai/nomic-embed-text-v1.5', object: 'model', created: 1700000000 }] },
    outputKey: 'data',
  },
  {
    id: 'embed-generate',
    method: 'POST',
    path: '/api/embed/embeddings',
    summary: 'Generate embeddings',
    description: 'Generate embedding vectors for one or more text inputs. Returns 768-dimensional vectors (nomic-embed-text). OpenAI-compatible format.',
    category: 'embeddings',
    tags: ['embeddings', 'generate', 'vector', 'nomic', 'openai'],
    responseType: 'json',
    params: [
      { name: 'model', location: 'body', type: 'string', required: true, description: 'Embedding model ID', example: 'nomic-ai/nomic-embed-text-v1.5' },
      { name: 'input', location: 'body', type: 'array', required: true, description: 'Array of texts to embed', example: ['Hello world', 'How are you?'] },
    ],
    exampleRequest: { model: 'nomic-ai/nomic-embed-text-v1.5', input: ['How to reset password?'] },
    exampleResponse: {
      model: 'nomic-ai/nomic-embed-text-v1.5',
      data: [{ object: 'embedding', embedding: [0.01, 0.02, 0.03], index: 0 }],
      usage: { prompt_tokens: 5, total_tokens: 5 },
    },
    outputKey: 'data',
    aiNotes: 'Chain tip: Use this to get embeddings, then pipe to /api/kb/search for semantic search. Batch multiple texts in the input array for efficiency.',
  },
];

// --- Search helper ---

export function searchEndpoints(query: string): EndpointDef[] {
  if (!query.trim()) return ENDPOINTS;
  const q = query.toLowerCase();
  return ENDPOINTS.filter(ep =>
    ep.path.toLowerCase().includes(q) ||
    ep.summary.toLowerCase().includes(q) ||
    ep.tags.some(t => t.includes(q)) ||
    ep.method.toLowerCase().includes(q) ||
    ep.category.toLowerCase().includes(q)
  );
}

// --- Category grouping helper ---

export function getEndpointsByCategory(): Map<string, EndpointDef[]> {
  const map = new Map<string, EndpointDef[]>();
  for (const cat of CATEGORIES) {
    map.set(cat.key, ENDPOINTS.filter(ep => ep.category === cat.key));
  }
  return map;
}
