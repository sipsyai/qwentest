import React, { useEffect, useState } from 'react';
import { Sparkles, BarChart2, FileText, Download, Copy, Loader2, ChevronDown, ChevronUp, CheckCircle2, AlertCircle, Database, Search, Trash2, X } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { generateEmbeddings, fetchEmbedModels, EmbeddingResponse } from '../services/vllm';
import { logEmbeddingRequest } from '../services/historyApi';
import { addDocuments, getDocumentCount, getDocuments, deleteDocument, bulkDelete, clearAll, searchSimilar, getStats } from '../services/kbApi';
import type { KBDocument, KBStats, SearchResult } from '../services/kbApi';

interface VectorItem {
  index: number;
  text: string;
  embedding: number[];
  expanded: boolean;
}

const Embeddings = () => {
  const location = useLocation();
  const [inputText, setInputText] = useState(`The future of AI is multimodal.
Vector databases enable fast semantic search.
Embeddings are high-dimensional representations of data.
Machine learning models require clean datasets.`);

  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vectors, setVectors] = useState<VectorItem[]>([]);
  const [sessionStats, setSessionStats] = useState<{ model: string; dimensions: number; tokens: number; totalVectors: number } | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [kbDocCount, setKbDocCount] = useState(0);
  const [kbSaveSuccess, setKbSaveSuccess] = useState<string | null>(null);
  const [kbSaving, setKbSaving] = useState(false);

  // Right panel tab state
  const [rightTab, setRightTab] = useState<'output' | 'kb'>('output');

  // KB Management state
  const [kbStats, setKbStats] = useState<KBStats | null>(null);
  const [kbDocs, setKbDocs] = useState<KBDocument[]>([]);
  const [kbTotal, setKbTotal] = useState(0);
  const [kbPage, setKbPage] = useState(1);
  const [kbLoading, setKbLoading] = useState(false);
  const [kbSelectedIds, setKbSelectedIds] = useState<Set<string>>(new Set());
  const [kbFilterSource, setKbFilterSource] = useState<string>('');
  const [kbFilterLabel, setKbFilterLabel] = useState<string>('');
  const [kbSearchQuery, setKbSearchQuery] = useState('');
  const [kbSearchResults, setKbSearchResults] = useState<SearchResult[] | null>(null);
  const [kbSearching, setKbSearching] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [kbSearchTopK, setKbSearchTopK] = useState(10);
  const [kbSearchThreshold, setKbSearchThreshold] = useState(0.2);

  // Check for incoming data from Datasets page
  useEffect(() => {
    if (location.state && (location.state as any).initialInput) {
      setInputText((location.state as any).initialInput);
    }
  }, [location.state]);

  // Fetch embed models on mount
  useEffect(() => {
    fetchEmbedModels().then(models => {
      if (models.length > 0) {
        setAvailableModels(models);
        setSelectedModel(models[0]);
      } else {
        setAvailableModels(['nomic-ai/nomic-embed-text-v1.5']);
        setSelectedModel('nomic-ai/nomic-embed-text-v1.5');
      }
    });
  }, []);

  // Poll KB doc count
  useEffect(() => {
    getDocumentCount().then(setKbDocCount);
    const interval = setInterval(() => { getDocumentCount().then(setKbDocCount); }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Fetch KB stats when switching to KB tab
  useEffect(() => {
    if (rightTab === 'kb') {
      refreshKBData();
    }
  }, [rightTab]);

  const refreshKBData = async () => {
    setKbLoading(true);
    try {
      const [stats, docs] = await Promise.all([
        getStats(),
        getDocuments({ page: kbPage, limit: 50, source: kbFilterSource || undefined, source_label: kbFilterLabel || undefined }),
      ]);
      setKbStats(stats);
      setKbDocs(docs.data);
      setKbTotal(docs.total);
      setKbDocCount(stats.total);
    } catch (err: any) {
      setError(`KB load failed: ${err.message}`);
    } finally {
      setKbLoading(false);
    }
  };

  // Refetch when filters or page change
  useEffect(() => {
    if (rightTab === 'kb') {
      refreshKBData();
    }
  }, [kbPage, kbFilterSource, kbFilterLabel]);

  const handleGenerate = async () => {
    if (!selectedModel) {
      setError('Please select an embedding model');
      return;
    }

    const lines = inputText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      setError('Please enter at least one line of text');
      return;
    }

    setIsGenerating(true);
    setError(null);
    setVectors([]);
    setSessionStats(null);

    const startTime = Date.now();

    try {
      const response: EmbeddingResponse = await generateEmbeddings(selectedModel, lines);
      const elapsed = Date.now() - startTime;

      const newVectors: VectorItem[] = response.data.map((item, idx) => ({
        index: item.index,
        text: lines[idx] || `Input #${idx + 1}`,
        embedding: item.embedding,
        expanded: idx === 0,
      }));

      setVectors(newVectors);
      setSessionStats({
        model: response.model || selectedModel,
        dimensions: response.data[0]?.embedding?.length || 0,
        tokens: response.usage?.total_tokens || 0,
        totalVectors: response.data.length,
      });

      logEmbeddingRequest(
        selectedModel,
        lines.length,
        elapsed,
        200,
        'OK',
        response.usage?.total_tokens || 0
      );
    } catch (err: any) {
      const elapsed = Date.now() - startTime;
      setError(err.message || 'Failed to generate embeddings');

      logEmbeddingRequest(
        selectedModel,
        lines.length,
        elapsed,
        500,
        'Error',
        0
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const toggleExpand = (idx: number) => {
    setVectors(prev => prev.map((v, i) => i === idx ? { ...v, expanded: !v.expanded } : v));
  };

  const copyVector = (idx: number, embedding: number[]) => {
    navigator.clipboard.writeText(JSON.stringify(embedding));
    setCopied(idx);
    setTimeout(() => setCopied(null), 2000);
  };

  const exportAll = () => {
    const exportData = vectors.map(v => ({
      index: v.index,
      text: v.text,
      embedding: v.embedding,
    }));
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `embeddings_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveToKB = async () => {
    if (vectors.length === 0) return;
    setKbSaving(true);

    try {
      const docs = vectors.map(v => ({
        text: v.text,
        embedding: v.embedding,
        source: 'manual' as const,
        sourceLabel: `Embeddings page`,
      }));

      const count = await addDocuments(docs, selectedModel);
      setKbDocCount(await getDocumentCount());
      setKbSaveSuccess(`Saved ${count} vectors to Knowledge Base!`);
      setTimeout(() => setKbSaveSuccess(null), 4000);
    } catch (err: any) {
      setError(`Save to KB failed: ${err.message}`);
    } finally {
      setKbSaving(false);
    }
  };

  // KB Management actions
  const handleKBDelete = async (id: string) => {
    try {
      await deleteDocument(id);
      await refreshKBData();
    } catch (err: any) {
      setError(`Delete failed: ${err.message}`);
    }
  };

  const handleKBBulkDelete = async () => {
    if (kbSelectedIds.size === 0) return;
    try {
      await bulkDelete(Array.from(kbSelectedIds));
      setKbSelectedIds(new Set());
      await refreshKBData();
    } catch (err: any) {
      setError(`Bulk delete failed: ${err.message}`);
    }
  };

  const handleKBClearAll = async () => {
    try {
      await clearAll();
      setShowClearConfirm(false);
      setKbSelectedIds(new Set());
      await refreshKBData();
    } catch (err: any) {
      setError(`Clear failed: ${err.message}`);
    }
  };

  const handleKBSearch = async () => {
    if (!kbSearchQuery.trim() || !selectedModel) return;
    setKbSearching(true);
    try {
      const embedResponse = await generateEmbeddings(selectedModel, [kbSearchQuery.trim()]);
      const queryVector = embedResponse.data[0]?.embedding;
      if (!queryVector) throw new Error('Failed to generate query embedding');
      const results = await searchSimilar(queryVector, kbSearchTopK, kbSearchThreshold);
      setKbSearchResults(results);
    } catch (err: any) {
      setError(`Search failed: ${err.message}`);
    } finally {
      setKbSearching(false);
    }
  };

  const toggleKBSelect = (id: string) => {
    setKbSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Cosine similarity between two vectors
  const cosineSimilarity = (a: number[], b: number[]): number => {
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  };

  const totalPages = Math.ceil(kbTotal / 50);

  return (
    <div className="h-screen bg-slate-950 flex overflow-hidden">

      {/* Clear All Confirm Modal */}
      {showClearConfirm && (
        <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-slate-900 border border-red-900/50 rounded-2xl p-6 max-w-sm shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-2">Clear Knowledge Base?</h3>
            <p className="text-sm text-slate-400 mb-6">This will permanently delete all {kbDocCount} documents. This action cannot be undone.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowClearConfirm(false)} className="px-4 py-2 text-slate-300 hover:text-white transition-colors">Cancel</button>
              <button onClick={handleKBClearAll} className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-bold transition-colors">Delete All</button>
            </div>
          </div>
        </div>
      )}

      {/* Left Panel: Input & Config */}
      <div className="w-[500px] border-r border-slate-800 flex flex-col bg-slate-900/30">

        <div className="p-8 border-b border-slate-800">
          <h1 className="text-2xl font-bold text-white mb-2">Embeddings</h1>
          <p className="text-slate-400 text-sm">Generate vector representations for semantic search and RAG.</p>
        </div>

        <div className="p-8 flex-1 flex flex-col gap-6 overflow-y-auto">

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">Embedding Model</label>
              <div className="relative">
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 text-white text-sm rounded-lg p-3 appearance-none focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  {availableModels.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <div className="absolute right-3 top-3.5 pointer-events-none text-slate-500">
                  <svg className="w-4 h-4 fill-current" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">Status</label>
              <div className="flex items-center justify-between bg-slate-900 border border-slate-700 p-2.5 rounded-lg h-[46px]">
                <span className="text-xs text-slate-400">
                  {availableModels.length > 0 ? `${availableModels.length} model(s) available` : 'Checking...'}
                </span>
                <span className={`w-2 h-2 rounded-full ${availableModels.length > 0 ? 'bg-emerald-500' : 'bg-yellow-500 animate-pulse'}`}></span>
              </div>
            </div>
          </div>

          <div className="flex-1 flex flex-col min-h-[250px]">
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-medium text-slate-300">Input Text</label>
              <span className="text-xs text-slate-500">One sentence per line</span>
            </div>
            <textarea
              className="flex-1 w-full bg-slate-900 border border-slate-700 rounded-xl p-4 text-sm text-slate-200 font-mono leading-relaxed resize-none focus:ring-2 focus:ring-blue-500/50 outline-none"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
            />
            <div className="mt-2 text-xs text-slate-500 font-mono">
              {inputText.split('\n').filter(l => l.trim()).length} line(s) / {inputText.length} chars
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-900/20 border border-red-900/50 rounded-lg text-red-200 text-xs flex items-start gap-2">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          {kbSaveSuccess && (
            <div className="p-3 bg-emerald-900/20 border border-emerald-900/50 rounded-lg text-emerald-200 text-xs flex items-center gap-2">
              <CheckCircle2 size={14} className="shrink-0" />
              {kbSaveSuccess}
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className={`w-full py-3.5 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-blue-900/20 active:scale-[0.99] ${
              isGenerating ? 'bg-slate-700 cursor-wait' : 'bg-blue-600 hover:bg-blue-500'
            }`}
          >
            {isGenerating ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} className="fill-current" />}
            {isGenerating ? 'Generating...' : 'Generate Embeddings'}
          </button>
        </div>
      </div>

      {/* Right Panel: Tabbed */}
      <div className="flex-1 bg-slate-950 flex flex-col min-w-0">

        {/* Tab Header */}
        <div className="h-20 border-b border-slate-800 flex items-center px-8 bg-slate-900/20 gap-6">
          <button
            onClick={() => setRightTab('output')}
            className={`flex items-center gap-2 font-medium transition-colors pb-1 ${
              rightTab === 'output'
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <BarChart2 size={18} /> Output Explorer
          </button>
          <button
            onClick={() => setRightTab('kb')}
            className={`flex items-center gap-2 font-medium transition-colors pb-1 ${
              rightTab === 'kb'
                ? 'text-amber-400 border-b-2 border-amber-400'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <Database size={18} /> Knowledge Base
            {kbDocCount > 0 && (
              <span className="text-[10px] font-bold bg-amber-900/30 text-amber-400 px-1.5 py-0.5 rounded border border-amber-900/50">
                {kbDocCount}
              </span>
            )}
          </button>
        </div>

        {/* Tab Content */}
        {rightTab === 'output' ? (
          <>
            <div className="flex-1 p-8 overflow-y-auto">
              {/* Session Stats */}
              {sessionStats && (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 mb-6">
                  <div className="flex justify-between items-start mb-6">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Current Session</span>
                    <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-bold px-2 py-0.5 rounded uppercase">Completed</span>
                  </div>
                  <div className="grid grid-cols-4 gap-8">
                    <div>
                      <span className="text-xs text-slate-500 block mb-1">Model</span>
                      <span className="text-sm font-medium text-white">{sessionStats.model}</span>
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 block mb-1">Dimensions</span>
                      <span className="text-sm font-medium text-white">{sessionStats.dimensions}</span>
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 block mb-1">Tokens</span>
                      <span className="text-sm font-medium text-white">{sessionStats.tokens}</span>
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 block mb-1">Total Vectors</span>
                      <span className="text-sm font-medium text-white">{sessionStats.totalVectors}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Similarity Matrix (when 2+ vectors) */}
              {vectors.length >= 2 && (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 mb-6">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-4">Cosine Similarity</span>
                  <div className="overflow-x-auto">
                    <table className="text-xs font-mono">
                      <thead>
                        <tr>
                          <th className="p-2 text-slate-500"></th>
                          {vectors.map((_, j) => (
                            <th key={j} className="p-2 text-slate-400">#{j + 1}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {vectors.map((vi, i) => (
                          <tr key={i}>
                            <td className="p-2 text-slate-400">#{i + 1}</td>
                            {vectors.map((vj, j) => {
                              const sim = cosineSimilarity(vi.embedding, vj.embedding);
                              const intensity = Math.abs(sim);
                              return (
                                <td key={j} className="p-2 text-center" style={{
                                  backgroundColor: i === j ? 'rgba(59,130,246,0.15)' : `rgba(${sim > 0 ? '16,185,129' : '239,68,68'}, ${intensity * 0.3})`,
                                }}>
                                  <span className={sim > 0.8 ? 'text-emerald-400' : sim > 0.5 ? 'text-yellow-400' : 'text-slate-400'}>
                                    {sim.toFixed(3)}
                                  </span>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Vector List */}
              {vectors.length > 0 ? (
                <div className="space-y-4">
                  {vectors.map((v, idx) => (
                    <div key={idx} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                      <div
                        className="px-4 py-3 border-b border-slate-800 flex justify-between items-center bg-slate-800/30 cursor-pointer hover:bg-slate-800/50 transition-colors"
                        onClick={() => toggleExpand(idx)}
                      >
                        <div className="flex items-center gap-3">
                          <FileText size={16} className="text-slate-500" />
                          <span className="text-sm text-slate-200 font-medium truncate max-w-md">
                            #{idx + 1}: {v.text}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">{v.embedding.length}d</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); copyVector(idx, v.embedding); }}
                            className="p-1 text-slate-500 hover:text-white transition-colors"
                            title="Copy embedding vector"
                          >
                            {copied === idx ? <CheckCircle2 size={14} className="text-emerald-400" /> : <Copy size={14} />}
                          </button>
                          {v.expanded ? <ChevronUp size={16} className="text-slate-500" /> : <ChevronDown size={16} className="text-slate-500" />}
                        </div>
                      </div>

                      {v.expanded && (
                        <div className="p-4">
                          <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                            {v.embedding.slice(0, 20).map((val, vIdx) => (
                              <div key={vIdx} className="bg-slate-950 rounded border border-slate-800/50 p-2 text-center hover:border-blue-500/30 transition-colors">
                                <span className="text-[10px] font-mono text-slate-400">{val.toFixed(4)}</span>
                              </div>
                            ))}
                          </div>
                          {v.embedding.length > 20 && (
                            <div className="mt-3 text-right">
                              <span className="text-[10px] text-slate-500 italic">Showing first 20 of {v.embedding.length} values</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : !isGenerating && (
                <div className="h-full flex flex-col items-center justify-center text-slate-600 -mt-20">
                  <BarChart2 size={48} className="mb-4 opacity-50" />
                  <p className="text-sm">No embeddings yet.</p>
                  <p className="text-xs text-slate-500 mt-2">Enter text and click Generate.</p>
                </div>
              )}
            </div>

            <div className="mt-auto border-t border-slate-800 p-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Database size={14} className={kbDocCount > 0 ? 'text-amber-400' : 'text-slate-600'} />
                Knowledge Base: {kbDocCount} documents
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSaveToKB}
                  disabled={vectors.length === 0 || kbSaving}
                  className="flex items-center gap-2 text-sm font-medium text-amber-400 hover:text-amber-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {kbSaving ? <Loader2 size={16} className="animate-spin" /> : <Database size={16} />}
                  Save to Knowledge Base
                </button>
                <div className="h-4 w-px bg-slate-700"></div>
                <button
                  onClick={exportAll}
                  disabled={vectors.length === 0}
                  className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Download size={16} /> Export All as JSON
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Knowledge Base Tab Content */}
            <div className="flex-1 flex flex-col overflow-hidden">

              {/* Stats Bar */}
              {kbStats && (
                <div className="px-6 py-4 border-b border-slate-800 bg-slate-900/30">
                  <div className="flex items-center gap-6">
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase font-bold block">Total</span>
                      <span className="text-lg font-bold text-white">{kbStats.total}</span>
                    </div>
                    {Object.entries(kbStats.sources).map(([src, count]) => (
                      <div key={src}>
                        <span className="text-[10px] text-slate-500 uppercase font-bold block">{src}</span>
                        <span className="text-lg font-bold text-slate-300">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Filters & Search */}
              <div className="px-6 py-3 border-b border-slate-800 flex items-center gap-3 flex-wrap">
                <select
                  value={kbFilterSource}
                  onChange={(e) => { setKbFilterSource(e.target.value); setKbPage(1); }}
                  className="bg-slate-900 border border-slate-700 text-slate-300 text-xs rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="">All Sources</option>
                  <option value="manual">Manual</option>
                  <option value="dataset">Dataset</option>
                </select>

                {kbStats && kbStats.source_labels.length > 0 && (
                  <select
                    value={kbFilterLabel}
                    onChange={(e) => { setKbFilterLabel(e.target.value); setKbPage(1); }}
                    className="bg-slate-900 border border-slate-700 text-slate-300 text-xs rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="">All Labels</option>
                    {kbStats.source_labels.map(l => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                )}

                <div className="flex items-center gap-3 ml-auto">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-slate-500 font-bold uppercase">Top K</span>
                    <input type="range" min="1" max="20" step="1"
                      value={kbSearchTopK} onChange={(e) => setKbSearchTopK(parseInt(e.target.value))}
                      className="w-16 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500" />
                    <span className="text-[10px] text-amber-400 font-mono w-4 text-right">{kbSearchTopK}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-slate-500 font-bold uppercase">Threshold</span>
                    <input type="range" min="0" max="1" step="0.05"
                      value={kbSearchThreshold} onChange={(e) => setKbSearchThreshold(parseFloat(e.target.value))}
                      className="w-16 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500" />
                    <span className="text-[10px] text-amber-400 font-mono w-7 text-right">{kbSearchThreshold.toFixed(2)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={kbSearchQuery}
                    onChange={(e) => setKbSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleKBSearch()}
                    placeholder="Semantic search..."
                    className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2 w-48 outline-none focus:ring-2 focus:ring-amber-500 font-mono"
                  />
                  <button
                    onClick={handleKBSearch}
                    disabled={kbSearching || !kbSearchQuery.trim()}
                    className="p-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg disabled:opacity-50 transition-colors"
                  >
                    {kbSearching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                  </button>
                  {kbSearchResults && (
                    <button
                      onClick={() => { setKbSearchResults(null); setKbSearchQuery(''); }}
                      className="p-2 text-slate-500 hover:text-white transition-colors"
                      title="Clear search"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>

              {/* Document Table or Search Results */}
              <div className="flex-1 overflow-auto">
                {kbSearchResults ? (
                  // Search Results View
                  <div className="p-6 space-y-3">
                    <div className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-4">
                      Search Results ({kbSearchResults.length} matches)
                    </div>
                    {kbSearchResults.length === 0 ? (
                      <p className="text-sm text-slate-500">No matching documents found.</p>
                    ) : (
                      kbSearchResults.map((r, i) => (
                        <div key={r.document.id} className="bg-slate-900 border border-slate-800 rounded-lg p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-2">
                                <span className={`text-xs font-bold font-mono ${
                                  r.similarity >= 0.8 ? 'text-emerald-400' : r.similarity >= 0.5 ? 'text-yellow-400' : 'text-slate-500'
                                }`}>
                                  {Math.round(r.similarity * 100)}%
                                </span>
                                <span className="text-[10px] text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">{r.document.source}</span>
                                {r.document.source_label && (
                                  <span className="text-[10px] text-amber-400/70 bg-amber-900/20 px-1.5 py-0.5 rounded">{r.document.source_label}</span>
                                )}
                              </div>
                              <p className="text-xs text-slate-300 leading-relaxed line-clamp-3">{r.document.text}</p>
                            </div>
                            <button
                              onClick={() => handleKBDelete(r.document.id)}
                              className="p-1.5 text-slate-600 hover:text-red-400 transition-colors shrink-0"
                              title="Delete"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                ) : kbLoading ? (
                  <div className="flex items-center justify-center h-full text-slate-500">
                    <Loader2 size={24} className="animate-spin" />
                  </div>
                ) : kbDocs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-slate-600">
                    <Database size={48} className="mb-4 opacity-50" />
                    <p className="text-sm">Knowledge Base is empty.</p>
                    <p className="text-xs text-slate-500 mt-2">Generate embeddings or import from Datasets.</p>
                  </div>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-900 text-slate-400 font-medium uppercase text-xs border-b border-slate-800 sticky top-0">
                      <tr>
                        <th className="px-4 py-3 w-10">
                          <input
                            type="checkbox"
                            checked={kbSelectedIds.size === kbDocs.length && kbDocs.length > 0}
                            onChange={() => {
                              if (kbSelectedIds.size === kbDocs.length) {
                                setKbSelectedIds(new Set());
                              } else {
                                setKbSelectedIds(new Set(kbDocs.map(d => d.id)));
                              }
                            }}
                            className="accent-amber-500"
                          />
                        </th>
                        <th className="px-4 py-3">Text</th>
                        <th className="px-4 py-3 w-20">Source</th>
                        <th className="px-4 py-3 w-36">Label</th>
                        <th className="px-4 py-3 w-36">Created</th>
                        <th className="px-4 py-3 w-16"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                      {kbDocs.map(doc => (
                        <tr key={doc.id} className={`transition-colors ${kbSelectedIds.has(doc.id) ? 'bg-amber-900/10' : 'hover:bg-slate-800/30'}`}>
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={kbSelectedIds.has(doc.id)}
                              onChange={() => toggleKBSelect(doc.id)}
                              className="accent-amber-500"
                            />
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-300 max-w-[300px] truncate font-mono">{doc.text}</td>
                          <td className="px-4 py-3">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              doc.source === 'dataset' ? 'bg-blue-900/20 text-blue-400' : 'bg-slate-800 text-slate-400'
                            }`}>
                              {doc.source}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-[11px] text-slate-500 truncate max-w-[140px]">{doc.source_label}</td>
                          <td className="px-4 py-3 text-[11px] text-slate-500 font-mono">
                            {new Date(doc.created_at).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => handleKBDelete(doc.id)}
                              className="p-1 text-slate-600 hover:text-red-400 transition-colors"
                              title="Delete document"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Bottom Bar */}
              <div className="border-t border-slate-800 px-6 py-3 flex items-center justify-between bg-slate-900/30">
                <div className="flex items-center gap-3">
                  {kbSelectedIds.size > 0 && (
                    <button
                      onClick={handleKBBulkDelete}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-red-400 bg-red-900/20 rounded-lg hover:bg-red-900/30 border border-red-900/30 transition-colors"
                    >
                      <Trash2 size={12} /> Delete Selected ({kbSelectedIds.size})
                    </button>
                  )}
                  <button
                    onClick={() => setShowClearConfirm(true)}
                    disabled={kbDocCount === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-500 hover:text-red-400 transition-colors disabled:opacity-30"
                  >
                    <Trash2 size={12} /> Clear All
                  </button>
                </div>

                {/* Pagination */}
                {totalPages > 1 && !kbSearchResults && (
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      onClick={() => setKbPage(p => Math.max(1, p - 1))}
                      disabled={kbPage === 1}
                      className="px-2 py-1 bg-slate-800 rounded text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
                    >
                      Prev
                    </button>
                    <span className="text-slate-500">{kbPage} / {totalPages}</span>
                    <button
                      onClick={() => setKbPage(p => Math.min(totalPages, p + 1))}
                      disabled={kbPage === totalPages}
                      className="px-2 py-1 bg-slate-800 rounded text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Embeddings;
