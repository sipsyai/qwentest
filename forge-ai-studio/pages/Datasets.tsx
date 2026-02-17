import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Database, Plus, Pencil, Trash2, RefreshCw, ChevronRight, ChevronDown,
  AlertCircle, CheckCircle2, Globe, Lock, Send, Save, X, Loader2,
  CheckSquare, Square, ArrowLeft, Braces, List, Settings, Download,
  FileJson, Clipboard
} from 'lucide-react';
import {
  getDatasets, createDataset, updateDataset, deleteDataset,
  fetchDatasetUrl, saveDatasetRecords,
  Dataset, DatasetCreate, DatasetUpdate
} from '../services/datasetsApi';

// --- Header Key-Value Pair ---
interface HeaderPair {
  key: string;
  value: string;
}

// --- Field Extraction Utilities ---

function flattenFieldPaths(items: any[], maxSample = 20): string[] {
  const paths = new Set<string>();
  const sample = items.slice(0, maxSample);
  const walk = (obj: any, prefix: string) => {
    if (obj === null || obj === undefined || typeof obj !== 'object' || Array.isArray(obj)) return;
    for (const key of Object.keys(obj)) {
      const fullPath = prefix ? `${prefix}.${key}` : key;
      const val = obj[key];
      if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
        walk(val, fullPath);
      } else {
        paths.add(fullPath);
      }
    }
  };
  sample.forEach(item => walk(item, ''));
  return Array.from(paths).sort();
}

function getNestedValue(obj: any, path: string): any {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
}

function buildFieldKeys(fields: string[]): Record<string, string> {
  const leafCount: Record<string, number> = {};
  for (const f of fields) {
    const leaf = f.includes('.') ? f.split('.').pop()! : f;
    leafCount[leaf] = (leafCount[leaf] || 0) + 1;
  }
  const result: Record<string, string> = {};
  for (const f of fields) {
    const leaf = f.includes('.') ? f.split('.').pop()! : f;
    result[f] = leafCount[leaf] > 1 ? f : leaf;
  }
  return result;
}

function extractFromItem(item: any, fields: string[], fieldKeys: Record<string, string>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const f of fields) {
    out[fieldKeys[f]] = getNestedValue(item, f);
  }
  return out;
}

const Datasets = () => {
  // Dataset list
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<Dataset | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingDataset, setEditingDataset] = useState<Dataset | null>(null);

  // Source type picker
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [formMode, setFormMode] = useState<'api' | 'manual'>('api');

  // Form fields
  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formMethod, setFormMethod] = useState('GET');
  const [formToken, setFormToken] = useState('');
  const [formHeaders, setFormHeaders] = useState<HeaderPair[]>([]);
  const [formRawJson, setFormRawJson] = useState('');
  const [formJsonError, setFormJsonError] = useState<string | null>(null);
  const [formSaving, setFormSaving] = useState(false);

  // Explorer state
  const [fetchedJson, setFetchedJson] = useState<any>(null);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchElapsed, setFetchElapsed] = useState<number | null>(null);
  const [jsonPath, setJsonPath] = useState<string[]>([]);
  const [selectedRowIndices, setSelectedRowIndices] = useState<Set<number>>(new Set());
  const [savingRecords, setSavingRecords] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  // Field extraction state
  const [showFieldConfig, setShowFieldConfig] = useState(false);
  const [fieldCandidates, setFieldCandidates] = useState<string[]>([]);
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());
  const [extracting, setExtracting] = useState(false);

  // Load datasets on mount
  useEffect(() => {
    loadDatasets();
  }, []);

  const loadDatasets = async () => {
    try {
      const result = await getDatasets();
      setDatasets(result.data);
    } catch (err: any) {
      console.error('Failed to load datasets:', err);
    }
  };

  // --- Form Handlers ---

  const resetForm = () => {
    setFormName('');
    setFormUrl('');
    setFormMethod('GET');
    setFormToken('');
    setFormHeaders([]);
    setFormRawJson('');
    setFormJsonError(null);
    setEditingDataset(null);
    setShowForm(false);
    setShowSourcePicker(false);
  };

  const openCreateForm = () => {
    resetForm();
    setShowSourcePicker(true);
  };

  const pickSource = (mode: 'api' | 'manual') => {
    setFormMode(mode);
    setShowSourcePicker(false);
    setShowForm(true);
  };

  const openEditForm = (ds: Dataset) => {
    setEditingDataset(ds);
    const isManual = ds.method === 'MANUAL';
    setFormMode(isManual ? 'manual' : 'api');
    setFormName(ds.name);
    setFormUrl(ds.url);
    setFormMethod(ds.method);
    setFormToken(ds.token);
    setFormHeaders(
      Object.entries(ds.headers || {}).map(([key, value]) => ({ key, value }))
    );
    setFormRawJson(isManual && ds.raw_data ? JSON.stringify(ds.raw_data, null, 2) : '');
    setFormJsonError(null);
    setShowSourcePicker(false);
    setShowForm(true);
  };

  const handleSaveDataset = async () => {
    if (!formName.trim()) return;
    if (formMode === 'api' && !formUrl.trim()) return;

    // Validate JSON for manual mode
    let parsedJson: any = null;
    if (formMode === 'manual') {
      if (!formRawJson.trim()) { setFormJsonError('JSON cannot be empty'); return; }
      try {
        parsedJson = JSON.parse(formRawJson);
        setFormJsonError(null);
      } catch (e: any) {
        setFormJsonError(`Invalid JSON: ${e.message}`);
        return;
      }
    }

    setFormSaving(true);

    const headersObj: Record<string, string> = {};
    formHeaders.forEach(h => {
      if (h.key.trim()) headersObj[h.key.trim()] = h.value;
    });

    try {
      if (editingDataset) {
        const updates: DatasetUpdate = formMode === 'manual'
          ? { name: formName.trim(), raw_data: parsedJson }
          : { name: formName.trim(), url: formUrl.trim(), method: formMethod, token: formToken, headers: headersObj };
        const updated = await updateDataset(editingDataset.id, updates);
        setDatasets(prev => prev.map(d => d.id === updated.id ? updated : d));
        if (selectedDataset?.id === updated.id) setSelectedDataset(updated);
      } else {
        const payload: DatasetCreate = formMode === 'manual'
          ? { name: formName.trim(), url: '', method: 'MANUAL', raw_data: parsedJson }
          : { name: formName.trim(), url: formUrl.trim(), method: formMethod, token: formToken, headers: headersObj };
        const created = await createDataset(payload);
        setDatasets(prev => [created, ...prev]);
      }
      resetForm();
    } catch (err: any) {
      console.error('Save dataset failed:', err);
    } finally {
      setFormSaving(false);
    }
  };

  const handleDeleteDataset = async (ds: Dataset) => {
    try {
      await deleteDataset(ds.id);
      setDatasets(prev => prev.filter(d => d.id !== ds.id));
      if (selectedDataset?.id === ds.id) {
        setSelectedDataset(null);
        setFetchedJson(null);
        setJsonPath([]);
      }
    } catch (err: any) {
      console.error('Delete dataset failed:', err);
    }
  };

  // --- Fetch & Explore ---

  const handleFetch = async (ds: Dataset) => {
    setSelectedDataset(ds);
    setFetchedJson(null);
    setFetchError(null);
    setFetchElapsed(null);
    setJsonPath([]);
    setSelectedRowIndices(new Set());
    setShowFieldConfig(false);
    setFieldCandidates([]);
    setSelectedFields(new Set(ds.extract_fields || []));

    // Manual datasets: load raw_data directly
    if (ds.method === 'MANUAL') {
      if (ds.raw_data !== null && ds.raw_data !== undefined) {
        setFetchedJson(ds.raw_data);
        if (ds.array_path) setJsonPath(ds.array_path.split('.'));
      } else {
        setFetchError('No data stored. Edit dataset to paste JSON.');
      }
      return;
    }

    setFetchLoading(true);
    try {
      const result = await fetchDatasetUrl(ds.id);
      setFetchedJson(result.data);
      setFetchElapsed(result.elapsed_ms);

      // Auto-navigate to saved array_path
      if (ds.array_path) {
        setJsonPath(ds.array_path.split('.'));
      }
    } catch (err: any) {
      setFetchError(err.message || 'Fetch failed');
    } finally {
      setFetchLoading(false);
    }
  };

  // Drill-down logic
  const currentNode = useMemo(() => {
    if (fetchedJson === null || fetchedJson === undefined) return null;
    let node = fetchedJson;
    for (const key of jsonPath) {
      if (node === null || node === undefined) return null;
      node = node[key];
    }
    return node;
  }, [fetchedJson, jsonPath]);

  const drillInto = useCallback((key: string) => {
    setJsonPath(prev => [...prev, key]);
    setSelectedRowIndices(new Set());
  }, []);

  const navigateTo = useCallback((depth: number) => {
    setJsonPath(prev => prev.slice(0, depth));
    setSelectedRowIndices(new Set());
  }, []);

  // Determine node type
  const nodeType = useMemo(() => {
    if (currentNode === null || currentNode === undefined) return 'empty';
    if (Array.isArray(currentNode)) {
      if (currentNode.length > 0 && typeof currentNode[0] === 'object' && currentNode[0] !== null) {
        return 'array_of_objects';
      }
      return 'array_of_primitives';
    }
    if (typeof currentNode === 'object') return 'object';
    return 'primitive';
  }, [currentNode]);

  // Table columns for array of objects
  const tableColumns = useMemo(() => {
    if (nodeType !== 'array_of_objects' || !Array.isArray(currentNode)) return [];
    const allKeys = new Set<string>();
    currentNode.slice(0, 20).forEach((item: any) => {
      if (item && typeof item === 'object') {
        Object.keys(item).forEach(k => allKeys.add(k));
      }
    });
    return Array.from(allKeys);
  }, [currentNode, nodeType]);

  // Row selection
  const toggleRowSelect = (idx: number) => {
    setSelectedRowIndices(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (!Array.isArray(currentNode)) return;
    if (selectedRowIndices.size === currentNode.length) {
      setSelectedRowIndices(new Set());
    } else {
      setSelectedRowIndices(new Set(currentNode.map((_: any, i: number) => i)));
    }
  };

  // Save selected records
  const handleSaveSelected = async () => {
    if (!selectedDataset || !Array.isArray(currentNode) || selectedRowIndices.size === 0) return;

    setSavingRecords(true);
    setSaveSuccess(null);

    try {
      const pathStr = '$' + (jsonPath.length > 0 ? '.' + jsonPath.join('.') : '');
      const records = Array.from(selectedRowIndices).map((idx: number) => ({
        dataset_id: selectedDataset.id,
        data: (currentNode as any[])[idx],
        json_path: `${pathStr}[${idx}]`,
        label: `${selectedDataset.name} - Row ${idx}`,
      }));

      const count = await saveDatasetRecords(records);
      setSaveSuccess(`Saved ${count} records`);
      setSelectedRowIndices(new Set());
      setTimeout(() => setSaveSuccess(null), 3000);
    } catch (err: any) {
      setFetchError(`Save failed: ${err.message}`);
    } finally {
      setSavingRecords(false);
    }
  };

  // --- Field Extraction Handlers ---

  // Compute field candidates when we're in array_of_objects view
  useEffect(() => {
    if (nodeType === 'array_of_objects' && Array.isArray(currentNode) && currentNode.length > 0) {
      const candidates = flattenFieldPaths(currentNode);
      setFieldCandidates(candidates);
    } else {
      setFieldCandidates([]);
    }
  }, [currentNode, nodeType]);

  const toggleField = (field: string) => {
    setSelectedFields(prev => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field); else next.add(field);
      return next;
    });
  };

  const selectedFieldsArr = useMemo((): string[] => [...selectedFields], [selectedFields]);
  const fieldKeys = useMemo(() => buildFieldKeys(selectedFieldsArr), [selectedFieldsArr]);

  const extractionPreview = useMemo(() => {
    if (!Array.isArray(currentNode) || currentNode.length === 0 || selectedFields.size === 0) return null;
    return extractFromItem(currentNode[0], selectedFieldsArr, fieldKeys);
  }, [currentNode, selectedFields, fieldKeys]);

  const handleSaveFieldConfig = async () => {
    if (!selectedDataset) return;
    const arrayPath = jsonPath.join('.');
    const fields: string[] = [...selectedFields];
    try {
      const updated = await updateDataset(selectedDataset.id, {
        array_path: arrayPath,
        extract_fields: fields,
      });
      setDatasets(prev => prev.map(d => d.id === updated.id ? updated : d));
      setSelectedDataset(updated);
      setShowFieldConfig(false);
      setSaveSuccess('Field config saved');
      setTimeout(() => setSaveSuccess(null), 3000);
    } catch (err: any) {
      setFetchError(`Save config failed: ${err.message}`);
    }
  };

  const handleExtractAndSaveAll = async () => {
    if (!selectedDataset || !Array.isArray(currentNode) || selectedFields.size === 0) return;
    setExtracting(true);
    setSaveSuccess(null);

    try {
      const fields: string[] = [...selectedFields];
      const fk = buildFieldKeys(fields);
      const pathStr = '$' + (jsonPath.length > 0 ? '.' + jsonPath.join('.') : '');

      const records = currentNode.map((item: any, idx: number) => {
        const extracted = extractFromItem(item, fields, fk);
        const firstVal = extracted[fk[fields[0]]];
        return {
          dataset_id: selectedDataset.id,
          data: extracted,
          json_path: `${pathStr}[${idx}]`,
          label: firstVal != null ? String(firstVal) : `Row ${idx}`,
        };
      });

      // Bulk save in batches of 200
      let totalSaved = 0;
      for (let i = 0; i < records.length; i += 200) {
        const batch = records.slice(i, i + 200);
        const count = await saveDatasetRecords(batch);
        totalSaved += count;
      }

      setSaveSuccess(`Extracted & saved ${totalSaved} records`);
      setTimeout(() => setSaveSuccess(null), 5000);
    } catch (err: any) {
      setFetchError(`Extract failed: ${err.message}`);
    } finally {
      setExtracting(false);
    }
  };

  // --- Render Helpers ---

  const renderValue = (val: any): string => {
    if (val === null) return 'null';
    if (val === undefined) return 'undefined';
    if (typeof val === 'object') return Array.isArray(val) ? `Array[${val.length}]` : `Object{${Object.keys(val).length}}`;
    return String(val);
  };

  const isNavigable = (val: any): boolean => {
    return val !== null && val !== undefined && typeof val === 'object';
  };

  return (
    <div className="h-screen bg-slate-950 flex overflow-hidden">

      {/* LEFT PANEL: Dataset List + Form */}
      <div className="w-[340px] border-r border-slate-800 flex flex-col bg-slate-900/30">

        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white mb-1">Datasets</h1>
            <p className="text-slate-400 text-xs">API or manual JSON</p>
          </div>
          <div className="relative">
            <button
              onClick={openCreateForm}
              className="p-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
              title="Add Dataset"
            >
              <Plus size={18} />
            </button>

            {/* Source Type Picker Dropdown */}
            {showSourcePicker && (
              <div className="absolute right-0 top-full mt-2 w-52 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
                <button
                  onClick={() => pickSource('api')}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-700/50 transition-colors"
                >
                  <div className="p-1.5 bg-blue-900/30 rounded-lg">
                    <Globe size={16} className="text-blue-400" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">API Endpoint</p>
                    <p className="text-[10px] text-slate-400">Fetch from REST API</p>
                  </div>
                </button>
                <div className="h-px bg-slate-700" />
                <button
                  onClick={() => pickSource('manual')}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-700/50 transition-colors"
                >
                  <div className="p-1.5 bg-purple-900/30 rounded-lg">
                    <FileJson size={16} className="text-purple-400" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">Manual JSON</p>
                    <p className="text-[10px] text-slate-400">Paste JSON directly</p>
                  </div>
                </button>
                <div className="h-px bg-slate-700" />
                <button
                  onClick={() => setShowSourcePicker(false)}
                  className="w-full px-4 py-2 text-center text-xs text-slate-500 hover:text-white transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Dataset Form (inline) */}
        {showForm && (
          <div className="p-4 border-b border-slate-800 bg-slate-800/30 space-y-3">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-400 uppercase">
                  {editingDataset ? 'Edit' : 'New'}
                </span>
                <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded ${
                  formMode === 'manual'
                    ? 'bg-purple-900/30 text-purple-400'
                    : 'bg-blue-900/30 text-blue-400'
                }`}>
                  {formMode === 'manual' ? 'MANUAL' : 'API'}
                </span>
              </div>
              <button onClick={resetForm} className="text-slate-500 hover:text-white transition-colors">
                <X size={16} />
              </button>
            </div>

            <input
              type="text"
              placeholder="Dataset Name"
              value={formName}
              onChange={e => setFormName(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-xs text-white focus:border-blue-500 outline-none"
            />

            {formMode === 'api' ? (
              <>
                <input
                  type="text"
                  placeholder="https://api.example.com/data"
                  value={formUrl}
                  onChange={e => setFormUrl(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-xs text-white focus:border-blue-500 outline-none font-mono"
                />

                <div className="flex gap-2">
                  {['GET', 'POST'].map(m => (
                    <button
                      key={m}
                      onClick={() => setFormMethod(m)}
                      className={`px-3 py-1.5 text-xs font-bold rounded transition-colors ${
                        formMethod === m
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-800 text-slate-400 hover:text-white border border-slate-700'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>

                <input
                  type="password"
                  placeholder="Bearer Token (optional)"
                  value={formToken}
                  onChange={e => setFormToken(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-xs text-white focus:border-blue-500 outline-none font-mono"
                />

                {/* Headers */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold text-slate-500 uppercase">Headers</span>
                    <button
                      onClick={() => setFormHeaders(prev => [...prev, { key: '', value: '' }])}
                      className="text-[10px] text-blue-400 hover:text-blue-300"
                    >
                      + Add
                    </button>
                  </div>
                  {formHeaders.map((h, i) => (
                    <div key={i} className="flex gap-1 mb-1">
                      <input
                        type="text"
                        placeholder="Key"
                        value={h.key}
                        onChange={e => {
                          const copy = [...formHeaders];
                          copy[i] = { ...copy[i], key: e.target.value };
                          setFormHeaders(copy);
                        }}
                        className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[10px] text-white outline-none font-mono"
                      />
                      <input
                        type="text"
                        placeholder="Value"
                        value={h.value}
                        onChange={e => {
                          const copy = [...formHeaders];
                          copy[i] = { ...copy[i], value: e.target.value };
                          setFormHeaders(copy);
                        }}
                        className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[10px] text-white outline-none font-mono"
                      />
                      <button
                        onClick={() => setFormHeaders(prev => prev.filter((_, j) => j !== i))}
                        className="text-slate-600 hover:text-red-400 px-1"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              /* Manual JSON Mode */
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-500 uppercase">JSON Data</span>
                  <button
                    onClick={async () => {
                      try {
                        const text = await navigator.clipboard.readText();
                        setFormRawJson(text);
                        // Validate immediately
                        JSON.parse(text);
                        setFormJsonError(null);
                      } catch {
                        // clipboard may fail, ignore
                      }
                    }}
                    className="flex items-center gap-1 text-[10px] text-purple-400 hover:text-purple-300 transition-colors"
                    title="Paste from clipboard"
                  >
                    <Clipboard size={10} /> Paste
                  </button>
                </div>
                <textarea
                  placeholder='{"key": "value"} or [{"id": 1}, ...]'
                  value={formRawJson}
                  onChange={e => {
                    setFormRawJson(e.target.value);
                    if (e.target.value.trim()) {
                      try { JSON.parse(e.target.value); setFormJsonError(null); } catch (err: any) { setFormJsonError(err.message); }
                    } else {
                      setFormJsonError(null);
                    }
                  }}
                  rows={8}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-xs text-white focus:border-purple-500 outline-none font-mono resize-y leading-relaxed"
                />
                {formJsonError && (
                  <p className="text-[10px] text-red-400 flex items-center gap-1">
                    <AlertCircle size={10} /> {formJsonError}
                  </p>
                )}
                {formRawJson.trim() && !formJsonError && (
                  <p className="text-[10px] text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 size={10} /> Valid JSON
                  </p>
                )}
              </div>
            )}

            <button
              onClick={handleSaveDataset}
              disabled={formSaving || !formName.trim() || (formMode === 'api' && !formUrl.trim()) || (formMode === 'manual' && (!formRawJson.trim() || !!formJsonError))}
              className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {formSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {editingDataset ? 'Update' : 'Create'}
            </button>
          </div>
        )}

        {/* Dataset Cards */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {datasets.length === 0 ? (
            <div className="text-center py-12 text-slate-600">
              <Database size={32} className="mx-auto mb-3 opacity-50" />
              <p className="text-sm text-slate-500">No datasets yet</p>
              <p className="text-xs text-slate-600 mt-1">Click + to add one</p>
            </div>
          ) : (
            datasets.map(ds => (
              <div
                key={ds.id}
                className={`p-3 rounded-xl border cursor-pointer transition-all group ${
                  selectedDataset?.id === ds.id
                    ? 'bg-blue-900/20 border-blue-800/50'
                    : 'bg-slate-900/50 border-slate-800 hover:border-slate-700'
                }`}
                onClick={() => handleFetch(ds)}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-bold text-white truncate">{ds.name}</h3>
                    {ds.method !== 'MANUAL' ? (
                      <p className="text-[10px] text-slate-500 font-mono truncate mt-0.5">{ds.url}</p>
                    ) : (
                      <p className="text-[10px] text-purple-400/60 mt-0.5">Pasted JSON data</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
                    <button
                      onClick={e => { e.stopPropagation(); openEditForm(ds); }}
                      className="p-1 text-slate-500 hover:text-blue-400 rounded transition-colors"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); handleDeleteDataset(ds); }}
                      className="p-1 text-slate-500 hover:text-red-400 rounded transition-colors"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded ${
                    ds.method === 'MANUAL' ? 'bg-purple-900/30 text-purple-400' :
                    ds.method === 'POST' ? 'bg-amber-900/30 text-amber-400' : 'bg-emerald-900/30 text-emerald-400'
                  }`}>
                    {ds.method === 'MANUAL' ? 'JSON' : ds.method}
                  </span>
                  {ds.token && ds.method !== 'MANUAL' && (
                    <span className="flex items-center gap-0.5 text-[9px] text-slate-500">
                      <Lock size={8} /> Auth
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* RIGHT PANEL: JSON Explorer */}
      <div className="flex-1 bg-slate-950 flex flex-col min-w-0">

        {/* Breadcrumb Bar */}
        <div className="h-14 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-900/20 shrink-0">
          <div className="flex items-center gap-1 text-sm min-w-0 overflow-x-auto">
            <button
              onClick={() => navigateTo(0)}
              className={`px-2 py-1 rounded text-xs font-bold transition-colors shrink-0 ${
                jsonPath.length === 0
                  ? 'text-blue-400 bg-blue-900/20'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              $root
            </button>
            {jsonPath.map((seg, i) => (
              <React.Fragment key={i}>
                <ChevronRight size={12} className="text-slate-600 shrink-0" />
                <button
                  onClick={() => navigateTo(i + 1)}
                  className={`px-2 py-1 rounded text-xs font-bold transition-colors shrink-0 ${
                    i === jsonPath.length - 1
                      ? 'text-blue-400 bg-blue-900/20'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {seg}
                </button>
              </React.Fragment>
            ))}

            {fetchElapsed !== null && (
              <>
                <div className="h-4 w-px bg-slate-800 mx-2 shrink-0" />
                <span className="text-[10px] text-slate-600 shrink-0">{fetchElapsed}ms</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0 ml-4">
            {selectedDataset && !fetchLoading && selectedDataset.method !== 'MANUAL' && (
              <button
                onClick={() => selectedDataset && handleFetch(selectedDataset)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold text-slate-300 bg-slate-800 rounded-lg hover:bg-slate-700 border border-slate-700 transition-colors"
                title="Re-fetch data"
              >
                <RefreshCw size={13} />
                Fetch
              </button>
            )}

            {selectedRowIndices.size > 0 && (
              <span className="text-xs font-bold text-blue-400 bg-blue-900/20 px-2 py-0.5 rounded border border-blue-900/30">
                {selectedRowIndices.size} selected
              </span>
            )}

            {saveSuccess && (
              <span className="text-xs text-emerald-400 flex items-center gap-1">
                <CheckCircle2 size={12} /> {saveSuccess}
              </span>
            )}

            {nodeType === 'array_of_objects' && selectedRowIndices.size > 0 && (
              <button
                onClick={handleSaveSelected}
                disabled={savingRecords}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-emerald-600 rounded-lg hover:bg-emerald-500 transition-colors disabled:opacity-50"
              >
                {savingRecords ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                Save Selected
              </button>
            )}
          </div>
        </div>

        {/* Field Extraction Toolbar */}
        {!fetchLoading && fetchedJson !== null && nodeType === 'array_of_objects' && fieldCandidates.length > 0 && (
          <div className="border-b border-slate-800 bg-slate-900/40 shrink-0">
            {/* Toolbar row */}
            <div className="px-6 py-2.5 flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <Settings size={13} />
                <span className="font-bold">Field Extraction</span>
              </div>

              {/* Selected field tags */}
              {selectedFields.size > 0 && (
                <div className="flex items-center gap-1 flex-wrap">
                  {selectedFieldsArr.map(f => (
                    <span
                      key={f}
                      className="px-2 py-0.5 text-[10px] font-bold bg-blue-900/30 text-blue-400 border border-blue-800/40 rounded-full cursor-pointer hover:bg-red-900/30 hover:text-red-400 hover:border-red-800/40 transition-colors"
                      onClick={() => toggleField(f)}
                      title={`Click to remove: ${f}`}
                    >
                      {fieldKeys[f] || f}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex-1" />

              <button
                onClick={() => setShowFieldConfig(prev => !prev)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                  showFieldConfig
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
                }`}
              >
                <Settings size={13} />
                Configure Fields
              </button>

              {selectedFields.size > 0 && (selectedDataset?.extract_fields?.length ?? 0) > 0 && (
                <button
                  onClick={handleExtractAndSaveAll}
                  disabled={extracting}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-emerald-600 rounded-lg hover:bg-emerald-500 transition-colors disabled:opacity-50"
                >
                  {extracting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                  Extract & Save All ({Array.isArray(currentNode) ? currentNode.length : 0})
                </button>
              )}
            </div>

            {/* Expanded config panel */}
            {showFieldConfig && (
              <div className="px-6 pb-4 pt-1 border-t border-slate-800/50">
                <p className="text-[11px] text-slate-500 mb-3">Select fields to extract from each item:</p>

                <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-4 max-h-[200px] overflow-y-auto">
                  {fieldCandidates.map(field => {
                    const sampleVal = Array.isArray(currentNode) && currentNode.length > 0
                      ? getNestedValue(currentNode[0], field) : undefined;
                    const valType = sampleVal === null ? 'null' : typeof sampleVal;
                    const isSelected = selectedFields.has(field);
                    return (
                      <label
                        key={field}
                        className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-xs transition-colors ${
                          isSelected ? 'bg-blue-900/15 text-blue-300' : 'text-slate-400 hover:text-white hover:bg-slate-800/30'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleField(field)}
                          className="accent-blue-500"
                        />
                        <span className="font-mono truncate flex-1">{field}</span>
                        <span className={`text-[9px] px-1 py-0.5 rounded ${
                          valType === 'null' ? 'text-slate-600' :
                          valType === 'number' ? 'text-amber-500' :
                          valType === 'boolean' ? 'text-purple-500' :
                          'text-slate-500'
                        }`}>
                          {valType}
                        </span>
                        {isSelected && (
                          <span className="text-[9px] text-emerald-500">
                            → {fieldKeys[field] || field}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>

                {/* Preview */}
                {extractionPreview && (
                  <div className="mb-3">
                    <p className="text-[10px] text-slate-500 mb-1 uppercase font-bold">Preview (first item):</p>
                    <pre className="text-[11px] font-mono text-emerald-400 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 overflow-x-auto">
                      {JSON.stringify(extractionPreview, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSaveFieldConfig}
                    disabled={selectedFields.size === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors disabled:opacity-50"
                  >
                    <Save size={13} />
                    Save Config
                  </button>
                  <button
                    onClick={() => setShowFieldConfig(false)}
                    className="px-3 py-1.5 text-xs font-bold text-slate-400 bg-slate-800 rounded-lg hover:text-white border border-slate-700 transition-colors"
                  >
                    Cancel
                  </button>
                  {selectedFields.size > 0 && (
                    <span className="text-[10px] text-slate-500 ml-2">
                      {selectedFields.size} field{selectedFields.size > 1 ? 's' : ''} selected
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Explorer Content */}
        <div className="flex-1 overflow-auto">

          {/* Loading */}
          {fetchLoading && (
            <div className="h-full flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <Loader2 size={32} className="text-blue-500 animate-spin" />
                <span className="text-sm text-slate-400">Fetching data...</span>
              </div>
            </div>
          )}

          {/* Error */}
          {fetchError && !fetchLoading && (
            <div className="p-6">
              <div className="p-4 bg-red-900/20 border border-red-900/50 rounded-xl text-red-200 text-sm flex items-start gap-3">
                <AlertCircle size={18} className="mt-0.5 shrink-0" />
                <div>
                  <p className="font-bold mb-1">Fetch Error</p>
                  <p className="text-xs text-red-300/80 break-all">{fetchError}</p>
                </div>
              </div>
            </div>
          )}

          {/* Empty state */}
          {!fetchLoading && !fetchError && fetchedJson === null && (
            <div className="h-full flex flex-col items-center justify-center text-slate-600">
              <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center mb-4 border border-slate-800">
                <Globe size={32} className="opacity-50" />
              </div>
              <p className="text-sm font-medium text-slate-400">Select a dataset to fetch</p>
              <p className="text-xs mt-2 text-slate-500 max-w-xs text-center leading-relaxed">
                Click on a dataset card to fetch its data, then explore the JSON response with drill-down navigation.
              </p>
            </div>
          )}

          {/* Object View */}
          {!fetchLoading && fetchedJson !== null && nodeType === 'object' && (
            <div className="divide-y divide-slate-800/50">
              {Object.entries(currentNode as Record<string, any>).map(([key, val]) => (
                <div
                  key={key}
                  className={`flex items-center px-6 py-3 text-sm ${
                    isNavigable(val)
                      ? 'cursor-pointer hover:bg-slate-800/30'
                      : ''
                  }`}
                  onClick={() => isNavigable(val) && drillInto(key)}
                >
                  <span className="w-48 shrink-0 text-slate-400 font-mono text-xs truncate">{key}</span>
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    {isNavigable(val) ? (
                      <>
                        <span className="text-blue-400 text-xs font-bold">
                          {Array.isArray(val)
                            ? <span className="flex items-center gap-1"><List size={12} /> Array[{val.length}]</span>
                            : <span className="flex items-center gap-1"><Braces size={12} /> Object{`{${Object.keys(val).length}}`}</span>
                          }
                        </span>
                        <ChevronRight size={14} className="text-slate-600" />
                      </>
                    ) : (
                      <span className={`text-xs font-mono truncate ${
                        val === null ? 'text-slate-600 italic' :
                        typeof val === 'number' ? 'text-amber-400' :
                        typeof val === 'boolean' ? 'text-purple-400' :
                        'text-slate-300'
                      }`}>
                        {renderValue(val)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Array of Objects → Table View */}
          {!fetchLoading && fetchedJson !== null && nodeType === 'array_of_objects' && Array.isArray(currentNode) && (
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-900 text-slate-400 font-medium uppercase text-xs border-b border-slate-800 sticky top-0 z-10">
                <tr>
                  <th className="px-4 py-3 w-10 text-center">
                    <button onClick={toggleSelectAll} className="hover:text-white transition-colors">
                      {selectedRowIndices.size > 0 && selectedRowIndices.size === currentNode.length
                        ? <CheckSquare size={16} />
                        : <Square size={16} />
                      }
                    </button>
                  </th>
                  <th className="px-4 py-3 w-12">#</th>
                  {tableColumns.slice(0, 8).map(col => (
                    <th key={col} className="px-4 py-3">{col}</th>
                  ))}
                  <th className="px-4 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {currentNode.map((item: any, idx: number) => (
                  <tr
                    key={idx}
                    className={`transition-colors group ${
                      selectedRowIndices.has(idx)
                        ? 'bg-blue-900/10 hover:bg-blue-900/20'
                        : 'hover:bg-slate-800/30'
                    }`}
                    onClick={() => toggleRowSelect(idx)}
                  >
                    <td className="px-4 py-3 text-center cursor-pointer">
                      <div className={`transition-colors ${
                        selectedRowIndices.has(idx) ? 'text-blue-400' : 'text-slate-600 group-hover:text-slate-400'
                      }`}>
                        {selectedRowIndices.has(idx) ? <CheckSquare size={16} /> : <Square size={16} />}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-xs">{idx}</td>
                    {tableColumns.slice(0, 8).map(col => {
                      const val = item?.[col];
                      const isObj = val !== null && val !== undefined && typeof val === 'object';
                      return (
                        <td key={col} className="px-4 py-3 text-xs max-w-[200px] overflow-hidden text-ellipsis">
                          {isObj ? (
                            <button
                              onClick={e => { e.stopPropagation(); drillInto(String(idx)); }}
                              className="text-blue-400 hover:text-blue-300 font-bold"
                            >
                              {Array.isArray(val) ? `[${val.length}]` : `{${Object.keys(val).length}}`}
                            </button>
                          ) : (
                            <span className={`font-mono ${
                              val === null ? 'text-slate-600 italic' :
                              typeof val === 'number' ? 'text-amber-400' :
                              typeof val === 'boolean' ? 'text-purple-400' :
                              'text-slate-300'
                            }`}>
                              {renderValue(val)}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-4 py-3">
                      <button
                        onClick={e => { e.stopPropagation(); drillInto(String(idx)); }}
                        className="p-1 text-slate-600 hover:text-white rounded transition-colors"
                        title="Drill into row"
                      >
                        <ChevronRight size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Array of Primitives */}
          {!fetchLoading && fetchedJson !== null && nodeType === 'array_of_primitives' && Array.isArray(currentNode) && (
            <div className="p-6 space-y-1">
              {jsonPath.length > 0 && (
                <button
                  onClick={() => navigateTo(jsonPath.length - 1)}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-white mb-4 transition-colors"
                >
                  <ArrowLeft size={12} /> Back
                </button>
              )}
              {currentNode.map((val: any, idx: number) => (
                <div key={idx} className="flex items-center gap-3 px-4 py-2 rounded hover:bg-slate-800/30 text-sm">
                  <span className="text-slate-600 text-xs font-mono w-8 text-right">{idx}</span>
                  <span className={`font-mono text-xs ${
                    typeof val === 'number' ? 'text-amber-400' :
                    typeof val === 'boolean' ? 'text-purple-400' :
                    'text-slate-300'
                  }`}>
                    {String(val)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Primitive Value */}
          {!fetchLoading && fetchedJson !== null && nodeType === 'primitive' && (
            <div className="p-6">
              {jsonPath.length > 0 && (
                <button
                  onClick={() => navigateTo(jsonPath.length - 1)}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-white mb-4 transition-colors"
                >
                  <ArrowLeft size={12} /> Back
                </button>
              )}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                <span className="text-xs text-slate-500 block mb-2">Value</span>
                <pre className="text-sm font-mono text-emerald-400 whitespace-pre-wrap break-all">
                  {String(currentNode)}
                </pre>
              </div>
            </div>
          )}

          {/* Empty node */}
          {!fetchLoading && fetchedJson !== null && nodeType === 'empty' && (
            <div className="p-6">
              {jsonPath.length > 0 && (
                <button
                  onClick={() => navigateTo(jsonPath.length - 1)}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-white mb-4 transition-colors"
                >
                  <ArrowLeft size={12} /> Back
                </button>
              )}
              <div className="text-center py-12 text-slate-600">
                <p className="text-sm italic">null / empty</p>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default Datasets;
