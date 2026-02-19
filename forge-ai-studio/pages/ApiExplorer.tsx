import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  Search, Send, Copy, Check, Square, Plus, Trash2, Play, ChevronDown, ChevronRight,
  Link2, FileText, BarChart3, Settings, History, Database, FileJson, Bot, GitBranch,
  MessageSquare, Cpu, X, ArrowRight, GripVertical, ExternalLink, Zap,
} from 'lucide-react';
import {
  CATEGORIES, ENDPOINTS, METHOD_COLORS, searchEndpoints, getEndpointsByCategory,
  type EndpointDef, type HttpMethod, type CategoryDef, type ParamDef, type SseEventDef,
} from '../services/apiCatalog';

// --- Icon map for categories ---
const CATEGORY_ICONS: Record<string, React.ComponentType<any>> = {
  FileText, Search, BarChart3, Settings, History, Database, FileJson, Bot, GitBranch, MessageSquare, Cpu,
};

// --- JSON Syntax Colorizer ---
function colorizeJson(json: string): string {
  const escaped = json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return escaped.replace(
    /("(?:[^"\\]|\\.)*")\s*:|("(?:[^"\\]|\\.)*")|(\b(?:true|false|null)\b)|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)/g,
    (_match, key, str, bool, num) => {
      if (key !== undefined) return `<span class="text-blue-400">${key}</span>:`;
      if (str !== undefined) return `<span class="text-emerald-400">${str}</span>`;
      if (bool !== undefined) return `<span class="text-purple-400">${bool}</span>`;
      if (num !== undefined) return `<span class="text-amber-400">${num}</span>`;
      return _match;
    }
  );
}

function JsonBlock({ data, maxHeight }: { data: any; maxHeight?: string }) {
  const json = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return (
    <pre
      className={`text-xs font-mono leading-relaxed whitespace-pre-wrap break-all ${maxHeight || 'max-h-96'} overflow-auto p-3 bg-slate-950 rounded-lg border border-slate-800`}
      dangerouslySetInnerHTML={{ __html: colorizeJson(json) }}
    />
  );
}

// --- Method Badge ---
function MethodBadge({ method, size = 'sm' }: { method: HttpMethod; size?: 'sm' | 'xs' }) {
  const cls = METHOD_COLORS[method];
  const px = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-1.5 py-0.5 text-[10px]';
  return <span className={`${cls} ${px} font-bold rounded border font-mono`}>{method}</span>;
}

// --- Copy Button ---
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={onClick} className="p-1 text-slate-500 hover:text-slate-300 transition-colors" title="Copy">
      {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
    </button>
  );
}

// --- Chain Types ---
interface ChainStep {
  id: string;
  endpoint: EndpointDef;
  bindings: Record<string, { stepId: string; path: string }>; // param name → source
  status: 'pending' | 'running' | 'done' | 'error';
  output?: any;
  error?: string;
  duration?: number;
}

// --- SSE Event Item ---
const SseEventItem: React.FC<{ event: string; time: string; data: string }> = ({ event, time, data }) => {
  const [open, setOpen] = useState(false);
  const colors: Record<string, string> = {
    agent_start: 'bg-blue-500/20 text-blue-400',
    tool_call: 'bg-amber-500/20 text-amber-400',
    tool_result: 'bg-emerald-500/20 text-emerald-400',
    stream: 'bg-slate-500/20 text-slate-400',
    agent_done: 'bg-purple-500/20 text-purple-400',
    error: 'bg-red-500/20 text-red-400',
    step_start: 'bg-blue-500/20 text-blue-400',
    step_stream: 'bg-slate-500/20 text-slate-400',
    step_done: 'bg-emerald-500/20 text-emerald-400',
    step_error: 'bg-red-500/20 text-red-400',
    workflow_done: 'bg-purple-500/20 text-purple-400',
  };
  const color = colors[event] || 'bg-slate-500/20 text-slate-400';

  return (
    <div className="border-b border-slate-800/50 py-1.5 px-2">
      <div className="flex items-center gap-2 cursor-pointer" onClick={() => setOpen(!open)}>
        <span className="text-[10px] text-slate-600 font-mono w-16 shrink-0">{time}</span>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${color}`}>{event}</span>
        <span className="text-[10px] text-slate-500 truncate flex-1">{data.slice(0, 80)}</span>
        {open ? <ChevronDown size={12} className="text-slate-600" /> : <ChevronRight size={12} className="text-slate-600" />}
      </div>
      {open && (
        <pre className="text-[10px] font-mono text-slate-400 mt-1 ml-18 whitespace-pre-wrap break-all max-h-32 overflow-auto bg-slate-950 rounded p-2">
          {data}
        </pre>
      )}
    </div>
  );
}

// ====================================================================================
// MAIN COMPONENT
// ====================================================================================

const ApiExplorer = () => {
  // --- State ---
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>(ENDPOINTS[0]?.id || '');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(() => new Set(CATEGORIES.map(c => c.key)));
  const [rightTab, setRightTab] = useState<'response' | 'chain'>('response');

  // Try It Out state
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [bodyText, setBodyText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<{ status: number; statusText: string; data: any; duration: number } | null>(null);
  const [sseEvents, setSseEvents] = useState<{ event: string; time: string; data: string }[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // Chain state
  const [chainSteps, setChainSteps] = useState<ChainStep[]>([]);
  const [isChainRunning, setIsChainRunning] = useState(false);

  // Deep linking
  useEffect(() => {
    const hash = window.location.hash;
    const match = hash.match(/#\/api-explorer\/(.+)/);
    if (match) {
      const id = match[1];
      if (ENDPOINTS.find(e => e.id === id)) {
        setSelectedId(id);
      }
    }
  }, []);

  // Selected endpoint
  const selected = useMemo(() => ENDPOINTS.find(e => e.id === selectedId) || ENDPOINTS[0], [selectedId]);

  // Filtered endpoints
  const filtered = useMemo(() => searchEndpoints(searchQuery), [searchQuery]);
  const grouped = useMemo(() => {
    const map = new Map<string, EndpointDef[]>();
    for (const cat of CATEGORIES) {
      const eps = filtered.filter(e => e.category === cat.key);
      if (eps.length > 0) map.set(cat.key, eps);
    }
    return map;
  }, [filtered]);

  // Reset form when endpoint changes
  useEffect(() => {
    if (!selected) return;
    setParamValues({});
    setResponse(null);
    setSseEvents([]);
    const bodyParams = selected.params.filter(p => p.location === 'body');
    if (bodyParams.length > 0 && selected.exampleRequest) {
      setBodyText(JSON.stringify(selected.exampleRequest, null, 2));
    } else {
      setBodyText('');
    }
    // Update URL hash
    window.location.hash = `#/api-explorer/${selected.id}`;
  }, [selected]);

  // --- Handlers ---

  const selectEndpoint = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const toggleCategory = useCallback((key: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const buildUrl = useCallback((ep: EndpointDef, values: Record<string, string>) => {
    let url = ep.path;
    // Replace path params
    for (const p of ep.params.filter(p => p.location === 'path')) {
      url = url.replace(`{${p.name}}`, encodeURIComponent(values[p.name] || ''));
    }
    // Add query params
    const queryParams = ep.params.filter(p => p.location === 'query');
    const qs = queryParams
      .map(p => values[p.name] ? `${p.name}=${encodeURIComponent(values[p.name])}` : '')
      .filter(Boolean)
      .join('&');
    if (qs) url += '?' + qs;
    return url;
  }, []);

  const sendRequest = useCallback(async () => {
    if (!selected || isLoading) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setResponse(null);
    setSseEvents([]);

    const url = buildUrl(selected, paramValues);
    const startTime = performance.now();

    try {
      const init: RequestInit = {
        method: selected.method,
        signal: controller.signal,
        headers: {} as Record<string, string>,
      };

      // Body for POST/PUT
      if (['POST', 'PUT'].includes(selected.method) && bodyText.trim()) {
        (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
        init.body = bodyText;
      }

      const res = await fetch(url, init);
      const duration = Math.round(performance.now() - startTime);

      if (selected.responseType === 'sse' && res.body) {
        // SSE streaming
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let currentEvent = '';
        let accumulatedContent = '';
        const events: { event: string; time: string; data: string }[] = [];
        const startMs = Date.now();

        const readLoop = async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('event: ')) {
                currentEvent = line.slice(7).trim();
                continue;
              }
              if (line.startsWith('data: ')) {
                const payload = line.slice(6).trim();
                if (payload === '[DONE]') {
                  events.push({ event: 'done', time: formatMs(Date.now() - startMs), data: '[DONE]' });
                  setSseEvents([...events]);
                  continue;
                }
                const eventName = currentEvent || 'data';
                events.push({ event: eventName, time: formatMs(Date.now() - startMs), data: payload });
                setSseEvents([...events]);

                // Accumulate content for chain piping
                try {
                  const parsed = JSON.parse(payload);
                  const delta = parsed.choices?.[0]?.delta?.content || parsed.content || '';
                  if (delta) accumulatedContent += delta;
                } catch {}

                currentEvent = '';
              }
            }
          }
        };

        await readLoop();
        const finalDuration = Math.round(performance.now() - startTime);
        setResponse({ status: res.status, statusText: res.statusText, data: accumulatedContent || '(SSE stream completed)', duration: finalDuration });
      } else {
        // JSON/text response
        const contentType = res.headers.get('content-type') || '';
        let data: any;
        if (contentType.includes('json')) {
          data = await res.json();
        } else {
          data = await res.text();
        }
        setResponse({ status: res.status, statusText: res.statusText, data, duration });
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setResponse({ status: 0, statusText: 'Error', data: { error: err.message }, duration: Math.round(performance.now() - startTime) });
    } finally {
      setIsLoading(false);
    }
  }, [selected, paramValues, bodyText, isLoading, buildUrl]);

  const stopRequest = useCallback(() => {
    abortRef.current?.abort();
    setIsLoading(false);
  }, []);

  // --- Chain handlers ---

  const addToChain = useCallback(() => {
    if (!selected) return;
    setChainSteps(prev => [...prev, {
      id: `step_${Date.now()}`,
      endpoint: selected,
      bindings: {},
      status: 'pending',
    }]);
    setRightTab('chain');
  }, [selected]);

  const removeChainStep = useCallback((stepId: string) => {
    setChainSteps(prev => prev.filter(s => s.id !== stepId));
  }, []);

  const updateBinding = useCallback((stepId: string, paramName: string, sourceStepId: string, path: string) => {
    setChainSteps(prev => prev.map(s => {
      if (s.id !== stepId) return s;
      return { ...s, bindings: { ...s.bindings, [paramName]: { stepId: sourceStepId, path } } };
    }));
  }, []);

  const runChain = useCallback(async () => {
    if (isChainRunning || chainSteps.length === 0) return;
    setIsChainRunning(true);

    // Reset all steps
    setChainSteps(prev => prev.map(s => ({ ...s, status: 'pending' as const, output: undefined, error: undefined, duration: undefined })));

    const outputs: Record<string, any> = {};

    for (let i = 0; i < chainSteps.length; i++) {
      const step = chainSteps[i];

      // Update status to running
      setChainSteps(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'running' as const } : s));

      try {
        // Resolve bindings
        const resolvedParams: Record<string, string> = {};
        const bodyObj = step.endpoint.exampleRequest ? JSON.parse(JSON.stringify(step.endpoint.exampleRequest)) : {};

        for (const [paramName, binding] of Object.entries(step.bindings) as [string, { stepId: string; path: string }][]) {
          const sourceOutput = outputs[binding.stepId];
          let value: any = sourceOutput;
          if (binding.path && sourceOutput && typeof sourceOutput === 'object') {
            const parts = binding.path.split('.');
            for (const part of parts) {
              value = value?.[part];
            }
          }
          // Check if it's a path/query param or body param
          const paramDef = step.endpoint.params.find(p => p.name === paramName);
          if (paramDef?.location === 'path' || paramDef?.location === 'query') {
            resolvedParams[paramName] = String(value ?? '');
          } else {
            bodyObj[paramName] = value;
          }
        }

        const url = buildUrl(step.endpoint, resolvedParams);
        const startTime = performance.now();

        const init: RequestInit = {
          method: step.endpoint.method,
          headers: {} as Record<string, string>,
        };

        if (['POST', 'PUT'].includes(step.endpoint.method)) {
          (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
          init.body = JSON.stringify(bodyObj);
        }

        const res = await fetch(url, init);
        const duration = Math.round(performance.now() - startTime);

        let data: any;
        if (step.endpoint.responseType === 'sse' && res.body) {
          // For SSE in chain, collect all content
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let accumulated = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const payload = line.slice(6).trim();
              if (payload === '[DONE]') continue;
              try {
                const parsed = JSON.parse(payload);
                const delta = parsed.choices?.[0]?.delta?.content || parsed.content || '';
                if (delta) accumulated += delta;
              } catch {}
            }
          }
          data = accumulated;
        } else {
          const ct = res.headers.get('content-type') || '';
          data = ct.includes('json') ? await res.json() : await res.text();
        }

        outputs[step.id] = data;
        setChainSteps(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'done' as const, output: data, duration } : s));
      } catch (err: any) {
        setChainSteps(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'error' as const, error: err.message } : s));
        break; // Stop chain on error
      }
    }

    setIsChainRunning(false);
  }, [chainSteps, isChainRunning, buildUrl]);

  // --- Render ---

  return (
    <div className="flex h-screen bg-slate-950">
      {/* ===== LEFT PANEL: Category Sidebar ===== */}
      <div className="w-56 shrink-0 border-r border-slate-800 flex flex-col bg-slate-900/50">
        {/* Header */}
        <div className="p-4 border-b border-slate-800">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Zap size={18} className="text-blue-400" />
            API Explorer
          </h2>
          <p className="text-[11px] text-slate-500 mt-1">{ENDPOINTS.length} endpoints</p>
        </div>

        {/* Search */}
        <div className="p-3 border-b border-slate-800">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search endpoints..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-lg text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-blue-500/50"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Category List */}
        <nav className="flex-1 overflow-y-auto py-2">
          {CATEGORIES.map(cat => {
            const eps = grouped.get(cat.key);
            if (!eps) return null;
            const isExpanded = expandedCategories.has(cat.key);
            const IconComp = CATEGORY_ICONS[cat.icon] || FileText;

            return (
              <div key={cat.key}>
                <button
                  onClick={() => toggleCategory(cat.key)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-colors"
                >
                  {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <IconComp size={13} />
                  <span className="flex-1 text-left">{cat.label}</span>
                  <span className="text-[10px] text-slate-600">{eps.length}</span>
                </button>

                {isExpanded && (
                  <div className="ml-3">
                    {eps.map(ep => (
                      <button
                        key={ep.id}
                        onClick={() => selectEndpoint(ep.id)}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-[11px] transition-colors ${
                          ep.id === selectedId
                            ? 'bg-blue-600/10 text-blue-400 border-r-2 border-blue-500'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
                        }`}
                      >
                        <MethodBadge method={ep.method} size="xs" />
                        <span className="truncate flex-1 text-left font-mono">{ep.path.split('/').pop()}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </div>

      {/* ===== MIDDLE PANEL: Endpoint Detail + Try It Out ===== */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {selected && (
          <div className="p-6 max-w-3xl">
            {/* Endpoint Header */}
            <div className="flex items-start gap-3 mb-4">
              <MethodBadge method={selected.method} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <code className="text-sm font-mono text-slate-200 break-all">{selected.path}</code>
                  <CopyBtn text={selected.path} />
                </div>
                <p className="text-sm text-slate-400 mt-1">{selected.summary}</p>
              </div>
              <button
                onClick={addToChain}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-400 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
                title="Add to chain"
              >
                <Plus size={13} />
                Chain
              </button>
            </div>

            {/* Description */}
            <div className="mb-6">
              <p className="text-sm text-slate-300 leading-relaxed">{selected.description}</p>
              {selected.aiNotes && (
                <div className="mt-3 p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg">
                  <p className="text-xs text-amber-400/80"><span className="font-semibold">AI Note:</span> {selected.aiNotes}</p>
                </div>
              )}
            </div>

            {/* SSE Events Documentation */}
            {selected.sseEvents && selected.sseEvents.length > 0 && (
              <div className="mb-6">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">SSE Events</h3>
                <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-800">
                        <th className="text-left px-3 py-2 text-slate-500 font-medium">Event</th>
                        <th className="text-left px-3 py-2 text-slate-500 font-medium">Data Shape</th>
                        <th className="text-left px-3 py-2 text-slate-500 font-medium">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.sseEvents.map((ev, i) => (
                        <tr key={i} className="border-b border-slate-800/50 last:border-0">
                          <td className="px-3 py-1.5"><code className="text-blue-400">{ev.event}</code></td>
                          <td className="px-3 py-1.5 font-mono text-slate-500 text-[10px]">{ev.dataShape || '-'}</td>
                          <td className="px-3 py-1.5 text-slate-400">{ev.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Parameters / Try It Out */}
            <div className="mb-6">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Try It Out</h3>

              {/* Path + Query params */}
              {selected.params.filter(p => p.location !== 'body').length > 0 && (
                <div className="space-y-2 mb-4">
                  {selected.params.filter(p => p.location !== 'body').map(p => (
                    <div key={p.name} className="flex items-center gap-3">
                      <label className="w-28 shrink-0 text-xs text-slate-400 text-right">
                        <span className="font-mono">{p.name}</span>
                        {p.required && <span className="text-red-400 ml-0.5">*</span>}
                        <span className="text-[10px] text-slate-600 ml-1">{p.location}</span>
                      </label>
                      <input
                        type={p.type === 'number' ? 'number' : 'text'}
                        value={paramValues[p.name] || ''}
                        onChange={e => setParamValues(prev => ({ ...prev, [p.name]: e.target.value }))}
                        placeholder={p.default !== undefined ? String(p.default) : p.example !== undefined ? String(p.example) : p.description}
                        className="flex-1 px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500/50 font-mono"
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Body editor */}
              {selected.params.some(p => p.location === 'body') && (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-slate-500">Request Body (JSON)</span>
                    {selected.exampleRequest && (
                      <button
                        onClick={() => setBodyText(JSON.stringify(selected.exampleRequest, null, 2))}
                        className="text-[10px] text-blue-400 hover:text-blue-300"
                      >
                        Reset to example
                      </button>
                    )}
                  </div>
                  <textarea
                    value={bodyText}
                    onChange={e => setBodyText(e.target.value)}
                    rows={Math.min(15, Math.max(4, bodyText.split('\n').length + 1))}
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500/50 resize-y"
                    placeholder='{ "key": "value" }'
                    spellCheck={false}
                  />
                </div>
              )}

              {/* Send Button */}
              <div className="flex items-center gap-3">
                <button
                  onClick={isLoading ? stopRequest : sendRequest}
                  className={`flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg transition-colors ${
                    isLoading
                      ? 'bg-red-600 hover:bg-red-700 text-white'
                      : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }`}
                >
                  {isLoading ? (
                    <>
                      <Square size={14} />
                      Stop
                    </>
                  ) : (
                    <>
                      <Send size={14} />
                      Send Request
                    </>
                  )}
                </button>
                {isLoading && (
                  <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                )}
                {response && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`font-bold ${response.status >= 200 && response.status < 300 ? 'text-emerald-400' : response.status >= 400 ? 'text-red-400' : 'text-amber-400'}`}>
                      {response.status || 'ERR'}
                    </span>
                    <span className="text-slate-500">{response.statusText}</span>
                    <span className="text-slate-600">({response.duration}ms)</span>
                  </div>
                )}
              </div>
            </div>

            {/* Example Response */}
            {selected.exampleResponse && !response && (
              <div className="mb-6">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Example Response</h3>
                <JsonBlock data={selected.exampleResponse} />
              </div>
            )}

            {/* Parameters Documentation */}
            {selected.params.length > 0 && (
              <div className="mb-6">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Parameters</h3>
                <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-800">
                        <th className="text-left px-3 py-2 text-slate-500 font-medium">Name</th>
                        <th className="text-left px-3 py-2 text-slate-500 font-medium">In</th>
                        <th className="text-left px-3 py-2 text-slate-500 font-medium">Type</th>
                        <th className="text-left px-3 py-2 text-slate-500 font-medium">Required</th>
                        <th className="text-left px-3 py-2 text-slate-500 font-medium">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.params.map((p, i) => (
                        <tr key={i} className="border-b border-slate-800/50 last:border-0">
                          <td className="px-3 py-1.5 font-mono text-slate-200">{p.name}</td>
                          <td className="px-3 py-1.5"><span className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-400">{p.location}</span></td>
                          <td className="px-3 py-1.5 text-slate-400">{p.type}</td>
                          <td className="px-3 py-1.5">{p.required ? <span className="text-red-400">Yes</span> : <span className="text-slate-600">No</span>}</td>
                          <td className="px-3 py-1.5 text-slate-400">{p.description}{p.default !== undefined ? <span className="text-slate-600"> (default: {JSON.stringify(p.default)})</span> : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ===== RIGHT PANEL: Response / Chain ===== */}
      <div className="w-80 shrink-0 border-l border-slate-800 flex flex-col bg-slate-900/30">
        {/* Tab Bar */}
        <div className="flex border-b border-slate-800">
          <button
            onClick={() => setRightTab('response')}
            className={`flex-1 px-4 py-2.5 text-xs font-medium transition-colors ${
              rightTab === 'response' ? 'text-blue-400 border-b-2 border-blue-500 bg-blue-500/5' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            Response
          </button>
          <button
            onClick={() => setRightTab('chain')}
            className={`flex-1 px-4 py-2.5 text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
              rightTab === 'chain' ? 'text-blue-400 border-b-2 border-blue-500 bg-blue-500/5' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            Chain
            {chainSteps.length > 0 && (
              <span className="px-1.5 py-0.5 bg-blue-500/20 text-blue-400 text-[10px] rounded-full">{chainSteps.length}</span>
            )}
          </button>
        </div>

        {/* Response Tab */}
        {rightTab === 'response' && (
          <div className="flex-1 overflow-y-auto">
            {/* SSE Events */}
            {sseEvents.length > 0 && (
              <div className="border-b border-slate-800">
                <div className="px-3 py-2 flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">SSE Events ({sseEvents.length})</span>
                  <button onClick={() => setSseEvents([])} className="text-[10px] text-slate-600 hover:text-slate-400">Clear</button>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {sseEvents.map((ev, i) => (
                    <SseEventItem key={i} event={ev.event} time={ev.time} data={ev.data} />
                  ))}
                </div>
              </div>
            )}

            {/* Response Body */}
            {response ? (
              <div className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold ${response.status >= 200 && response.status < 300 ? 'text-emerald-400' : response.status >= 400 ? 'text-red-400' : 'text-amber-400'}`}>
                      {response.status || 'ERR'} {response.statusText}
                    </span>
                    <span className="text-[10px] text-slate-600">{response.duration}ms</span>
                  </div>
                  <CopyBtn text={typeof response.data === 'string' ? response.data : JSON.stringify(response.data, null, 2)} />
                </div>
                {typeof response.data === 'string' ? (
                  <pre className="text-xs font-mono text-slate-300 whitespace-pre-wrap break-all max-h-[calc(100vh-200px)] overflow-auto p-3 bg-slate-950 rounded-lg border border-slate-800">
                    {response.data}
                  </pre>
                ) : (
                  <JsonBlock data={response.data} maxHeight="max-h-[calc(100vh-200px)]" />
                )}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center p-6">
                <p className="text-xs text-slate-600 text-center">Send a request to see the response here</p>
              </div>
            )}
          </div>
        )}

        {/* Chain Tab */}
        {rightTab === 'chain' && (
          <div className="flex-1 overflow-y-auto flex flex-col">
            {chainSteps.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 gap-3">
                <Link2 size={24} className="text-slate-700" />
                <p className="text-xs text-slate-600 text-center">Add endpoints to build a chain.<br/>Each step's output pipes to the next.</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {chainSteps.map((step, idx) => (
                  <div key={step.id} className={`bg-slate-900 border rounded-lg overflow-hidden ${
                    step.status === 'running' ? 'border-blue-500/50' :
                    step.status === 'done' ? 'border-emerald-500/30' :
                    step.status === 'error' ? 'border-red-500/30' :
                    'border-slate-800'
                  }`}>
                    {/* Step Header */}
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800/50">
                      <span className="text-[10px] text-slate-600 font-bold">#{idx + 1}</span>
                      <MethodBadge method={step.endpoint.method} size="xs" />
                      <span className="text-[11px] font-mono text-slate-300 truncate flex-1">{step.endpoint.path.split('/').slice(-2).join('/')}</span>
                      {step.status === 'running' && <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />}
                      {step.status === 'done' && <Check size={12} className="text-emerald-400" />}
                      {step.status === 'error' && <X size={12} className="text-red-400" />}
                      {step.duration !== undefined && <span className="text-[10px] text-slate-600">{step.duration}ms</span>}
                      <button onClick={() => removeChainStep(step.id)} className="text-slate-600 hover:text-red-400 transition-colors">
                        <Trash2 size={12} />
                      </button>
                    </div>

                    {/* Bindings */}
                    {idx > 0 && step.endpoint.params.filter(p => p.location === 'body').length > 0 && (
                      <div className="px-3 py-1.5 border-b border-slate-800/50 space-y-1">
                        {step.endpoint.params.filter(p => p.location === 'body').slice(0, 3).map(p => (
                          <div key={p.name} className="flex items-center gap-2 text-[10px]">
                            <span className="text-slate-500 font-mono w-20 truncate">{p.name}</span>
                            <ArrowRight size={10} className="text-slate-700" />
                            <select
                              value={step.bindings[p.name]?.stepId || ''}
                              onChange={e => updateBinding(step.id, p.name, e.target.value, step.bindings[p.name]?.path || '')}
                              className="flex-1 text-[10px] bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-slate-300"
                            >
                              <option value="">Manual</option>
                              {chainSteps.slice(0, idx).map((prev, pi) => (
                                <option key={prev.id} value={prev.id}>Step #{pi + 1} output</option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Output Preview */}
                    {step.output !== undefined && (
                      <div className="px-3 py-1.5">
                        <pre className="text-[10px] font-mono text-slate-500 whitespace-pre-wrap break-all max-h-16 overflow-hidden">
                          {typeof step.output === 'string' ? step.output.slice(0, 150) : JSON.stringify(step.output, null, 1).slice(0, 150)}
                        </pre>
                      </div>
                    )}
                    {step.error && (
                      <div className="px-3 py-1.5">
                        <p className="text-[10px] text-red-400">{step.error}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Chain Actions */}
            {chainSteps.length > 0 && (
              <div className="p-3 border-t border-slate-800 flex items-center gap-2">
                <button
                  onClick={runChain}
                  disabled={isChainRunning}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium rounded-lg transition-colors ${
                    isChainRunning
                      ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }`}
                >
                  {isChainRunning ? (
                    <>
                      <div className="w-3 h-3 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                      Running...
                    </>
                  ) : (
                    <>
                      <Play size={13} />
                      Run Chain ({chainSteps.length} steps)
                    </>
                  )}
                </button>
                <button
                  onClick={() => setChainSteps([])}
                  className="px-3 py-2 text-xs text-slate-500 hover:text-red-400 bg-slate-800 hover:bg-slate-800/80 rounded-lg transition-colors"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// --- Helpers ---

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default ApiExplorer;
