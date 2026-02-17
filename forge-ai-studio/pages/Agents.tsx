import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bot,
  Play,
  Pencil,
  Trash2,
  Loader2,
  Brain,
  Database,
  Thermometer,
  Plus,
  X,
  Square,
  Copy,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import { getAgents, deleteAgent, runAgent, Agent } from '../services/agentsApi';
import { parseThinkTags, renderMarkdownToHTML } from '../services/markdown';

const Agents = () => {
  const navigate = useNavigate();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Run modal state
  const [runningAgent, setRunningAgent] = useState<Agent | null>(null);
  const [variableInputs, setVariableInputs] = useState<Record<string, string>>({});
  const [runOutput, setRunOutput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  const fetchAgents = async () => {
    try {
      const result = await getAgents();
      setAgents(result.data);
    } catch (err) {
      console.error('Failed to load agents:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAgents();
  }, []);

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current && isRunning) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [runOutput, isRunning]);

  const handleRun = (agent: Agent) => {
    const c = agent.config;
    // Legacy agent without promptTemplate → navigate to Playground
    if (!c.promptTemplate) {
      navigate('/playground', { state: { agentConfig: c, agentName: agent.name } });
      return;
    }

    // Open run modal
    setRunningAgent(agent);
    setRunOutput('');
    setRunError(null);
    setCopied(false);

    // Pre-fill variable defaults
    const defaults: Record<string, string> = {};
    if (c.variables) {
      for (const v of c.variables) {
        defaults[v.name] = v.defaultValue || '';
      }
    }
    setVariableInputs(defaults);

    // If no variables, auto-start
    if (!c.variables || c.variables.length === 0) {
      startRun(agent, defaults);
    }
  };

  const startRun = (agent: Agent, vars: Record<string, string>) => {
    setIsRunning(true);
    setRunOutput('');
    setRunError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    runAgent(
      agent.id,
      vars,
      (chunk) => setRunOutput(prev => prev + chunk),
      () => {
        setIsRunning(false);
        abortRef.current = null;
      },
      (err) => {
        setRunError(err);
        setIsRunning(false);
        abortRef.current = null;
      },
      controller.signal,
    );
  };

  const handleStop = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      setIsRunning(false);
      abortRef.current = null;
    }
  };

  const handleCloseModal = () => {
    handleStop();
    setRunningAgent(null);
    setRunOutput('');
    setRunError(null);
    setVariableInputs({});
  };

  const handleCopyOutput = () => {
    navigator.clipboard.writeText(runOutput);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleEdit = (agent: Agent) => {
    navigate('/playground', { state: { agentConfig: agent.config, agentName: agent.name, agentId: agent.id } });
  };

  const handleDelete = async (agent: Agent) => {
    if (!confirm(`Delete agent "${agent.name}"?`)) return;
    setDeleting(agent.id);
    try {
      await deleteAgent(agent.id);
      setAgents(prev => prev.filter(a => a.id !== agent.id));
    } catch (err) {
      console.error('Failed to delete agent:', err);
    } finally {
      setDeleting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Bot size={28} className="text-blue-400" />
            Agents
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Saved Playground configurations. Run or edit anytime.
          </p>
        </div>
        <button
          onClick={() => navigate('/playground')}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
        >
          <Plus size={16} />
          New in Playground
        </button>
      </div>

      {/* Empty State */}
      {agents.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-slate-500">
          <Bot size={56} className="mb-4 opacity-30" />
          <p className="text-lg font-medium text-slate-400">No agents yet</p>
          <p className="text-sm mt-1">Save your first configuration from the Playground.</p>
        </div>
      )}

      {/* Agent Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {agents.map(agent => {
          const c = agent.config;
          return (
            <div
              key={agent.id}
              className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-colors group"
            >
              {/* Card Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <h3 className="text-white font-semibold text-base truncate">{agent.name}</h3>
                  {agent.description && (
                    <p className="text-xs text-slate-400 mt-1 line-clamp-2">{agent.description}</p>
                  )}
                </div>
              </div>

              {/* Model Badge */}
              <div className="mb-3">
                <span className="text-[11px] font-mono px-2 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700">
                  {c.selectedModel || 'No model'}
                </span>
              </div>

              {/* Config Summary */}
              <div className="flex flex-wrap gap-2 mb-4">
                <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700/50">
                  <Thermometer size={10} />
                  temp {c.temperature}
                </span>
                {c.thinking && (
                  <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-purple-900/30 text-purple-400 border border-purple-900/50">
                    <Brain size={10} />
                    Thinking
                  </span>
                )}
                {c.ragEnabled && (
                  <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-900/30 text-amber-400 border border-amber-900/50">
                    <Database size={10} />
                    RAG
                  </span>
                )}
                {c.jsonMode && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-900/30 text-emerald-400 border border-emerald-900/50">
                    JSON
                  </span>
                )}
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-500 border border-slate-700/50">
                  max {c.maxTokens}
                </span>
              </div>

              {/* Prompt Template Preview */}
              {c.promptTemplate && (
                <div className="mb-3 p-2.5 bg-slate-950/50 rounded-lg border border-slate-800">
                  <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">Prompt Template</p>
                  <p className="text-xs text-slate-400 line-clamp-2 font-mono leading-relaxed">
                    {c.promptTemplate}
                  </p>
                  {c.variables && c.variables.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {c.variables.map(v => (
                        <span key={v.name} className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-900/30 text-blue-400 border border-blue-900/50 font-mono">
                          {`{{${v.name}}}`}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* System Prompt Preview */}
              {c.systemPrompt && (
                <div className="mb-4 p-2.5 bg-slate-950/50 rounded-lg border border-slate-800">
                  <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">System Prompt</p>
                  <p className="text-xs text-slate-400 line-clamp-2 font-mono leading-relaxed">
                    {c.systemPrompt}
                  </p>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 pt-3 border-t border-slate-800">
                <button
                  onClick={() => handleRun(agent)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-md transition-colors"
                >
                  <Play size={12} className="fill-current" /> Run
                </button>
                <button
                  onClick={() => handleEdit(agent)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-md transition-colors border border-slate-700"
                >
                  <Pencil size={12} /> Edit
                </button>
                <div className="flex-1" />
                <button
                  onClick={() => handleDelete(agent)}
                  disabled={deleting === agent.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-md transition-colors disabled:opacity-50"
                >
                  {deleting === agent.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  Delete
                </button>
              </div>

              {/* Timestamp */}
              <p className="text-[10px] text-slate-600 mt-2">
                Updated {new Date(agent.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          );
        })}
      </div>

      {/* Run Modal */}
      {runningAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Play size={16} className="text-blue-400 fill-current shrink-0" />
                  <h3 className="text-white font-semibold truncate">Run: {runningAgent.name}</h3>
                </div>
                {runningAgent.description && (
                  <p className="text-xs text-slate-400 mt-1 truncate">{runningAgent.description}</p>
                )}
              </div>
              <button onClick={handleCloseModal} className="text-slate-400 hover:text-white ml-4">
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* Variable Inputs */}
              {runningAgent.config.variables && runningAgent.config.variables.length > 0 && (
                <div className="space-y-3">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Variables</p>
                  {runningAgent.config.variables.map(v => (
                    <div key={v.name}>
                      <label className="text-xs text-slate-300 block mb-1 font-medium">{v.label || v.name}</label>
                      {(v.defaultValue?.length ?? 0) > 80 ? (
                        <textarea
                          value={variableInputs[v.name] || ''}
                          onChange={(e) => setVariableInputs(prev => ({ ...prev, [v.name]: e.target.value }))}
                          rows={3}
                          placeholder={v.defaultValue || `Enter ${v.name}...`}
                          disabled={isRunning}
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:ring-2 focus:ring-blue-500 outline-none resize-none font-mono disabled:opacity-50"
                        />
                      ) : (
                        <input
                          type="text"
                          value={variableInputs[v.name] || ''}
                          onChange={(e) => setVariableInputs(prev => ({ ...prev, [v.name]: e.target.value }))}
                          placeholder={v.defaultValue || `Enter ${v.name}...`}
                          disabled={isRunning}
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:ring-2 focus:ring-blue-500 outline-none font-mono disabled:opacity-50"
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Error */}
              {runError && (
                <div className="bg-red-900/20 border border-red-900/50 p-3 rounded-lg text-red-200 text-sm">
                  {runError}
                </div>
              )}

              {/* Output */}
              {(runOutput || isRunning) && (
                <div>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Output</p>
                  <div
                    ref={outputRef}
                    className="bg-slate-950 border border-slate-800 rounded-lg p-4 max-h-[40vh] overflow-y-auto"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-7 h-7 bg-blue-600 rounded-lg flex-shrink-0 flex items-center justify-center shadow-lg shadow-blue-900/20">
                        <Sparkles className="text-white w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1 min-w-0 text-slate-300 text-sm leading-relaxed break-words">
                        {(() => {
                          const parsed = parseThinkTags(runOutput);
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
                        {isRunning && <span className="inline-block w-2 h-4 bg-blue-500 ml-1 animate-pulse" />}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800">
              <div className="flex items-center gap-2">
                {isRunning ? (
                  <button
                    onClick={handleStop}
                    className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors"
                  >
                    <Square size={12} className="fill-current" /> Stop
                  </button>
                ) : (
                  <button
                    onClick={() => startRun(runningAgent, variableInputs)}
                    className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
                  >
                    <Play size={12} className="fill-current" /> {runOutput ? 'Re-run' : 'Run'}
                  </button>
                )}
                <button
                  onClick={handleCloseModal}
                  className="px-4 py-2 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors border border-slate-700"
                >
                  Close
                </button>
              </div>
              <button
                onClick={handleCopyOutput}
                disabled={!runOutput || isRunning}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors border border-slate-700 disabled:opacity-50"
              >
                {copied ? <><CheckCircle2 size={12} className="text-emerald-400" /> Copied!</> : <><Copy size={12} /> Copy</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Agents;
