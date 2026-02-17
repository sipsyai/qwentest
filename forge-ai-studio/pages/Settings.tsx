import React, { useState, useEffect } from 'react';
import { Save, Server, ShieldCheck, RefreshCw, Cpu, CheckCircle2 } from 'lucide-react';
import { getChatBaseUrl, getEmbedBaseUrl, getChatFallbackUrl, getEmbedFallbackUrl, getApiKey, setConfig } from '../services/vllm';

const Settings = () => {
  const [chatUrl, setChatUrl] = useState('');
  const [embedUrl, setEmbedUrl] = useState('');
  const [chatFallbackUrl, setChatFallbackUrl] = useState('');
  const [embedFallbackUrl, setEmbedFallbackUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [chatStatus, setChatStatus] = useState<'idle' | 'checking' | 'online' | 'offline'>('idle');
  const [embedStatus, setEmbedStatus] = useState<'idle' | 'checking' | 'online' | 'offline'>('idle');

  useEffect(() => {
    setChatUrl(getChatBaseUrl());
    setEmbedUrl(getEmbedBaseUrl());
    setChatFallbackUrl(getChatFallbackUrl());
    setEmbedFallbackUrl(getEmbedFallbackUrl());
    setApiKey(getApiKey());
  }, []);

  const handleSave = () => {
    setConfig(chatUrl, embedUrl, apiKey, chatFallbackUrl, embedFallbackUrl);
    setStatus('success');
    setTimeout(() => setStatus('idle'), 2000);
  };

  const testConnection = async (url: string, setter: (s: 'idle' | 'checking' | 'online' | 'offline') => void) => {
    setter('checking');
    try {
      const res = await fetch(`${url}/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      setter(res.ok ? 'online' : 'offline');
    } catch {
      setter('offline');
    }
    setTimeout(() => setter('idle'), 4000);
  };

  const statusBadge = (s: 'idle' | 'checking' | 'online' | 'offline') => {
    if (s === 'checking') return <span className="text-xs text-yellow-400 animate-pulse">Testing...</span>;
    if (s === 'online') return <span className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle2 size={12} /> Connected</span>;
    if (s === 'offline') return <span className="text-xs text-red-400">Connection Failed</span>;
    return null;
  };

  return (
    <div className="p-8 h-screen overflow-y-auto bg-slate-950">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-2">AI Configuration</h1>
        <p className="text-slate-400 text-sm">Configure your connection to the vLLM servers.</p>
      </div>

      <div className="max-w-2xl space-y-6">
        {/* Chat Server Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-800">
            <div className="p-2 bg-blue-500/20 rounded-lg text-blue-400">
              <Server size={20} />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-bold text-white">Chat / Completion Server</h3>
              <p className="text-xs text-slate-500">vLLM instance for chat completions (e.g. Qwen3-4B)</p>
            </div>
            {statusBadge(chatStatus)}
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Chat API URL</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={chatUrl}
                  onChange={(e) => setChatUrl(e.target.value)}
                  placeholder="/api/chat or http://192.168.1.8:8010/v1"
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-sm text-white focus:ring-2 focus:ring-blue-500 outline-none font-mono"
                />
                <button
                  onClick={() => testConnection(chatUrl, setChatStatus)}
                  className="px-4 py-2 text-xs font-bold text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition-colors"
                >
                  Test
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Default: <code>/api/chat</code> (proxied via Vite). Direct: <code>http://192.168.1.8:8010/v1</code>
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Fallback URL <span className="text-slate-500 font-normal">(optional)</span></label>
              <input
                type="text"
                value={chatFallbackUrl}
                onChange={(e) => setChatFallbackUrl(e.target.value)}
                placeholder="http://100.96.50.76:8010/v1"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-sm text-white focus:ring-2 focus:ring-blue-500 outline-none font-mono"
              />
              <p className="mt-2 text-xs text-slate-500">
                Network hatası durumunda otomatik olarak bu URL denenir (ör. Tailscale IP).
              </p>
            </div>
          </div>
        </div>

        {/* Embed Server Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-800">
            <div className="p-2 bg-purple-500/20 rounded-lg text-purple-400">
              <Cpu size={20} />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-bold text-white">Embedding Server</h3>
              <p className="text-xs text-slate-500">vLLM instance for embeddings (e.g. nomic-embed-text)</p>
            </div>
            {statusBadge(embedStatus)}
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Embed API URL</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={embedUrl}
                  onChange={(e) => setEmbedUrl(e.target.value)}
                  placeholder="/api/embed or http://192.168.1.8:8011/v1"
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-sm text-white focus:ring-2 focus:ring-blue-500 outline-none font-mono"
                />
                <button
                  onClick={() => testConnection(embedUrl, setEmbedStatus)}
                  className="px-4 py-2 text-xs font-bold text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition-colors"
                >
                  Test
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Default: <code>/api/embed</code> (proxied via Vite). Direct: <code>http://192.168.1.8:8011/v1</code>
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Fallback URL <span className="text-slate-500 font-normal">(optional)</span></label>
              <input
                type="text"
                value={embedFallbackUrl}
                onChange={(e) => setEmbedFallbackUrl(e.target.value)}
                placeholder="http://100.96.50.76:8011/v1"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-sm text-white focus:ring-2 focus:ring-blue-500 outline-none font-mono"
              />
              <p className="mt-2 text-xs text-slate-500">
                Network hatası durumunda otomatik olarak bu URL denenir (ör. Tailscale IP).
              </p>
            </div>
          </div>
        </div>

        {/* API Key Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-800">
            <div className="p-2 bg-amber-500/20 rounded-lg text-amber-400">
              <ShieldCheck size={20} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Authentication</h3>
              <p className="text-xs text-slate-500">API key for both servers (shared)</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="EMPTY or sk-..."
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-sm text-white focus:ring-2 focus:ring-blue-500 outline-none font-mono"
            />
            <p className="mt-2 text-xs text-slate-500">
              Leave as "EMPTY" for local vLLM servers without auth.
            </p>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex items-center justify-end gap-4">
          {status === 'success' && (
            <span className="text-emerald-400 text-sm font-medium flex items-center gap-1">
              <CheckCircle2 size={14} /> Settings Saved!
            </span>
          )}
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-6 py-2.5 text-sm font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors shadow-lg shadow-blue-900/30"
          >
            <Save size={16} /> Save Configuration
          </button>
        </div>

        {/* Info Card */}
        <div className="bg-blue-900/10 border border-blue-900/30 rounded-xl p-4 flex gap-4">
          <div className="text-blue-400 mt-1"><RefreshCw size={20} /></div>
          <div>
            <h4 className="text-blue-200 font-bold text-sm mb-1">CORS Issue?</h4>
            <p className="text-blue-300/70 text-xs leading-relaxed">
              If accessing vLLM directly (not via proxy), launch vLLM with:
              <code className="bg-blue-950/50 px-1 py-0.5 rounded border border-blue-900/50 mt-1 block w-fit">--allowed-origins="*"</code>
              Or use the default proxy URLs (<code>/api/chat</code> and <code>/api/embed</code>) which bypass CORS via Vite dev server.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
