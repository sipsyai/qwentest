import React, { useEffect, useState } from 'react';
import { MOCK_MODELS } from '../services/mockData';
import { fetchVLLMModels } from '../services/vllm';
import { Link } from 'react-router-dom';
import { Download, RefreshCw, Trash2, Copy, Info, AlertCircle } from 'lucide-react';
import { Model } from '../types';

const Models = () => {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadModels = async () => {
    setLoading(true);
    setError(null);
    try {
      const vllmModels = await fetchVLLMModels();
      if (vllmModels.length > 0) {
        setModels(vllmModels);
      } else {
        setError("No models found on server.");
        setModels(MOCK_MODELS);
      }
    } catch (e: any) {
      // Handle specific "Failed to fetch" (usually CORS or Network)
      let msg = e.message || "Failed to connect to vLLM.";
      if (msg === 'Failed to fetch') {
         msg = "Connection failed. Check if vLLM is running, CORS is enabled (--allowed-origins=\"*\"), and the URL in Settings is correct.";
      }
      setError(msg);
      setModels(MOCK_MODELS);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadModels();
  }, []);

  return (
    <div className="p-8 h-screen overflow-y-auto bg-slate-950">
      
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
           <h1 className="text-2xl font-bold text-white mb-1">Loaded Models</h1>
           <p className="text-slate-400 text-sm">Manage your vLLM local models and adapters.</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={loadModels}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-300 bg-slate-900 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors shadow-lg shadow-blue-900/30">
            <Download size={16} /> Pull Model
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-900/20 border border-red-900/50 rounded-xl flex items-center gap-3 text-red-200 text-sm">
          <AlertCircle size={18} className="shrink-0" />
          <span>{error} (Showing mock data for preview)</span>
          <Link to="/settings" className="underline hover:text-white ml-auto whitespace-nowrap">Go to Settings</Link>
        </div>
      )}

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {models.map((model) => (
          <div key={model.id} className="bg-slate-900 border border-slate-800 rounded-xl p-6 hover:border-blue-500/30 transition-all group relative overflow-hidden">
            
            {/* Top Row */}
            <div className="flex justify-between items-start mb-4">
               <div className="flex-1 mr-4">
                  <h3 className="text-lg font-bold text-white group-hover:text-blue-400 transition-colors truncate" title={model.name}>{model.name}</h3>
                  <div className="flex items-center gap-2 mt-1">
                     <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider bg-slate-700 text-slate-300`}>
                        {model.tags[0]}
                     </span>
                     <span className="text-xs text-slate-500">{model.provider}</span>
                  </div>
               </div>
               <div className="text-right whitespace-nowrap">
                  <span className="text-xs text-slate-500 block mb-1">Disk Size</span>
                  <span className="text-sm font-mono text-slate-300">{model.size}</span>
               </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-4 mb-6 py-4 border-y border-slate-800/50">
               <div>
                 <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">Parameters</span>
                 <span className="text-sm text-slate-200 font-mono">{model.parameters}</span>
               </div>
               <div>
                 <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">Quantization</span>
                 <span className="text-sm text-slate-200 font-mono">{model.quantization}</span>
               </div>
               <div className="min-w-0">
                 <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">Format</span>
                 <span className="text-sm text-slate-200 font-mono truncate block" title={model.format}>{model.format}</span>
               </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Modified: {model.lastModified}</span>
              <div className="flex items-center gap-1">
                 <Link 
                    to={`/models/${encodeURIComponent(model.id)}`} 
                    state={{ model }}
                    className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                 >
                    <Info size={16} />
                 </Link>
                 <button className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
                    <Copy size={16} />
                 </button>
                 <button className="p-2 text-red-400/70 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors">
                    <Trash2 size={16} />
                 </button>
              </div>
            </div>
            
            {/* Decorative bg gradient */}
            <div className="absolute -top-10 -right-10 w-32 h-32 bg-blue-500/5 rounded-full blur-3xl group-hover:bg-blue-500/10 transition-colors pointer-events-none"></div>

          </div>
        ))}
      </div>

      <div className="mt-8 pt-4 border-t border-slate-800 flex items-center justify-between text-xs text-slate-500">
         <div className="flex gap-4">
            <span>TOTAL MODELS: {models.length}</span>
         </div>
         <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${!error ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
            <span>{error ? 'CONNECTION FAILED' : 'vLLM ENGINE ACTIVE'}</span>
         </div>
      </div>
    </div>
  );
};

export default Models;
