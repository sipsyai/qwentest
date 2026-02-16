// Vector Store - Client-side knowledge base with localStorage persistence

export interface KnowledgeDocument {
  id: string;
  text: string;
  embedding: number[];
  source: 'manual' | 'dataset';
  sourceLabel: string;
  createdAt: string;
}

export interface KnowledgeBase {
  model: string;
  dimensions: number;
  documents: KnowledgeDocument[];
}

const STORAGE_KEY = 'forge_knowledge_base';

const loadFromStorage = (): KnowledgeBase | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const saveToStorage = (kb: KnowledgeBase): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(kb));
  } catch (e) {
    console.warn('Failed to save knowledge base to localStorage:', e);
  }
};

// In-memory cache
let cache: KnowledgeBase | null = null;

export const getKnowledgeBase = (): KnowledgeBase => {
  if (!cache) {
    cache = loadFromStorage() || { model: '', dimensions: 0, documents: [] };
  }
  return cache;
};

export const addDocuments = (
  docs: { text: string; embedding: number[]; source: 'manual' | 'dataset'; sourceLabel: string }[],
  model: string
): number => {
  const kb = getKnowledgeBase();
  kb.model = model;
  if (docs.length > 0 && docs[0].embedding.length > 0) {
    kb.dimensions = docs[0].embedding.length;
  }

  const newDocs: KnowledgeDocument[] = docs.map(d => ({
    id: crypto.randomUUID(),
    text: d.text,
    embedding: d.embedding,
    source: d.source,
    sourceLabel: d.sourceLabel,
    createdAt: new Date().toISOString(),
  }));

  kb.documents.push(...newDocs);
  cache = kb;
  saveToStorage(kb);
  return newDocs.length;
};

export const removeDocument = (id: string): void => {
  const kb = getKnowledgeBase();
  kb.documents = kb.documents.filter(d => d.id !== id);
  cache = kb;
  saveToStorage(kb);
};

export const clearKnowledgeBase = (): void => {
  cache = { model: '', dimensions: 0, documents: [] };
  saveToStorage(cache);
};

export const getDocumentCount = (): number => {
  return getKnowledgeBase().documents.length;
};

export const getStorageSizeKB = (): number => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return 0;
  return Math.round((new Blob([raw]).size) / 1024);
};

// Cosine similarity between two vectors
const cosineSimilarity = (a: number[], b: number[]): number => {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
};

export interface SearchResult {
  document: KnowledgeDocument;
  similarity: number;
}

export const searchSimilar = (
  queryEmbedding: number[],
  topK: number = 3,
  threshold: number = 0.3
): SearchResult[] => {
  const kb = getKnowledgeBase();
  if (kb.documents.length === 0) return [];

  const scored = kb.documents.map(doc => ({
    document: doc,
    similarity: cosineSimilarity(queryEmbedding, doc.embedding),
  }));

  return scored
    .filter(r => r.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
};
