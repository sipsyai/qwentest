import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FileJson, Trash2, ChevronDown, ChevronRight, Search,
  Loader2, AlertCircle, CheckSquare, Square, X, Database, CheckCircle2
} from 'lucide-react';
import {
  getDatasets, getDataset, getDatasetRecords, getAllDatasetRecords,
  deleteDatasetRecord, bulkDeleteDatasetRecords,
  Dataset, DatasetRecord
} from '../services/datasetsApi';
import { fetchEmbedModels, generateEmbeddings } from '../services/vllm';
import { addDocuments } from '../services/kbApi';
import { recordToText, batchArray } from '../services/embedUtils';

const DatasetRecords = () => {
  // Data
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [records, setRecords] = useState<DatasetRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [filterDatasetId, setFilterDatasetId] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Expanded row (single row detail)
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Embed state
  const [embedModels, setEmbedModels] = useState<string[]>([]);
  const [selectedEmbedModel, setSelectedEmbedModel] = useState('');
  const [embedding, setEmbedding] = useState(false);
  const [embedProgress, setEmbedProgress] = useState({ current: 0, total: 0 });
  const [embedResult, setEmbedResult] = useState<string | null>(null);
  const [showEmbedAllConfirm, setShowEmbedAllConfirm] = useState(false);

  // Dataset cache for embed (extract_fields lookup)
  const datasetCacheRef = React.useRef<Map<string, Dataset>>(new Map());

  // Load datasets for filter dropdown
  useEffect(() => {
    getDatasets().then(r => setDatasets(r.data)).catch(() => {});
  }, []);

  // Load embed models
  useEffect(() => {
    fetchEmbedModels().then(models => {
      if (models.length > 0) {
        setEmbedModels(models);
        setSelectedEmbedModel(models[0]);
      }
    });
  }, []);

  // Load records
  const loadRecords = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getDatasetRecords({
        dataset_id: filterDatasetId || undefined,
        page,
        limit,
      });
      setRecords(result.data);
      setTotal(result.total);
    } catch (err: any) {
      setError(err.message || 'Failed to load records');
    } finally {
      setLoading(false);
    }
  }, [filterDatasetId, page, limit]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  // Filter change resets to page 1
  const handleFilterChange = (dsId: string) => {
    setFilterDatasetId(dsId);
    setPage(1);
    setSelectedIds(new Set());
  };

  // Selection
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === records.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(records.map(r => r.id)));
    }
  };

  // Delete
  const handleDelete = async (id: string) => {
    try {
      await deleteDatasetRecord(id);
      setRecords(prev => prev.filter(r => r.id !== id));
      setTotal(prev => prev - 1);
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (err: any) {
      setError(`Delete failed: ${err.message}`);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    try {
      await bulkDeleteDatasetRecords(Array.from(selectedIds));
      setSelectedIds(new Set());
      loadRecords();
    } catch (err: any) {
      setError(`Bulk delete failed: ${err.message}`);
    }
  };

  // Get dataset name by id
  const getDatasetName = (dsId: string) => {
    return datasets.find(d => d.id === dsId)?.name || dsId.slice(0, 8);
  };

  // Filtered by search
  const filteredRecords = searchTerm
    ? records.filter(r =>
        r.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
        JSON.stringify(r.data).toLowerCase().includes(searchTerm.toLowerCase())
      )
    : records;

  // Derive table columns from record data keys
  const dataColumns = useMemo(() => {
    const allKeys = new Set<string>();
    filteredRecords.slice(0, 50).forEach(r => {
      if (r.data && typeof r.data === 'object') {
        Object.keys(r.data).forEach(k => allKeys.add(k));
      }
    });
    return Array.from(allKeys);
  }, [filteredRecords]);

  const totalPages = Math.ceil(total / limit);

  // --- Embed Logic ---

  const getCachedDataset = async (dsId: string): Promise<Dataset> => {
    const cached = datasetCacheRef.current.get(dsId);
    if (cached) return cached;
    const ds = await getDataset(dsId);
    datasetCacheRef.current.set(dsId, ds);
    return ds;
  };

  const embedRecords = async (recordsToEmbed: DatasetRecord[]) => {
    if (recordsToEmbed.length === 0 || !selectedEmbedModel) return;

    setEmbedding(true);
    setEmbedResult(null);
    setError(null);
    setEmbedProgress({ current: 0, total: recordsToEmbed.length });

    let totalInserted = 0;
    let totalSkipped = 0;

    try {
      // Prepare texts: resolve dataset for each record
      const textsWithMeta: { text: string; datasetName: string }[] = [];
      const dsIds = [...new Set(recordsToEmbed.map(r => r.dataset_id))];
      const dsMap = new Map<string, Dataset>();
      for (const dsId of dsIds) {
        dsMap.set(dsId, await getCachedDataset(dsId));
      }

      for (const rec of recordsToEmbed) {
        const ds = dsMap.get(rec.dataset_id) || null;
        const text = recordToText(rec, ds);
        textsWithMeta.push({ text, datasetName: ds?.name || rec.dataset_id.slice(0, 8) });
      }

      // Batch embed + save
      const BATCH_SIZE = 32;
      const batches = batchArray(textsWithMeta, BATCH_SIZE);
      let processed = 0;

      for (const batch of batches) {
        const batchTexts = batch.map(b => b.text);
        const embedResponse = await generateEmbeddings(selectedEmbedModel, batchTexts);

        const docs = embedResponse.data.map((item, idx) => ({
          text: batch[idx].text,
          embedding: item.embedding,
          source: 'dataset' as const,
          sourceLabel: batch[idx].datasetName,
        }));

        const inserted = await addDocuments(docs, selectedEmbedModel);
        totalInserted += inserted;
        totalSkipped += docs.length - inserted;

        processed += batch.length;
        setEmbedProgress({ current: processed, total: recordsToEmbed.length });
      }

      const msg = totalSkipped > 0
        ? `Embedded ${totalInserted} records (${totalSkipped} duplicates skipped)`
        : `Embedded ${totalInserted} records`;
      setEmbedResult(msg);
      setTimeout(() => setEmbedResult(null), 5000);
    } catch (err: any) {
      setError(`Embedding failed: ${err.message}`);
    } finally {
      setEmbedding(false);
    }
  };

  const handleEmbedSelected = () => {
    const selected = records.filter(r => selectedIds.has(r.id));
    embedRecords(selected);
  };

  const handleEmbedAll = async () => {
    setShowEmbedAllConfirm(false);
    setEmbedding(true);
    setError(null);

    try {
      // Get all records for the filtered dataset, or all datasets
      let allRecords: DatasetRecord[] = [];
      if (filterDatasetId) {
        allRecords = await getAllDatasetRecords(filterDatasetId);
      } else {
        // Fetch all records from each dataset
        for (const ds of datasets) {
          const dsRecords = await getAllDatasetRecords(ds.id);
          allRecords.push(...dsRecords);
        }
      }
      setEmbedding(false); // embedRecords sets it again
      await embedRecords(allRecords);
    } catch (err: any) {
      setError(`Failed to load records for embedding: ${err.message}`);
      setEmbedding(false);
    }
  };

  const embedDisabled = !selectedEmbedModel || embedding;

  return (
    <div className="h-screen bg-slate-950 flex flex-col overflow-hidden">

      {/* Embed All Confirm Modal */}
      {showEmbedAllConfirm && (
        <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-slate-900 border border-amber-900/50 rounded-2xl p-6 max-w-sm shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-2">Embed All Records?</h3>
            <p className="text-sm text-slate-400 mb-1">
              This will embed {filterDatasetId ? 'all records from the selected dataset' : `all records from ${datasets.length} dataset(s)`} into the Knowledge Base.
            </p>
            <p className="text-xs text-slate-500 mb-6">
              Duplicates will be automatically skipped.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowEmbedAllConfirm(false)} className="px-4 py-2 text-slate-300 hover:text-white transition-colors">Cancel</button>
              <button onClick={handleEmbedAll} className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-bold transition-colors">Embed All</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="px-6 py-5 border-b border-slate-800 bg-slate-900/20">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <FileJson size={22} className="text-blue-500" />
              Saved Records
            </h1>
            <p className="text-slate-400 text-xs mt-1">
              Records saved from dataset fetch results ({total} total)
            </p>
          </div>

          <div className="flex items-center gap-2">
            {selectedIds.size > 0 && (
              <>
                <button
                  onClick={handleEmbedSelected}
                  disabled={embedDisabled}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-amber-600 rounded-lg hover:bg-amber-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Database size={13} />
                  Embed Selected ({selectedIds.size})
                </button>
                <button
                  onClick={handleBulkDelete}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-red-600 rounded-lg hover:bg-red-500 transition-colors"
                >
                  <Trash2 size={13} />
                  Delete {selectedIds.size}
                </button>
              </>
            )}
            <button
              onClick={() => setShowEmbedAllConfirm(true)}
              disabled={embedDisabled || total === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-amber-400 bg-amber-900/20 border border-amber-900/30 rounded-lg hover:bg-amber-900/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Database size={13} />
              Embed All
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="flex items-center gap-3 mt-4">
          <div className="flex items-center gap-2 flex-1">
            <div className="relative flex-1 max-w-xs">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Search records..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-xs text-white focus:border-blue-500 outline-none"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            <select
              value={filterDatasetId}
              onChange={e => handleFilterChange(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:border-blue-500 outline-none"
            >
              <option value="">All Datasets</option>
              {datasets.map(ds => (
                <option key={ds.id} value={ds.id}>{ds.name}</option>
              ))}
            </select>

            <select
              value={selectedEmbedModel}
              onChange={e => setSelectedEmbedModel(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:border-amber-500 outline-none"
            >
              {embedModels.length === 0 ? (
                <option value="">No embed model</option>
              ) : (
                embedModels.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))
              )}
            </select>
          </div>
        </div>

        {/* Progress bar */}
        {embedding && embedProgress.total > 0 && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>Embedding records...</span>
              <span className="font-mono">{embedProgress.current} / {embedProgress.total}</span>
            </div>
            <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-500 transition-all duration-300 rounded-full"
                style={{ width: `${(embedProgress.current / embedProgress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Embed result message */}
        {embedResult && (
          <div className="mt-3 p-2.5 bg-emerald-900/20 border border-emerald-900/50 rounded-lg text-emerald-200 text-xs flex items-center gap-2">
            <CheckCircle2 size={14} className="shrink-0" />
            {embedResult}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-900/20 border border-red-900/50 rounded-xl text-red-200 text-xs flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Records Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 size={24} className="text-blue-500 animate-spin" />
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-600">
            <FileJson size={32} className="opacity-50 mb-3" />
            <p className="text-sm text-slate-400">No records found</p>
            <p className="text-xs text-slate-500 mt-1">Save records from the Datasets page</p>
          </div>
        ) : (
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-slate-900 text-slate-400 font-medium uppercase text-xs border-b border-slate-800 sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 w-10 text-center">
                  <button onClick={toggleSelectAll} className="hover:text-white transition-colors">
                    {selectedIds.size > 0 && selectedIds.size === filteredRecords.length
                      ? <CheckSquare size={14} /> : <Square size={14} />}
                  </button>
                </th>
                <th className="px-4 py-3 w-12">#</th>
                {dataColumns.map(col => (
                  <th key={col} className="px-4 py-3">{col}</th>
                ))}
                <th className="px-4 py-3 w-28">Dataset</th>
                <th className="px-4 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {filteredRecords.map((record, idx) => (
                <React.Fragment key={record.id}>
                  <tr
                    className={`transition-colors group cursor-pointer ${
                      selectedIds.has(record.id)
                        ? 'bg-blue-900/10 hover:bg-blue-900/20'
                        : 'hover:bg-slate-800/30'
                    }`}
                    onClick={() => setExpandedId(prev => prev === record.id ? null : record.id)}
                  >
                    <td className="px-4 py-3 text-center" onClick={e => { e.stopPropagation(); toggleSelect(record.id); }}>
                      <div className={`transition-colors ${
                        selectedIds.has(record.id) ? 'text-blue-400' : 'text-slate-600 group-hover:text-slate-400'
                      }`}>
                        {selectedIds.has(record.id) ? <CheckSquare size={14} /> : <Square size={14} />}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-xs">{(page - 1) * limit + idx}</td>
                    {dataColumns.map(col => {
                      const val = record.data?.[col];
                      return (
                        <td key={col} className="px-4 py-3 text-xs max-w-[250px] overflow-hidden text-ellipsis">
                          <span className={`font-mono ${
                            val === null || val === undefined ? 'text-slate-600 italic' :
                            typeof val === 'number' ? 'text-amber-400' :
                            typeof val === 'boolean' ? 'text-purple-400' :
                            'text-slate-300'
                          }`}>
                            {val === null ? 'null' : val === undefined ? '-' : typeof val === 'object' ? JSON.stringify(val) : String(val)}
                          </span>
                        </td>
                      );
                    })}
                    <td className="px-4 py-3">
                      <span className="text-[10px] text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded truncate block max-w-[100px]">
                        {getDatasetName(record.dataset_id)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={e => { e.stopPropagation(); handleDelete(record.id); }}
                        className="p-1 text-slate-600 hover:text-red-400 rounded transition-colors opacity-0 group-hover:opacity-100"
                        title="Delete record"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>

                  {/* Expanded detail row */}
                  {expandedId === record.id && (
                    <tr>
                      <td colSpan={dataColumns.length + 4} className="px-4 py-3 bg-slate-900/50">
                        <div className="flex gap-4 text-[11px]">
                          <div className="flex-1">
                            <pre className="font-mono text-blue-300 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 overflow-x-auto max-h-48">
                              {JSON.stringify(record.data, null, 2)}
                            </pre>
                          </div>
                          <div className="text-slate-500 space-y-1 shrink-0 w-40">
                            <p><span className="text-slate-600">Path:</span> {record.json_path}</p>
                            <p><span className="text-slate-600">Label:</span> {record.label || '-'}</p>
                            <p><span className="text-slate-600">Created:</span> {new Date(record.created_at).toLocaleDateString('tr-TR', {
                              day: '2-digit', month: '2-digit', year: 'numeric',
                              hour: '2-digit', minute: '2-digit',
                            })}</p>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="px-6 py-3 border-t border-slate-800 flex items-center justify-between bg-slate-900/20">
          <span className="text-xs text-slate-500">
            Page {page} of {totalPages} ({total} records)
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 text-xs bg-slate-800 text-slate-300 rounded hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 text-xs bg-slate-800 text-slate-300 rounded hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DatasetRecords;
