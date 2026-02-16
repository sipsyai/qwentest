// RAG Pipeline - Orchestrates retrieval-augmented generation

import { generateEmbeddings } from './vllm';
import { searchSimilar, getDocumentCount } from './kbApi';
import type { SearchResult } from './kbApi';

export interface RAGResult {
  relevantDocs: SearchResult[];
  augmentedMessages: { role: string; content: string }[];
  searchTimeMs: number;
  embeddingTimeMs: number;
}

export const executeRAGPipeline = async (
  userPrompt: string,
  systemPrompt: string,
  embedModel: string,
  options: { topK?: number; threshold?: number; signal?: AbortSignal; sources?: string[] } = {}
): Promise<RAGResult> => {
  const { topK = 3, threshold = 0.3, signal, sources } = options;

  const docCount = await getDocumentCount();
  if (docCount === 0) {
    return {
      relevantDocs: [],
      augmentedMessages: buildMessages(systemPrompt, userPrompt, []),
      searchTimeMs: 0,
      embeddingTimeMs: 0,
    };
  }

  // 1. Generate query embedding
  const embedStart = Date.now();
  const embedResponse = await generateEmbeddings(embedModel, [userPrompt], signal);
  const embeddingTimeMs = Date.now() - embedStart;

  const queryVector = embedResponse.data[0]?.embedding;
  if (!queryVector || queryVector.length === 0) {
    return {
      relevantDocs: [],
      augmentedMessages: buildMessages(systemPrompt, userPrompt, []),
      searchTimeMs: 0,
      embeddingTimeMs,
    };
  }

  // 2. Search similar documents
  const searchStart = Date.now();
  const relevantDocs = await searchSimilar(queryVector, topK, threshold, sources);
  const searchTimeMs = Date.now() - searchStart;

  // 3. Build augmented messages
  const augmentedMessages = buildMessages(systemPrompt, userPrompt, relevantDocs);

  return { relevantDocs, augmentedMessages, searchTimeMs, embeddingTimeMs };
};

const buildMessages = (
  systemPrompt: string,
  userPrompt: string,
  docs: SearchResult[]
): { role: string; content: string }[] => {
  const messages: { role: string; content: string }[] = [];

  let finalSystem = systemPrompt;
  if (docs.length > 0) {
    const contextBlock = docs
      .map((r, i) => {
        const pct = Math.round(r.similarity * 100);
        const preview = r.document.text.length > 300
          ? r.document.text.slice(0, 300) + '...'
          : r.document.text;
        return `[${i + 1}] (relevance: ${pct}%) ${preview}`;
      })
      .join('\n\n');

    finalSystem = `${systemPrompt}\n\n## Retrieved Context\nThe following information was retrieved from the knowledge base. Use it to provide accurate, grounded answers:\n\n${contextBlock}`;
  }

  if (finalSystem.trim()) {
    messages.push({ role: 'system', content: finalSystem });
  }
  messages.push({ role: 'user', content: userPrompt });

  return messages;
};
