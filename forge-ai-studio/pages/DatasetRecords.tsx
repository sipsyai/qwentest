import React, { useState, useEffect, useCallback } from 'react';
import {
  FileJson, Trash2, ChevronDown, ChevronRight, Search,
  Loader2, AlertCircle, CheckSquare, Square, X
} from 'lucide-react';
import {
  getDatasets, getDatasetRecords, deleteDatasetRecord, bulkDeleteDatasetRecords,
  Dataset, DatasetRecord
} from '../services/datasetsApi';

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

  // Expanded rows
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Load datasets for filter dropdown
  useEffect(() => {
    getDatasets().then(r => setDatasets(r.data)).catch(() => {});
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

  // Expand/collapse
  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
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

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="h-screen bg-slate-950 flex flex-col overflow-hidden">

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

          {selectedIds.size > 0 && (
            <button
              onClick={handleBulkDelete}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-red-600 rounded-lg hover:bg-red-500 transition-colors"
            >
              <Trash2 size={13} />
              Delete {selectedIds.size} Selected
            </button>
          )}
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
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-900/20 border border-red-900/50 rounded-xl text-red-200 text-xs flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Records List */}
      <div className="flex-1 overflow-y-auto">
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
          <div className="divide-y divide-slate-800/50">
            {/* Header row */}
            <div className="flex items-center px-6 py-2 bg-slate-900/50 text-xs text-slate-500 font-medium uppercase sticky top-0 z-10">
              <div className="w-10 text-center">
                <button onClick={toggleSelectAll} className="hover:text-white transition-colors">
                  {selectedIds.size > 0 && selectedIds.size === records.length
                    ? <CheckSquare size={14} /> : <Square size={14} />}
                </button>
              </div>
              <div className="flex-1 px-3">Label</div>
              <div className="w-32 px-3">Dataset</div>
              <div className="w-28 px-3">Path</div>
              <div className="w-36 px-3">Created</div>
              <div className="w-16"></div>
            </div>

            {filteredRecords.map(record => (
              <div key={record.id}>
                <div
                  className={`flex items-center px-6 py-3 text-sm transition-colors cursor-pointer ${
                    selectedIds.has(record.id) ? 'bg-blue-900/10' : 'hover:bg-slate-800/20'
                  }`}
                >
                  <div className="w-10 text-center" onClick={() => toggleSelect(record.id)}>
                    <div className={`transition-colors ${
                      selectedIds.has(record.id) ? 'text-blue-400' : 'text-slate-600 hover:text-slate-400'
                    }`}>
                      {selectedIds.has(record.id) ? <CheckSquare size={14} /> : <Square size={14} />}
                    </div>
                  </div>

                  <div
                    className="flex-1 px-3 min-w-0 cursor-pointer"
                    onClick={() => toggleExpand(record.id)}
                  >
                    <div className="flex items-center gap-2">
                      {expandedIds.has(record.id)
                        ? <ChevronDown size={14} className="text-slate-500 shrink-0" />
                        : <ChevronRight size={14} className="text-slate-500 shrink-0" />
                      }
                      <span className="text-white text-xs font-medium truncate">
                        {record.label || 'Untitled'}
                      </span>
                    </div>
                    {!expandedIds.has(record.id) && (
                      <p className="text-[10px] text-slate-600 font-mono truncate ml-6 mt-0.5">
                        {JSON.stringify(record.data).slice(0, 120)}
                      </p>
                    )}
                  </div>

                  <div className="w-32 px-3">
                    <span className="text-[10px] text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded truncate block">
                      {getDatasetName(record.dataset_id)}
                    </span>
                  </div>

                  <div className="w-28 px-3">
                    <span className="text-[10px] text-slate-500 font-mono">{record.json_path}</span>
                  </div>

                  <div className="w-36 px-3">
                    <span className="text-[10px] text-slate-500">
                      {new Date(record.created_at).toLocaleDateString('tr-TR', {
                        day: '2-digit', month: '2-digit', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </div>

                  <div className="w-16 flex justify-end">
                    <button
                      onClick={e => { e.stopPropagation(); handleDelete(record.id); }}
                      className="p-1.5 text-slate-600 hover:text-red-400 rounded transition-colors"
                      title="Delete record"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Expanded JSON */}
                {expandedIds.has(record.id) && (
                  <div className="px-6 pb-3">
                    <div className="ml-10 bg-slate-900 border border-slate-800 rounded-xl overflow-auto max-h-64">
                      <pre className="text-[11px] font-mono text-blue-300 p-4 leading-relaxed">
                        {JSON.stringify(record.data, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
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
