import React from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import { MOCK_MODELS } from '../services/mockData';
import { ArrowLeft, Share2, Download, Play, Sliders, Cpu, HardDrive, Maximize, Copy } from 'lucide-react';
import { Model } from '../types';

const ModelDetail = () => {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  
  // Try to get model from navigation state, then ID match in mocks, then fallback to basic object
  const model: Model = location.state?.model || 
    MOCK_MODELS.find(m => m.id === id) || 
    {
      id: id || 'unknown',
      name: id || 'Unknown Model',
      provider: 'Unknown Provider',
      size: 'N/A',
      quantization: 'N/A',
      format: 'Unknown',
      lastModified: 'N/A',
      parameters: 'N/A',
      contextWindow: 0,
      vram: 'N/A',
      description: 'Model details not available.',
      tags: ['UNKNOWN']
    };

  return (
    <div className="h-screen overflow-y-auto bg-slate-950 p-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-4 mb-8">
        <Link to="/models" className="p-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
          <ArrowLeft size={16} />
        </Link>
        <div>
           <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
             <Link to="/models" className="hover:text-slate-300">Models</Link> 
             <span>/</span> 
             <span className="text-blue-400">{model.id}</span>
           </div>
           <div className="flex items-center gap-3">
             <h1 className="text-2xl font-bold text-white">{model.name}</h1>
             <span className="bg-blue-500/20 text-blue-400 text-xs font-bold px-2 py-0.5 rounded uppercase">{model.provider}</span>
           </div>
        </div>
        <div className="ml-auto flex gap-3">
           <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-300 bg-slate-900 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors">
              <Share2 size={16} /> Share
           </button>
           <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-300 bg-slate-900 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors">
              <Download size={16} /> Download
           </button>
           <Link to="/playground" className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors shadow-lg shadow-blue-900/30">
              <Play size={16} /> Run Model
           </Link>
        </div>
      </div>

      {/* Top Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Parameters', value: model.parameters, icon: Sliders, sub: 'Full precision weights' },
          { label: 'Quantization', value: model.quantization, icon: Cpu, sub: 'Balanced performance' },
          { label: 'Context Window', value: model.contextWindow.toLocaleString(), icon: Maximize, sub: 'Max sequence length' },
          { label: 'VRAM Usage', value: model.vram, icon: HardDrive, sub: 'Required GPU memory' },
        ].map((stat, i) => (
          <div key={i} className="bg-slate-900 border border-slate-800 p-5 rounded-xl">
             <div className="flex justify-between items-start mb-2">
                <span className="text-slate-400 text-sm font-medium">{stat.label}</span>
                <stat.icon size={16} className="text-blue-500" />
             </div>
             <div className="text-2xl font-bold text-white mb-1">{stat.value}</div>
             <div className="text-xs text-slate-500">{stat.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Col: Modelfile */}
        <div className="lg:col-span-2 space-y-8">
          
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
               <h3 className="font-bold text-white flex items-center gap-2">
                 <div className="w-1 h-4 bg-blue-500 rounded-full"></div> Modelfile
               </h3>
               <button className="text-xs text-blue-400 hover:text-blue-300 font-medium">Copy Code</button>
            </div>
            <div className="p-0 overflow-x-auto bg-[#0B1120]">
              <pre className="text-sm font-mono text-slate-300 p-5 leading-relaxed">
{`FROM ${model.id}
PARAMETER temperature 0.7
PARAMETER num_ctx 4096
PARAMETER top_p 0.9
PARAMETER stop "<|end_of_text|>"
TEMPLATE """{{ .System }}
User: {{ .Prompt }}
Assistant: """
SYSTEM "You are a helpful AI assistant specialized in coding."`}
              </pre>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
               <h3 className="font-bold text-white flex items-center gap-2">
                 <div className="w-1 h-4 bg-purple-500 rounded-full"></div> Model Metadata (JSON)
               </h3>
               <div className="text-xs text-slate-500 flex items-center gap-1 cursor-pointer hover:text-white">Expand all <Maximize size={10} /></div>
            </div>
            <div className="p-5 overflow-x-auto bg-[#0B1120]">
              <pre className="text-xs font-mono text-blue-300 leading-relaxed">
{JSON.stringify({
  model_id: model.id,
  metadata: {
    architecture: "llama",
    file_format: model.format,
    quantization: model.quantization,
    tags: model.tags
  },
  capabilities: [
    "text-generation",
    "chat-completion"
  ]
}, null, 2)}
              </pre>
            </div>
          </div>

        </div>

        {/* Right Col: Hyperparameters */}
        <div className="space-y-8">
           <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
             <div className="px-5 py-4 border-b border-slate-800 bg-slate-900/50">
                <h3 className="font-bold text-white flex items-center gap-2">
                  <Sliders size={16} className="text-slate-400" /> Hyperparameters
                </h3>
             </div>
             <div className="p-0">
               <table className="w-full text-sm">
                 <thead className="bg-slate-800/50 text-slate-400 text-xs uppercase font-medium">
                    <tr>
                      <th className="px-5 py-3 text-left">Parameter</th>
                      <th className="px-5 py-3 text-right">Value</th>
                    </tr>
                 </thead>
                 <tbody className="divide-y divide-slate-800">
                    {[
                      { k: 'Temperature', v: '0.70' },
                      { k: 'Top-P', v: '0.90' },
                      { k: 'Repeat Penalty', v: '1.10' },
                      { k: 'Frequency Penalty', v: '0.00' },
                      { k: 'Presence Penalty', v: '0.00' },
                      { k: 'Mirostat', v: '0' },
                      { k: 'Mirostat Tau', v: '5.0' },
                      { k: 'Mirostat Eta', v: '0.1' },
                    ].map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-800/30 transition-colors">
                        <td className="px-5 py-3 text-slate-300">{row.k}</td>
                        <td className="px-5 py-3 text-right font-mono text-slate-400">{row.v}</td>
                      </tr>
                    ))}
                 </tbody>
               </table>
             </div>
           </div>
        </div>

      </div>
    </div>
  );
};

export default ModelDetail;
