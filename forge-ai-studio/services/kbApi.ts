// Knowledge Base API Client - Replaces localStorage vectorStore with PostgreSQL + pgvector backend

const KB_BASE = '/api/kb';

export interface KBDocument {
  id: string;
  text: string;
  source: string;
  source_label: string;
  created_at: string;
}

export interface SearchResult {
  document: KBDocument;
  similarity: number;
}

export interface KBStats {
  total: number;
  sources: Record<string, number>;
  source_labels: string[];
}

// Add documents to KB (batch)
export async function addDocuments(
  docs: { text: string; embedding: number[]; source: 'manual' | 'dataset'; sourceLabel: string }[],
  _model: string
): Promise<number> {
  const payload = {
    documents: docs.map(d => ({
      text: d.text,
      embedding: d.embedding,
      source: d.source,
      source_label: d.sourceLabel,
    })),
  };

  const res = await fetch(`${KB_BASE}/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`KB add failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.count ?? docs.length;
}

// List documents with optional filters
export async function getDocuments(params: {
  source?: string;
  source_label?: string;
  page?: number;
  limit?: number;
} = {}): Promise<{ data: KBDocument[]; total: number; page: number; limit: number }> {
  const searchParams = new URLSearchParams();
  if (params.source) searchParams.set('source', params.source);
  if (params.source_label) searchParams.set('source_label', params.source_label);
  if (params.page) searchParams.set('page', String(params.page));
  if (params.limit) searchParams.set('limit', String(params.limit));

  const res = await fetch(`${KB_BASE}/documents?${searchParams}`);
  if (!res.ok) throw new Error(`KB list failed: ${res.status}`);
  return res.json();
}

// Delete single document
export async function deleteDocument(id: string): Promise<void> {
  const res = await fetch(`${KB_BASE}/documents/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`KB delete failed: ${res.status}`);
}

// Bulk delete documents
export async function bulkDelete(ids: string[]): Promise<number> {
  const res = await fetch(`${KB_BASE}/documents/bulk-delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });

  if (!res.ok) throw new Error(`KB bulk delete failed: ${res.status}`);
  const data = await res.json();
  return data.deleted;
}

// Semantic search via pgvector
export async function searchSimilar(
  queryEmbedding: number[],
  topK: number = 5,
  threshold: number = 0.3,
  sources?: string[]
): Promise<SearchResult[]> {
  const body: any = {
    embedding: queryEmbedding,
    top_k: topK,
    threshold,
  };
  if (sources && sources.length > 0) {
    body.sources = sources;
  }

  const res = await fetch(`${KB_BASE}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`KB search failed: ${res.status}`);
  const data = await res.json();

  return data.results.map((r: any) => ({
    document: {
      id: r.id,
      text: r.text,
      source: r.source,
      source_label: r.source_label,
      created_at: r.created_at,
    },
    similarity: r.similarity,
  }));
}

// Get KB stats
export async function getStats(): Promise<KBStats> {
  const res = await fetch(`${KB_BASE}/stats`);
  if (!res.ok) throw new Error(`KB stats failed: ${res.status}`);
  return res.json();
}

// Clear all documents
export async function clearAll(): Promise<void> {
  const res = await fetch(`${KB_BASE}/clear`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`KB clear failed: ${res.status}`);
}

// Get document count (convenience)
export async function getDocumentCount(): Promise<number> {
  try {
    const stats = await getStats();
    return stats.total;
  } catch {
    return 0;
  }
}
