import React, { useState, useEffect } from 'react';
import {
  Database, Link as LinkIcon, Lock, RefreshCw, TableProperties,
  AlertCircle, CheckCircle2, ChevronRight, Plus, Send,
  CheckSquare, Square, X, Code, FileJson, Download, Loader2, Trash2
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { generateEmbeddings, fetchEmbedModels } from '../services/vllm';
import { addDocuments, getDocumentCount, clearAll } from '../services/kbApi';
import { getDsApiUrl, getDsApiToken, getDsEndpoint, updateSettings } from '../services/settingsApi';

const PRESET_ENDPOINTS = [
  { label: 'Knowledge Bases', value: 'knowledge-bases' },
  { label: 'Services', value: 'services' },
  { label: 'AI Prompts', value: 'ai-prompts' },
  { label: 'Tags', value: 'tags' },
];

const Datasets = () => {
  const navigate = useNavigate();

  // Configuration State
  const [apiUrl, setApiUrl] = useState(getDsApiUrl());
  const [apiToken, setApiToken] = useState(getDsApiToken());
  const [endpoint, setEndpoint] = useState(getDsEndpoint());
  const [isCustomEndpoint, setIsCustomEndpoint] = useState(false);

  // Data State
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const [paginationMeta, setPaginationMeta] = useState<{ total: number; page: number; pageSize: number } | null>(null);

  // Interaction State
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [viewJsonItem, setViewJsonItem] = useState<any | null>(null);

  const [newItemJson, setNewItemJson] = useState('{\n  "data": {\n    "title": "New Article",\n    "content": "Content goes here..."\n  }\n}');
  const [addStatus, setAddStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');

  // Embed & Save state
  const [embedSaving, setEmbedSaving] = useState(false);
  const [embedSuccess, setEmbedSuccess] = useState<string | null>(null);
  const [embedModel, setEmbedModel] = useState('');
  const [kbDocCount, setKbDocCount] = useState(0);

  // Load embed models
  useEffect(() => {
    fetchEmbedModels().then(models => {
      if (models.length > 0) setEmbedModel(models[0]);
    });
  }, []);

  // Poll KB doc count
  useEffect(() => {
    getDocumentCount().then(setKbDocCount);
    const interval = setInterval(() => { getDocumentCount().then(setKbDocCount); }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Check if endpoint is custom
  useEffect(() => {
    setIsCustomEndpoint(!PRESET_ENDPOINTS.some(p => p.value === endpoint));
  }, [endpoint]);

  const saveConfig = () => {
    updateSettings({ ds_api_url: apiUrl, ds_api_token: apiToken, ds_endpoint: endpoint });
  };

  const getFullUrl = () => {
    const baseUrl = apiUrl.replace(/\/$/, '');
    const path = endpoint.replace(/^\//, '');
    return `${baseUrl}/${path}`;
  };

  const getHeaders = () => {
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (apiToken) headers['Authorization'] = `Bearer ${apiToken}`;
    return headers;
  };

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    setSelectedIds(new Set());
    setPaginationMeta(null);
    saveConfig();

    try {
      const url = `${getFullUrl()}?pagination[pageSize]=1000`;
      const response = await fetch(url, { method: 'GET', headers: getHeaders() });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const jsonData = await response.json();

      // Extract pagination meta if available (Strapi v4)
      if (jsonData.meta?.pagination) {
        setPaginationMeta({
          total: jsonData.meta.pagination.total,
          page: jsonData.meta.pagination.page,
          pageSize: jsonData.meta.pagination.pageSize,
        });
      }

      // Strapi v4 Intelligence: Automatically unwrap { data: [ { id, attributes: {} } ] }
      let processedData = [];

      if (jsonData.data && Array.isArray(jsonData.data)) {
        processedData = jsonData.data.map((item: any) => {
          if (item.attributes) {
            return { id: item.id, ...item.attributes, _raw: item };
          }
          return { ...item, id: item.id || Math.random().toString(36).substr(2, 9) };
        });
      } else if (Array.isArray(jsonData)) {
        processedData = jsonData.map(item => ({...item, id: item.id || Math.random().toString(36).substr(2, 9)}));
      } else if (typeof jsonData === 'object') {
        processedData = [{ ...jsonData, id: jsonData.id || '1' }];
      }

      setData(processedData);
      setLastFetched(new Date().toLocaleTimeString());
    } catch (err: any) {
      setError(err.message || 'Failed to fetch data');
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAddItem = async () => {
    setAddStatus('sending');
    try {
      const payload = JSON.parse(newItemJson);

      const response = await fetch(getFullUrl(), {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed: ${response.status} - ${errText.substring(0, 100)}`);
      }

      setAddStatus('success');
      setTimeout(() => {
        setAddStatus('idle');
        setIsAddModalOpen(false);
        fetchData();
      }, 1000);
    } catch (e: any) {
      alert(`Error adding item: ${e.message}`);
      setAddStatus('error');
    }
  };

  const toggleSelect = (id: string | number) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === data.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(data.map(d => d.id)));
    }
  };

  const handleSendToEmbeddings = () => {
    const selectedItems = data.filter(d => selectedIds.has(d.id));
    const textContent = selectedItems.map(extractTextFromItem).join('\n\n');
    navigate('/embeddings', { state: { initialInput: textContent } });
  };

  const handleDownloadJson = () => {
    const items = selectedIds.size > 0
      ? data.filter(d => selectedIds.has(d.id))
      : data;
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dataset_${endpoint}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const extractTextFromItem = (item: any): string => {
    const skipKeys = new Set([
      'id', '_raw', 'created_at', 'updated_at', 'createdAt', 'updatedAt',
      'publishedAt', 'documentId', 'locale',
    ]);

    const parts: string[] = [];
    for (const [key, value] of Object.entries(item)) {
      if (skipKeys.has(key)) continue;
      if (value === null || value === undefined) continue;
      if (typeof value === 'object') continue;
      const str = String(value).trim();
      if (str) parts.push(`${key}: ${str}`);
    }

    return parts.length > 0 ? parts.join('\n') : JSON.stringify(item);
  };

  const handleEmbedAndSave = async () => {
    if (!embedModel) {
      setError('No embedding model available. Check Settings.');
      return;
    }

    const items = selectedIds.size > 0
      ? data.filter(d => selectedIds.has(d.id))
      : data;

    if (items.length === 0) {
      setError('No data to embed. Fetch data first.');
      return;
    }

    setEmbedSaving(true);
    setEmbedSuccess(null);
    setError(null);

    try {
      const texts = items.map(extractTextFromItem);

      // Batch in groups of 32 to avoid overloading
      const batchSize = 32;
      let totalSaved = 0;
      let totalSent = 0;

      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const response = await generateEmbeddings(embedModel, batch);

        const docs = response.data.map((d, idx) => ({
          text: batch[idx],
          embedding: d.embedding,
          source: 'dataset' as const,
          sourceLabel: `${endpoint} #${items[i + idx]?.id || idx}`,
        }));

        const inserted = await addDocuments(docs, embedModel);
        totalSaved += inserted;
        totalSent += docs.length;
      }

      setKbDocCount(await getDocumentCount());
      const skipped = totalSent - totalSaved;
      const msg = skipped > 0
        ? `Saved ${totalSaved} documents (${skipped} duplicates skipped)`
        : `Saved ${totalSaved} documents to Knowledge Base!`;
      setEmbedSuccess(msg);
      setTimeout(() => setEmbedSuccess(null), 4000);
    } catch (err: any) {
      setError(`Embed failed: ${err.message}`);
    } finally {
      setEmbedSaving(false);
    }
  };

  const handleClearKB = async () => {
    await clearAll();
    setKbDocCount(0);
  };

  // Get table headers dynamically from the first item
  const getTableHeaders = () => {
    if (data.length === 0) return [];
    return Object.keys(data[0]).filter(key => {
      const val = data[0][key];
      return key !== '_raw' && (typeof val !== 'object' || val === null);
    }).slice(0, 5);
  };

  return (
    <div className="h-screen bg-slate-950 flex overflow-hidden relative">

      {/* Add Item Modal */}
      {isAddModalOpen && (
        <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-8">
           <div className="bg-slate-900 border border-slate-700 w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col max-h-full animate-in fade-in zoom-in duration-200">
              <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-800/50">
                <div>
                   <h3 className="text-xl font-bold text-white">Add New Record</h3>
                   <p className="text-slate-400 text-xs mt-1">POST to <code className="bg-slate-800 px-1 py-0.5 rounded text-blue-400">{getFullUrl()}</code></p>
                </div>
                <button onClick={() => setIsAddModalOpen(false)} className="text-slate-400 hover:text-white transition-colors"><X size={24}/></button>
              </div>
              <div className="p-6 flex-1 overflow-y-auto">
                 <label className="block text-sm font-medium text-slate-300 mb-2">JSON Payload</label>
                 <div className="relative h-64">
                   <textarea
                     value={newItemJson}
                     onChange={(e) => setNewItemJson(e.target.value)}
                     className="w-full h-full bg-slate-950 border border-slate-700 rounded-xl p-4 text-sm font-mono text-emerald-400 focus:ring-2 focus:ring-blue-500 outline-none resize-none leading-relaxed"
                   />
                   <div className="absolute top-2 right-2 text-xs bg-slate-800 text-slate-400 px-2 py-1 rounded border border-slate-700 pointer-events-none">
                     JSON
                   </div>
                 </div>
                 <p className="text-xs text-slate-500 mt-2">
                   * For Strapi v4, ensure you wrap attributes in a <code>"data"</code> object.
                 </p>
              </div>
              <div className="p-6 border-t border-slate-800 flex justify-end gap-3 bg-slate-800/50 rounded-b-2xl">
                 <button onClick={() => setIsAddModalOpen(false)} className="px-4 py-2 text-slate-300 hover:text-white transition-colors">Cancel</button>
                 <button
                   onClick={handleAddItem}
                   disabled={addStatus === 'sending'}
                   className={`px-6 py-2 rounded-lg font-bold flex items-center gap-2 transition-all ${
                     addStatus === 'success' ? 'bg-emerald-600 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white'
                   }`}
                 >
                   {addStatus === 'sending' ? <RefreshCw className="animate-spin" size={18} /> :
                    addStatus === 'success' ? <CheckCircle2 size={18} /> : <Plus size={18} />}
                   {addStatus === 'sending' ? 'Sending...' : addStatus === 'success' ? 'Added!' : 'Add Record'}
                 </button>
              </div>
           </div>
        </div>
      )}

      {/* View JSON Modal */}
      {viewJsonItem && (
        <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-8">
           <div className="bg-slate-900 border border-slate-700 w-full max-w-3xl rounded-2xl shadow-2xl flex flex-col max-h-[80vh] animate-in fade-in zoom-in duration-200">
              <div className="p-5 border-b border-slate-800 flex justify-between items-center bg-slate-800/50">
                <div className="flex items-center gap-2">
                   <FileJson size={20} className="text-blue-400" />
                   <h3 className="text-lg font-bold text-white">Raw Object Data</h3>
                </div>
                <button onClick={() => setViewJsonItem(null)} className="text-slate-400 hover:text-white transition-colors"><X size={20}/></button>
              </div>
              <div className="flex-1 overflow-auto bg-[#0B1120] p-0 relative">
                 <pre className="text-sm font-mono text-blue-300 p-6 leading-relaxed">
                   {JSON.stringify(viewJsonItem, null, 2)}
                 </pre>
                 <button
                    onClick={() => {
                        navigator.clipboard.writeText(JSON.stringify(viewJsonItem, null, 2));
                    }}
                    className="absolute top-4 right-4 p-2 bg-slate-800 text-slate-400 hover:text-white rounded border border-slate-700 transition-colors"
                    title="Copy to Clipboard"
                 >
                    <Code size={16} />
                 </button>
              </div>
           </div>
        </div>
      )}

      {/* Left Panel: Configuration */}
      <div className="w-[340px] border-r border-slate-800 flex flex-col bg-slate-900/30">
        <div className="p-6 border-b border-slate-800">
           <h1 className="text-xl font-bold text-white mb-1">Dataset Connect</h1>
           <p className="text-slate-400 text-xs">Connect to external CMS or APIs.</p>
        </div>

        <div className="p-6 flex-1 flex flex-col gap-6 overflow-y-auto">
           <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Configuration</label>
                <div className="space-y-3">
                   <div>
                      <label className="text-xs text-slate-400 block mb-1">API Base URL</label>
                      <input
                        type="text"
                        value={apiUrl}
                        onChange={(e) => setApiUrl(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-xs text-white focus:border-blue-500 outline-none font-mono"
                      />
                   </div>
                   <div>
                      <label className="text-xs text-slate-400 block mb-1">Endpoint</label>
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {PRESET_ENDPOINTS.map(p => (
                          <button
                            key={p.value}
                            onClick={() => { setEndpoint(p.value); setIsCustomEndpoint(false); }}
                            className={`px-2 py-1 text-[10px] font-bold rounded transition-colors ${
                              endpoint === p.value
                                ? 'bg-blue-600 text-white'
                                : 'bg-slate-800 text-slate-400 hover:text-white border border-slate-700'
                            }`}
                          >
                            {p.label}
                          </button>
                        ))}
                        <button
                          onClick={() => { setIsCustomEndpoint(true); setEndpoint(''); }}
                          className={`px-2 py-1 text-[10px] font-bold rounded transition-colors ${
                            isCustomEndpoint
                              ? 'bg-blue-600 text-white'
                              : 'bg-slate-800 text-slate-400 hover:text-white border border-slate-700'
                          }`}
                        >
                          Custom...
                        </button>
                      </div>
                      {isCustomEndpoint && (
                        <input
                          type="text"
                          value={endpoint}
                          onChange={(e) => setEndpoint(e.target.value)}
                          placeholder="e.g. articles"
                          className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-xs text-white focus:border-blue-500 outline-none font-mono"
                        />
                      )}
                   </div>
                   <div>
                      <label className="text-xs text-slate-400 block mb-1">Bearer Token</label>
                      <input
                        type="password"
                        value={apiToken}
                        onChange={(e) => setApiToken(e.target.value)}
                        placeholder="Optional (public APIs)"
                        className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-xs text-white focus:border-blue-500 outline-none font-mono"
                      />
                   </div>
                </div>
              </div>
           </div>

           <div className="mt-auto pt-4 border-t border-slate-800 space-y-3">
             {error && (
                <div className="p-2 bg-red-900/20 border border-red-900/50 rounded text-red-200 text-xs flex items-start gap-2 break-all">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  {error}
                </div>
             )}

             {embedSuccess && (
                <div className="p-2 bg-emerald-900/20 border border-emerald-900/50 rounded text-emerald-200 text-xs flex items-center gap-2">
                  <CheckCircle2 size={14} className="shrink-0" />
                  {embedSuccess}
                </div>
             )}

             <button
               onClick={fetchData}
               disabled={loading}
               className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-all border border-slate-700"
             >
               <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
               Sync Data
             </button>

             {/* KB Status */}
             <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-800">
               <span className="flex items-center gap-1.5">
                 <Database size={12} className={kbDocCount > 0 ? 'text-amber-400' : 'text-slate-600'} />
                 Knowledge Base: {kbDocCount} docs
               </span>
               {kbDocCount > 0 && (
                 <button
                   onClick={handleClearKB}
                   className="text-red-400/70 hover:text-red-400 flex items-center gap-1 transition-colors"
                 >
                   <Trash2 size={10} /> Clear
                 </button>
               )}
             </div>
           </div>
        </div>
      </div>

      {/* Right Panel: Data Explorer */}
      <div className="flex-1 bg-slate-950 flex flex-col min-w-0">

        {/* Toolbar */}
        <div className="h-16 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-900/20 backdrop-blur-sm sticky top-0 z-10">
           <div className="flex items-center gap-4">
             <div className="flex items-center gap-2 text-slate-200 font-bold">
               <Database size={18} className="text-blue-500" />
               Object Explorer
             </div>
             <div className="h-4 w-px bg-slate-800"></div>
             <span className="text-xs text-slate-500">
               {paginationMeta
                 ? `Showing ${data.length} of ${paginationMeta.total} records`
                 : `${data.length} records loaded`}
             </span>
             {selectedIds.size > 0 && (
               <span className="text-xs font-bold text-blue-400 bg-blue-900/20 px-2 py-0.5 rounded border border-blue-900/30 animate-in fade-in">
                 {selectedIds.size} selected
               </span>
             )}
           </div>

           <div className="flex items-center gap-2">
             <button
                onClick={handleDownloadJson}
                disabled={data.length === 0}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-slate-700"
                title={selectedIds.size > 0 ? `Download ${selectedIds.size} selected` : 'Download all'}
             >
               <Download size={13} /> JSON
             </button>
             <button
                onClick={handleEmbedAndSave}
                disabled={data.length === 0 || embedSaving || !embedModel}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold text-white bg-amber-600 rounded-lg hover:bg-amber-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-amber-900/20"
                title={selectedIds.size > 0 ? `Embed ${selectedIds.size} selected → KB` : 'Embed all → KB'}
             >
               {embedSaving ? <Loader2 size={13} className="animate-spin" /> : <Database size={13} />}
               {embedSaving ? 'Embedding...' : 'Embed & Save to KB'}
             </button>
             <button
                onClick={handleSendToEmbeddings}
                disabled={selectedIds.size === 0}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-indigo-900/20"
             >
               <Send size={13} /> Embeddings
             </button>
             <button
                onClick={() => setIsAddModalOpen(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold text-slate-900 bg-white rounded-lg hover:bg-slate-200 transition-colors shadow-lg shadow-white/10"
             >
               <Plus size={13} /> Add
             </button>
           </div>
        </div>

        {/* Content Table */}
        <div className="flex-1 overflow-auto p-0">

          {data.length > 0 ? (
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-900 text-slate-400 font-medium uppercase text-xs border-b border-slate-800 sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="px-6 py-3 w-10 text-center">
                    <button onClick={toggleSelectAll} className="hover:text-white transition-colors">
                      {selectedIds.size > 0 && selectedIds.size === data.length ? <CheckSquare size={16} /> : <Square size={16} />}
                    </button>
                  </th>
                  {getTableHeaders().map(header => (
                    <th key={header} className="px-6 py-3">{header}</th>
                  ))}
                  <th className="px-6 py-3 text-right">Raw</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {data.map((row) => (
                  <tr
                    key={row.id}
                    className={`transition-colors group ${selectedIds.has(row.id) ? 'bg-blue-900/10 hover:bg-blue-900/20' : 'hover:bg-slate-800/30'}`}
                    onClick={(e) => {
                        if ((e.target as HTMLElement).tagName !== 'BUTTON') {
                           toggleSelect(row.id);
                        }
                    }}
                  >
                    <td className="px-6 py-4 text-center cursor-pointer">
                       <div className={`transition-colors ${selectedIds.has(row.id) ? 'text-blue-400' : 'text-slate-600 group-hover:text-slate-400'}`}>
                         {selectedIds.has(row.id) ? <CheckSquare size={16} /> : <Square size={16} />}
                       </div>
                    </td>
                    {getTableHeaders().map(header => (
                      <td key={`${row.id}-${header}`} className="px-6 py-4 text-slate-300 font-mono text-xs max-w-[200px] overflow-hidden text-ellipsis">
                         {String(row[header])}
                      </td>
                    ))}
                    <td className="px-6 py-4 text-right">
                       <button
                         onClick={(e) => {
                             e.stopPropagation();
                             setViewJsonItem(row);
                         }}
                         className="p-1.5 text-slate-500 hover:text-white hover:bg-slate-700 rounded transition-colors"
                         title="View JSON"
                       >
                         <Code size={14} />
                       </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-600">
                <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center mb-4 border border-slate-800">
                   <Database size={32} className="opacity-50" />
                </div>
                <p className="text-sm font-medium text-slate-400">Ready to Connect</p>
                <p className="text-xs mt-2 text-slate-500 max-w-xs text-center leading-relaxed">
                  Select a preset endpoint (e.g., Knowledge Bases) and click Sync. <br/>
                  Default URL connects to strapi.sipsy.ai via proxy.
                </p>
            </div>
          )}

        </div>
      </div>

    </div>
  );
};

export default Datasets;
