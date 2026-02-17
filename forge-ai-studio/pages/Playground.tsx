import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Save,
  Share2,
  Play,
  Square,
  SlidersHorizontal,
  Copy,
  TerminalSquare,
  Sparkles,
  Loader2,
  ChevronDown,
  ChevronUp,
  Brain,
  Info,
  CheckCircle2,
  Database,
  Search,
} from 'lucide-react';
import { fetchVLLMModels, streamChatCompletion, ChatCompletionParams } from '../services/vllm';
import { logChatRequest } from '../services/historyApi';
import { Model } from '../types';
import { parseThinkTags, renderMarkdownToHTML } from '../services/markdown';
import { executeRAGPipeline, RAGResult } from '../services/rag';
import { getDocumentCount, getStats } from '../services/kbApi';
import { fetchEmbedModels } from '../services/vllm';

const Playground = () => {
  // State
  const [prompt, setPrompt] = useState('Write a short poem about coding in the style of Shakespeare.');
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful AI assistant.');
  const [output, setOutput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Model State
  const [availableModels, setAvailableModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');

  // Core params
  const [thinking, setThinking] = useState(false);
  const [stream, setStream] = useState(true);
  const [temperature, setTemperature] = useState(0.7);
  const [topP, setTopP] = useState(0.9);
  const [topK, setTopK] = useState(0);
  const [maxTokens, setMaxTokens] = useState(2048);

  // Advanced params
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [presencePenalty, setPresencePenalty] = useState(0);
  const [frequencyPenalty, setFrequencyPenalty] = useState(0);
  const [repetitionPenalty, setRepetitionPenalty] = useState(1.0);
  const [seed, setSeed] = useState<string>('');
  const [stopSequences, setStopSequences] = useState('');
  const [jsonMode, setJsonMode] = useState(false);

  // RAG State
  const [ragEnabled, setRagEnabled] = useState(false);
  const [ragTopK, setRagTopK] = useState(3);
  const [ragThreshold, setRagThreshold] = useState(0.3);
  const [ragContext, setRagContext] = useState<RAGResult['relevantDocs']>([]);
  const [ragLoading, setRagLoading] = useState(false);
  const [showRagContext, setShowRagContext] = useState(true);
  const [ragSearchTime, setRagSearchTime] = useState(0);
  const [kbDocCount, setKbDocCount] = useState(0);
  const [embedModel, setEmbedModel] = useState('');
  const [ragSources, setRagSources] = useState<string[]>([]);
  const [availableSources, setAvailableSources] = useState<string[]>([]);

  // Timing - use ref to avoid stale closure
  const startTimeRef = useRef<number>(0);
  const [elapsedTime, setElapsedTime] = useState<string>('0ms');

  // AbortController
  const abortControllerRef = useRef<AbortController | null>(null);

  // Initial Load
  useEffect(() => {
    fetchVLLMModels()
      .then(models => {
        if (models.length > 0) {
          setAvailableModels(models);
          setSelectedModel(models[0].id);
        }
      })
      .catch(err => {
        console.warn("Playground failed to fetch models:", err);
      });

    // Fetch embed models for RAG
    fetchEmbedModels().then(models => {
      if (models.length > 0) setEmbedModel(models[0]);
    });
  }, []);

  // Poll KB doc count and fetch available sources
  useEffect(() => {
    const fetchKBInfo = async () => {
      try {
        const stats = await getStats();
        setKbDocCount(stats.total);
        setAvailableSources(stats.source_labels);
      } catch {
        setKbDocCount(0);
      }
    };
    fetchKBInfo();
    const interval = setInterval(fetchKBInfo, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleRun = useCallback(async () => {
    if (!selectedModel) {
      setError("Please select a model first (check Settings if list is empty).");
      return;
    }

    setIsGenerating(true);
    setOutput('');
    setError(null);
    setRagContext([]);
    setRagSearchTime(0);
    startTimeRef.current = Date.now();

    const controller = new AbortController();
    abortControllerRef.current = controller;

    let messages: { role: string; content: string }[] = [];

    // RAG Pipeline
    if (ragEnabled && kbDocCount > 0 && embedModel) {
      setRagLoading(true);
      try {
        const ragResult = await executeRAGPipeline(
          prompt,
          systemPrompt,
          embedModel,
          { topK: ragTopK, threshold: ragThreshold, signal: controller.signal, sources: ragSources.length > 0 ? ragSources : undefined }
        );
        setRagContext(ragResult.relevantDocs);
        setRagSearchTime(ragResult.searchTimeMs + ragResult.embeddingTimeMs);
        messages = ragResult.augmentedMessages;
      } catch (err: any) {
        if (err.name === 'AbortError') {
          setIsGenerating(false);
          setRagLoading(false);
          return;
        }
        console.warn('RAG pipeline failed, falling back to normal mode:', err);
        // Fall back to normal messages
        messages = [];
        if (systemPrompt.trim()) messages.push({ role: "system", content: systemPrompt });
        messages.push({ role: "user", content: prompt });
      }
      setRagLoading(false);
    } else {
      if (systemPrompt.trim()) messages.push({ role: "system", content: systemPrompt });
      messages.push({ role: "user", content: prompt });
    }

    const params: ChatCompletionParams = {
      temperature,
      top_p: topP,
      max_tokens: maxTokens,
    };

    if (topK > 0) params.top_k = topK;
    if (presencePenalty !== 0) params.presence_penalty = presencePenalty;
    if (frequencyPenalty !== 0) params.frequency_penalty = frequencyPenalty;
    if (repetitionPenalty !== 1.0) params.repetition_penalty = repetitionPenalty;
    if (seed.trim()) params.seed = parseInt(seed);
    if (stopSequences.trim()) params.stop = stopSequences.split(',').map(s => s.trim()).filter(Boolean);
    if (jsonMode) params.response_format = { type: 'json_object' };
    params.chat_template_kwargs = { enable_thinking: thinking };

    let fullOutput = '';

    await streamChatCompletion(
      selectedModel,
      messages,
      params,
      (chunk) => {
        fullOutput += chunk;
        setOutput(prev => prev + chunk);
      },
      () => {
        const elapsed = Date.now() - startTimeRef.current;
        setElapsedTime(elapsed < 1000 ? `${elapsed}ms` : `${(elapsed / 1000).toFixed(2)}s`);
        setIsGenerating(false);
        abortControllerRef.current = null;

        // Log to history
        logChatRequest({
          model: selectedModel,
          promptPreview: prompt.slice(0, 100),
          responsePreview: fullOutput.slice(0, 150),
          durationMs: elapsed,
          status: 200,
          statusText: 'OK',
          tokenEstimate: Math.ceil((prompt.length + fullOutput.length) / 4),
          messages,
          params,
          fullResponse: fullOutput,
          ragConfig: ragEnabled ? { enabled: true, topK: ragTopK, threshold: ragThreshold, sources: ragSources, contextCount: ragContext.length } : undefined,
        });
      },
      (err) => {
        const elapsed = Date.now() - startTimeRef.current;
        setError(err.message || "Failed to generate response");
        setIsGenerating(false);
        abortControllerRef.current = null;

        logChatRequest({
          model: selectedModel,
          promptPreview: prompt.slice(0, 100),
          responsePreview: err.message || 'Error',
          durationMs: elapsed,
          status: 500,
          statusText: 'Error',
          tokenEstimate: 0,
          messages,
          params,
          fullResponse: err.message || 'Error',
        });
      },
      controller.signal
    );
  }, [selectedModel, prompt, systemPrompt, temperature, topP, topK, maxTokens,
      presencePenalty, frequencyPenalty, repetitionPenalty, seed, stopSequences,
      jsonMode, thinking, ragEnabled, ragTopK, ragThreshold, kbDocCount, embedModel, ragSources]);

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const Toggle = ({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) => (
    <label className="flex items-center gap-3 cursor-pointer">
      <div className={`w-10 h-5 rounded-full relative transition-colors ${value ? 'bg-blue-600' : 'bg-slate-700'}`} onClick={() => onChange(!value)}>
        <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${value ? 'left-6' : 'left-1'}`} />
      </div>
      <span className="text-sm text-slate-300 font-medium">{label}</span>
    </label>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950">
      {/* Left Column: Configuration & Prompt */}
      <div className="flex-1 flex flex-col border-r border-slate-800 min-w-[500px]">

        {/* Header */}
        <div className="h-16 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-900/50 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <span>Workspaces</span>
            <span className="text-slate-600">/</span>
            <span className="text-white font-medium">Generate Playground</span>
          </div>
          <div className="flex gap-3">
            <button className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-md transition-colors border border-slate-700">
              <Save size={14} /> Save Preset
            </button>
            <button className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-md transition-colors border border-slate-700">
              <Share2 size={14} /> Share
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">

          {/* Model Selection */}
          <section>
            <h3 className="text-sm font-medium text-slate-400 mb-3">Model Selection</h3>
            <div className="flex gap-4">
              <div className="relative flex-1">
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 text-white text-sm rounded-lg p-3 appearance-none focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                >
                  {availableModels.length === 0 ? <option>Loading or No Connection...</option> : null}
                  {availableModels.map(m => (
                    <option key={m.id} value={m.id}>{m.id}</option>
                  ))}
                </select>
                <div className="absolute right-3 top-3.5 pointer-events-none text-slate-500">
                  <svg className="w-4 h-4 fill-current" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-blue-400 bg-blue-900/20 px-4 rounded-lg border border-blue-900/50">
                <Info size={14} />
                vLLM Backend
              </div>
            </div>
          </section>

          {/* System Prompt */}
          <section>
            <h3 className="text-sm font-medium text-slate-400 mb-3">System Prompt</h3>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={3}
              className="w-full bg-slate-900/50 border border-slate-700 rounded-xl p-4 text-sm text-slate-200 font-mono resize-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 outline-none leading-relaxed"
              placeholder="System instructions for the model..."
            />
          </section>

          {/* Quick Presets */}
          <section>
            <h3 className="text-sm font-medium text-slate-400 mb-3">Quick Presets</h3>
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'Creative Story', system: 'You are a creative storyteller.', temp: 0.9 },
                { label: 'Code Refactor', system: 'You are an expert programmer. Refactor code for clarity and efficiency.', temp: 0.3 },
                { label: 'Unit Tester', system: 'You write comprehensive unit tests.', temp: 0.2 },
                { label: 'Data Analysis', system: 'You are a data analysis expert.', temp: 0.4 },
                { label: 'Precise Q&A', system: 'You answer questions precisely and concisely.', temp: 0.1 },
              ].map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => {
                    setSystemPrompt(preset.system);
                    setTemperature(preset.temp);
                  }}
                  className="px-4 py-2 text-xs font-medium rounded-full border transition-colors bg-slate-900 text-slate-400 border-slate-700 hover:border-slate-500 hover:text-slate-200"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </section>

          {/* User Prompt */}
          <section className="flex-1 flex flex-col min-h-[200px]">
            <div className="flex justify-between items-center mb-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-slate-400">User Prompt</h3>
                {ragEnabled && prompt.includes('{{context}}') && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-900/30 text-amber-400 border border-amber-900/50">
                    Template Mode
                  </span>
                )}
              </div>
              <span className="text-xs text-slate-500 font-mono">
                CHAR: {prompt.length} / TOKEN: ~{Math.ceil(prompt.length / 4)}
              </span>
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full flex-1 min-h-[200px] bg-slate-900/50 border border-slate-700 rounded-xl p-4 text-sm text-slate-200 font-mono resize-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 outline-none custom-scrollbar leading-relaxed"
              placeholder="Enter your prompt here..."
            />
            {ragEnabled && (
              <p className="mt-2 text-xs text-slate-500">
                Tip: Use <code className="text-amber-400/80 bg-amber-900/20 px-1.5 py-0.5 rounded font-mono">{'{{context}}'}</code> in your prompt to place RAG chunks exactly where you want.
              </p>
            )}
          </section>

          {/* Toggles Row */}
          <section className="bg-slate-900/50 rounded-xl p-4 border border-slate-800 flex items-center gap-6 flex-wrap">
            <Toggle value={stream} onChange={setStream} label="Stream Output" />
            <div className="h-6 w-px bg-slate-700" />
            <label className="flex items-center gap-3 cursor-pointer">
              <div className={`w-10 h-5 rounded-full relative transition-colors ${thinking ? 'bg-purple-600' : 'bg-slate-700'}`} onClick={() => setThinking(!thinking)}>
                <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${thinking ? 'left-6' : 'left-1'}`} />
              </div>
              <span className="text-sm text-slate-300 font-medium flex items-center gap-1.5">
                <Brain size={14} className={thinking ? 'text-purple-400' : 'text-slate-500'} />
                Thinking Mode
              </span>
            </label>
            <div className="h-6 w-px bg-slate-700" />
            <label className="flex items-center gap-3 cursor-pointer">
              <div className={`w-10 h-5 rounded-full relative transition-colors ${jsonMode ? 'bg-emerald-600' : 'bg-slate-700'}`} onClick={() => setJsonMode(!jsonMode)}>
                <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${jsonMode ? 'left-6' : 'left-1'}`} />
              </div>
              <span className="text-sm text-slate-300 font-medium">JSON Mode</span>
            </label>
            <div className="h-6 w-px bg-slate-700" />
            <label className="flex items-center gap-3 cursor-pointer">
              <div className={`w-10 h-5 rounded-full relative transition-colors ${ragEnabled ? 'bg-amber-600' : 'bg-slate-700'}`} onClick={() => setRagEnabled(!ragEnabled)}>
                <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${ragEnabled ? 'left-6' : 'left-1'}`} />
              </div>
              <span className="text-sm text-slate-300 font-medium flex items-center gap-1.5">
                <Database size={14} className={ragEnabled ? 'text-amber-400' : 'text-slate-500'} />
                RAG Mode
              </span>
              {kbDocCount > 0 && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${ragEnabled ? 'bg-amber-900/30 text-amber-400 border border-amber-900/50' : 'bg-slate-800 text-slate-500'}`}>
                  {kbDocCount} docs
                </span>
              )}
            </label>
          </section>

          {/* RAG Source Filter / Config */}
          {ragEnabled && (
            <section className="bg-amber-900/10 border border-amber-900/30 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Search size={14} className="text-amber-400" />
                <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">RAG Config</span>
                <span className="text-[10px] text-slate-500 ml-auto flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 rounded ${prompt.includes('{{context}}') ? 'bg-amber-900/30 text-amber-400 border border-amber-900/50' : 'bg-slate-800 text-slate-500'}`}>
                    {prompt.includes('{{context}}') ? 'Inject → User Prompt (template)' : 'Inject → System Prompt (auto)'}
                  </span>
                  {ragSources.length === 0 ? 'All sources' : `${ragSources.length} selected`}
                </span>
              </div>

              {availableSources.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {availableSources.map(label => {
                    const isSelected = ragSources.includes(label);
                    return (
                      <button
                        key={label}
                        onClick={() => {
                          setRagSources(prev =>
                            isSelected ? prev.filter(s => s !== label) : [...prev, label]
                          );
                        }}
                        className={`px-2.5 py-1 text-[11px] font-medium rounded-full border transition-all ${
                          isSelected
                            ? 'bg-amber-600/20 text-amber-300 border-amber-600/50'
                            : 'bg-slate-800/50 text-slate-500 border-slate-700 hover:text-slate-300 hover:border-slate-600'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                  {ragSources.length > 0 && (
                    <button
                      onClick={() => setRagSources([])}
                      className="px-2.5 py-1 text-[11px] font-medium rounded-full text-slate-500 hover:text-white transition-colors"
                    >
                      Clear all
                    </button>
                  )}
                </div>
              )}

              <div className="flex items-center gap-6 pt-1 border-t border-amber-900/20">
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-[10px] text-slate-500 font-bold uppercase shrink-0">Top K</span>
                  <input type="range" min="1" max="20" step="1"
                    value={ragTopK} onChange={(e) => setRagTopK(parseInt(e.target.value))}
                    className="flex-1 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500" />
                  <span className="text-xs text-amber-400 font-mono w-4 text-right">{ragTopK}</span>
                </div>
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-[10px] text-slate-500 font-bold uppercase shrink-0">Threshold</span>
                  <input type="range" min="0" max="1" step="0.05"
                    value={ragThreshold} onChange={(e) => setRagThreshold(parseFloat(e.target.value))}
                    className="flex-1 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500" />
                  <span className="text-xs text-amber-400 font-mono w-7 text-right">{ragThreshold.toFixed(2)}</span>
                </div>
              </div>
            </section>
          )}

          {/* Core Model Params */}
          <section className="space-y-6 pt-4 border-t border-slate-800">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-slate-300 font-medium">
                <SlidersHorizontal size={16} /> Model Parameters
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Temperature</span>
                  <span className="text-blue-400 font-mono">{temperature}</span>
                </div>
                <input type="range" min="0" max="2" step="0.1"
                  value={temperature} onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500" />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Top P</span>
                  <span className="text-blue-400 font-mono">{topP}</span>
                </div>
                <input type="range" min="0" max="1" step="0.05"
                  value={topP} onChange={(e) => setTopP(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500" />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Top K</span>
                  <span className="text-blue-400 font-mono">{topK === 0 ? 'off' : topK}</span>
                </div>
                <input type="range" min="0" max="100" step="1"
                  value={topK} onChange={(e) => setTopK(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500" />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Max Tokens</span>
                  <span className="text-blue-400 font-mono">{maxTokens}</span>
                </div>
                <input type="range" min="256" max="32768" step="256"
                  value={maxTokens} onChange={(e) => setMaxTokens(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500" />
              </div>
            </div>
          </section>

          {/* Advanced Params Accordion */}
          <section className="border border-slate-800 rounded-xl overflow-hidden">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full px-4 py-3 flex items-center justify-between text-sm font-medium text-slate-400 hover:text-slate-200 bg-slate-900/50 transition-colors"
            >
              <span>Advanced Parameters</span>
              {showAdvanced ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            {showAdvanced && (
              <div className="p-4 space-y-5 border-t border-slate-800 bg-slate-900/30">
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Presence Penalty</span>
                      <span className="text-blue-400 font-mono">{presencePenalty}</span>
                    </div>
                    <input type="range" min="-2" max="2" step="0.1"
                      value={presencePenalty} onChange={(e) => setPresencePenalty(parseFloat(e.target.value))}
                      className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Frequency Penalty</span>
                      <span className="text-blue-400 font-mono">{frequencyPenalty}</span>
                    </div>
                    <input type="range" min="-2" max="2" step="0.1"
                      value={frequencyPenalty} onChange={(e) => setFrequencyPenalty(parseFloat(e.target.value))}
                      className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Repetition Penalty</span>
                      <span className="text-blue-400 font-mono">{repetitionPenalty}</span>
                    </div>
                    <input type="range" min="0.5" max="2" step="0.05"
                      value={repetitionPenalty} onChange={(e) => setRepetitionPenalty(parseFloat(e.target.value))}
                      className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs text-slate-400">Seed</label>
                    <input type="text"
                      value={seed}
                      onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ''))}
                      placeholder="Random (empty)"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:ring-2 focus:ring-blue-500 outline-none font-mono" />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-slate-400">Stop Sequences (comma separated)</label>
                  <input type="text"
                    value={stopSequences}
                    onChange={(e) => setStopSequences(e.target.value)}
                    placeholder="e.g. \n\n, END, ###"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:ring-2 focus:ring-blue-500 outline-none font-mono" />
                </div>
              </div>
            )}
          </section>

          {/* Run / Stop Button */}
          {isGenerating ? (
            <button
              onClick={handleStop}
              className="w-full py-4 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-all bg-red-600 hover:bg-red-500 shadow-lg shadow-red-900/20 active:scale-[0.99]"
            >
              <Square size={16} className="fill-current" /> Stop Generation
            </button>
          ) : (
            <button
              onClick={handleRun}
              disabled={availableModels.length === 0}
              className="w-full py-4 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-blue-900/20 active:scale-[0.99] bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play className="fill-current" size={16} /> Run Configuration
            </button>
          )}
        </div>
      </div>

      {/* Right Column: Output */}
      <div className="w-[500px] flex flex-col border-l border-slate-800 bg-[#0B1120]">

        {/* Output Header */}
        <div className="h-16 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-900/50 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-slate-300 font-medium">
            <TerminalSquare size={18} className="text-slate-400" /> OUTPUT
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${availableModels.length > 0 ? 'bg-emerald-500' : 'bg-red-500'} ${isGenerating ? 'animate-pulse' : ''}`}></span>
            <span className={`text-xs font-bold tracking-wide ${availableModels.length > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
              {ragLoading ? 'SEARCHING KB...' : isGenerating ? 'GENERATING' : availableModels.length > 0 ? 'READY' : 'OFFLINE'}
            </span>
          </div>
        </div>

        {/* Output Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {error && (
            <div className="bg-red-900/20 border border-red-900/50 p-4 rounded text-red-200 text-sm">
              Error: {error}
            </div>
          )}

          {/* RAG Context Preview */}
          {ragContext.length > 0 && (
            <div className="bg-amber-900/10 border border-amber-900/30 rounded-lg overflow-hidden">
              <button
                onClick={() => setShowRagContext(!showRagContext)}
                className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-bold text-amber-400 hover:bg-amber-900/20 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Search size={12} />
                  Retrieved Context ({ragContext.length} chunks)
                </span>
                {showRagContext ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {showRagContext && (
                <div className="px-4 pb-3 space-y-2">
                  {ragContext.map((r, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <span className={`font-mono font-bold shrink-0 ${
                        r.similarity >= 0.8 ? 'text-emerald-400' : r.similarity >= 0.5 ? 'text-yellow-400' : 'text-slate-500'
                      }`}>
                        [{Math.round(r.similarity * 100)}%]
                      </span>
                      <span className="text-slate-400 leading-relaxed line-clamp-2">
                        {r.document.text.slice(0, 150)}{r.document.text.length > 150 ? '...' : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* RAG Loading State */}
          {ragLoading && (
            <div className="flex items-center gap-3 text-amber-400 text-sm py-4">
              <Loader2 size={16} className="animate-spin" />
              Searching knowledge base...
            </div>
          )}

          {(output || isGenerating) && !ragLoading && (
            <div className="space-y-4 animate-in fade-in duration-500">
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex-shrink-0 flex items-center justify-center shadow-lg shadow-blue-900/20">
                  <Sparkles className="text-white w-4 h-4" />
                </div>
                <div className="space-y-4 flex-1 min-w-0">
                  <div className="text-slate-300 text-sm leading-relaxed font-sans break-words">
                    {(() => {
                      const parsed = parseThinkTags(output);
                      return (
                        <>
                          {parsed.thinking && (
                            <details open className="bg-purple-900/10 border border-purple-900/30 rounded-lg p-3 mb-3">
                              <summary className="text-xs font-bold text-purple-400 cursor-pointer">Thinking...</summary>
                              <div className="mt-2 text-xs text-purple-300/70 whitespace-pre-wrap font-mono">{parsed.thinking}</div>
                            </details>
                          )}
                          <div dangerouslySetInnerHTML={{ __html: renderMarkdownToHTML(parsed.content) }} />
                        </>
                      );
                    })()}
                    {isGenerating && <span className="inline-block w-2 h-4 bg-blue-500 ml-1 animate-pulse"/>}
                  </div>
                </div>
              </div>
            </div>
          )}

          {!output && !isGenerating && !error && !ragLoading && (
            <div className="h-full flex flex-col items-center justify-center text-slate-600">
              <TerminalSquare size={48} className="mb-4 opacity-50" />
              <p className="text-sm">Ready to generate.</p>
            </div>
          )}
        </div>

        {/* Output Footer */}
        <div className="h-14 border-t border-slate-800 bg-slate-900 px-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-500 font-bold uppercase">Length</span>
              <span className="text-xs text-slate-300 font-mono">{output.length} chars</span>
            </div>
            <div className="h-6 w-px bg-slate-800"></div>
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-500 font-bold uppercase">Time</span>
              <span className="text-xs text-slate-300 font-mono">{elapsedTime}</span>
            </div>
            {thinking && (
              <>
                <div className="h-6 w-px bg-slate-800"></div>
                <div className="flex items-center gap-1">
                  <Brain size={12} className="text-purple-400" />
                  <span className="text-[10px] text-purple-400 font-bold uppercase">Thinking ON</span>
                </div>
              </>
            )}
            {ragEnabled && ragContext.length > 0 && (
              <>
                <div className="h-6 w-px bg-slate-800"></div>
                <div className="flex items-center gap-1">
                  <Database size={12} className="text-amber-400" />
                  <span className="text-[10px] text-amber-400 font-bold uppercase">RAG ON ({ragContext.length} ctx)</span>
                </div>
                <div className="h-6 w-px bg-slate-800"></div>
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-500 font-bold uppercase">Search</span>
                  <span className="text-xs text-amber-400 font-mono">{ragSearchTime}ms</span>
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              disabled={!output}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-md transition-colors border border-slate-700 disabled:opacity-50"
            >
              {copied ? <><CheckCircle2 size={14} className="text-emerald-400" /> Copied!</> : <><Copy size={14} /> Copy</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Playground;
