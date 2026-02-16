import React, { useEffect, useState, useRef } from 'react';
import { Sparkles, BarChart2, FileText, Download, Copy, Loader2, ChevronDown, ChevronUp, CheckCircle2, AlertCircle, Database } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { generateEmbeddings, fetchEmbedModels, EmbeddingResponse } from '../services/vllm';
import { logEmbeddingRequest } from '../services/history';
import { addDocuments, getDocumentCount } from '../services/vectorStore';

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
    setKbDocCount(getDocumentCount());
    const interval = setInterval(() => setKbDocCount(getDocumentCount()), 3000);
    return () => clearInterval(interval);
  }, []);

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

  const handleSaveToKB = () => {
    if (vectors.length === 0) return;
    setKbSaving(true);

    try {
      const docs = vectors.map(v => ({
        text: v.text,
        embedding: v.embedding,
        source: 'manual' as const,
        sourceLabel: `Embeddings page`,
      }));

      const count = addDocuments(docs, selectedModel);
      setKbDocCount(getDocumentCount());
      setKbSaveSuccess(`Saved ${count} vectors to Knowledge Base!`);
      setTimeout(() => setKbSaveSuccess(null), 4000);
    } catch (err: any) {
      setError(`Save to KB failed: ${err.message}`);
    } finally {
      setKbSaving(false);
    }
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

  return (
    <div className="h-screen bg-slate-950 flex overflow-hidden">

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

      {/* Right Panel: Output Explorer */}
      <div className="flex-1 bg-slate-950 flex flex-col min-w-0">

        <div className="h-20 border-b border-slate-800 flex items-center px-8 bg-slate-900/20">
          <div className="flex items-center gap-3 text-slate-300 font-medium">
            <BarChart2 size={20} className="text-blue-500" /> Output Explorer
          </div>
        </div>

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
      </div>
    </div>
  );
};

export default Embeddings;
