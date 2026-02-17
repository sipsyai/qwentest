// Datasets & Records API Client

const KB_BASE = '/api/kb';

// --- Interfaces ---

export interface Dataset {
  id: string;
  name: string;
  url: string;
  method: string;
  token: string;
  headers: Record<string, string>;
  array_path: string;
  extract_fields: string[];
  created_at: string;
  updated_at: string;
}

export interface DatasetCreate {
  name: string;
  url: string;
  method?: string;
  token?: string;
  headers?: Record<string, string>;
  array_path?: string;
  extract_fields?: string[];
}

export interface DatasetUpdate {
  name?: string;
  url?: string;
  method?: string;
  token?: string;
  headers?: Record<string, string>;
  array_path?: string;
  extract_fields?: string[];
}

export interface FetchResult {
  status: number;
  data: any;
  elapsed_ms: number;
}

export interface DatasetRecord {
  id: string;
  dataset_id: string;
  data: Record<string, any>;
  json_path: string;
  label: string;
  created_at: string;
}

// --- Datasets CRUD ---

export async function getDatasets(): Promise<{ data: Dataset[]; total: number }> {
  const res = await fetch(`${KB_BASE}/datasets`);
  if (!res.ok) throw new Error(`Failed to list datasets: ${res.status}`);
  return res.json();
}

export async function createDataset(ds: DatasetCreate): Promise<Dataset> {
  const res = await fetch(`${KB_BASE}/datasets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ds),
  });
  if (!res.ok) throw new Error(`Failed to create dataset: ${res.status}`);
  return res.json();
}

export async function updateDataset(id: string, updates: DatasetUpdate): Promise<Dataset> {
  const res = await fetch(`${KB_BASE}/datasets/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`Failed to update dataset: ${res.status}`);
  return res.json();
}

export async function deleteDataset(id: string): Promise<void> {
  const res = await fetch(`${KB_BASE}/datasets/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete dataset: ${res.status}`);
}

// --- Fetch Proxy ---

export async function fetchDatasetUrl(datasetId: string, body?: Record<string, any>): Promise<FetchResult> {
  const res = await fetch(`${KB_BASE}/datasets/${datasetId}/fetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ? { body } : {}),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Fetch proxy failed: ${res.status} - ${err}`);
  }
  return res.json();
}

// --- Dataset Records CRUD ---

export async function getDatasetRecords(params: {
  dataset_id?: string;
  page?: number;
  limit?: number;
} = {}): Promise<{ data: DatasetRecord[]; total: number; page: number; limit: number }> {
  const searchParams = new URLSearchParams();
  if (params.dataset_id) searchParams.set('dataset_id', params.dataset_id);
  if (params.page) searchParams.set('page', String(params.page));
  if (params.limit) searchParams.set('limit', String(params.limit));

  const res = await fetch(`${KB_BASE}/dataset-records?${searchParams}`);
  if (!res.ok) throw new Error(`Failed to list records: ${res.status}`);
  return res.json();
}

export async function saveDatasetRecords(
  records: { dataset_id: string; data: Record<string, any>; json_path: string; label: string }[]
): Promise<number> {
  const res = await fetch(`${KB_BASE}/dataset-records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records }),
  });
  if (!res.ok) throw new Error(`Failed to save records: ${res.status}`);
  const result = await res.json();
  return result.count ?? records.length;
}

export async function deleteDatasetRecord(id: string): Promise<void> {
  const res = await fetch(`${KB_BASE}/dataset-records/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete record: ${res.status}`);
}

export async function bulkDeleteDatasetRecords(ids: string[]): Promise<number> {
  const res = await fetch(`${KB_BASE}/dataset-records/bulk-delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`Failed to bulk delete records: ${res.status}`);
  const data = await res.json();
  return data.deleted;
}
