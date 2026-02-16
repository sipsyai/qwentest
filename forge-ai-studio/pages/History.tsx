import React, { useState, useEffect, useCallback } from 'react';
import { Search, Calendar, Trash2, ChevronRight, RefreshCw } from 'lucide-react';
import { getHistory, clearHistory, deleteHistoryItem } from '../services/history';
import { HistoryItem } from '../types';

const History = () => {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [endpointFilter, setEndpointFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const loadHistory = useCallback(() => {
    setHistory(getHistory());
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleClearAll = () => {
    clearHistory();
    setHistory([]);
  };

  const handleDelete = (id: string) => {
    deleteHistoryItem(id);
    setHistory(prev => prev.filter(item => item.id !== id));
  };

  const filteredHistory = history.filter(item => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!item.endpoint.toLowerCase().includes(q) &&
          !item.model.toLowerCase().includes(q) &&
          !item.preview.toLowerCase().includes(q)) {
        return false;
      }
    }
    if (endpointFilter !== 'all' && item.endpoint !== endpointFilter) return false;
    if (statusFilter === 'success' && item.status !== 200) return false;
    if (statusFilter === 'error' && item.status === 200) return false;
    return true;
  });

  return (
    <div className="p-8 h-screen overflow-y-auto bg-slate-950">

      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white mb-2">History</h1>
          <p className="text-slate-400 text-sm">Review your recent API requests and model responses.</p>
        </div>
        <button
          onClick={loadHistory}
          className="flex items-center gap-2 px-4 py-2 text-sm text-slate-300 bg-slate-900 border border-slate-800 rounded-lg hover:bg-slate-800 transition-colors"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Filters Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-6 flex flex-wrap gap-4 items-center justify-between">
        <div className="flex items-center gap-4 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-2.5 text-slate-500" size={16} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by keyword, model, or endpoint..."
              className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500 outline-none placeholder:text-slate-600"
            />
          </div>

          <select
            value={endpointFilter}
            onChange={(e) => setEndpointFilter(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-sm text-slate-300 outline-none focus:border-blue-500"
          >
            <option value="all">Endpoint: All</option>
            <option value="/v1/chat/completions">/v1/chat/completions</option>
            <option value="/v1/embeddings">/v1/embeddings</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-sm text-slate-300 outline-none focus:border-blue-500"
          >
            <option value="all">Status: All</option>
            <option value="success">Success (200)</option>
            <option value="error">Errors</option>
          </select>
        </div>

        <button
          onClick={handleClearAll}
          disabled={history.length === 0}
          className="px-4 py-2 text-sm text-red-400 bg-red-950/30 border border-red-900/50 rounded-lg hover:bg-red-900/50 transition-colors flex items-center gap-2 disabled:opacity-50"
        >
          <Trash2 size={14} /> Clear All
        </button>
      </div>

      {/* Stats */}
      {history.length > 0 && (
        <div className="flex gap-4 mb-6">
          <div className="bg-slate-900 border border-slate-800 rounded-lg px-4 py-3 flex-1">
            <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Total Requests</span>
            <span className="text-lg font-bold text-white">{history.length}</span>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg px-4 py-3 flex-1">
            <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Success Rate</span>
            <span className="text-lg font-bold text-emerald-400">
              {history.length > 0 ? Math.round((history.filter(h => h.status === 200).length / history.length) * 100) : 0}%
            </span>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg px-4 py-3 flex-1">
            <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Total Tokens</span>
            <span className="text-lg font-bold text-blue-400">
              {history.reduce((sum, h) => sum + h.tokens, 0).toLocaleString()}
            </span>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg px-4 py-3 flex-1">
            <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Showing</span>
            <span className="text-lg font-bold text-white">{filteredHistory.length}</span>
          </div>
        </div>
      )}

      {/* List */}
      {filteredHistory.length > 0 ? (
        <div className="space-y-3">
          {filteredHistory.map((item) => (
            <div key={item.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-600 transition-colors group">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-4">
                  <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${
                    item.method === 'POST' ? 'bg-blue-500/20 text-blue-400' : 'bg-green-500/20 text-green-400'
                  }`}>
                    {item.method}
                  </span>
                  <span className="text-slate-200 font-mono text-sm font-medium">{item.endpoint}</span>

                  <div className="h-4 w-px bg-slate-700 mx-2"></div>

                  <span className="flex items-center gap-1.5 text-xs text-slate-400 bg-slate-800/50 px-2 py-0.5 rounded border border-slate-700/50">
                    <span className="w-1.5 h-1.5 bg-purple-500 rounded-full"></span>
                    {item.model}
                  </span>
                </div>

                <div className="flex items-center gap-4 text-xs text-slate-500 font-mono">
                  <span className="flex items-center gap-1.5"><Calendar size={12}/> {item.timestamp}</span>
                  <span>{item.duration}</span>
                  <span>{item.tokens} tokens</span>
                  <span className={`px-2 py-0.5 rounded-full border ${
                    item.status === 200
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-red-500/10 text-red-400 border-red-500/20'
                  }`}>
                    {item.status} {item.statusText}
                  </span>
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="p-1 text-slate-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              <div className="bg-slate-950/50 rounded-lg p-3 border border-slate-800/50">
                <p className={`text-sm font-mono truncate ${item.status !== 200 ? 'text-red-400 italic' : 'text-slate-500'}`}>
                  "{item.preview}"
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-slate-600">
          <Calendar size={48} className="mb-4 opacity-50" />
          <p className="text-sm font-medium text-slate-400">
            {history.length === 0 ? 'No history yet' : 'No matching results'}
          </p>
          <p className="text-xs text-slate-500 mt-2">
            {history.length === 0 ? 'API requests from Playground and Embeddings will appear here.' : 'Try adjusting your filters.'}
          </p>
        </div>
      )}
    </div>
  );
};

export default History;
