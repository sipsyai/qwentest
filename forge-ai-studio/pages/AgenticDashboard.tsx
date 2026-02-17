import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Zap,
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
  Wrench,
  Search,
  Globe,
  Bot,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Info,
  ArrowRight,
  Settings2,
} from 'lucide-react';
import {
  getAgents,
  deleteAgent,
  runAgentAgentic,
  getAvailableTools,
  Agent,
  AgentStep,
  ToolInfo,
} from '../services/agentsApi';
import { parseThinkTags, renderMarkdownToHTML } from '../services/markdown';

// Tool icon mapping (larger)
const toolIconsLg: Record<string, React.ReactNode> = {
  kb_search: <Search size={18} className="text-amber-400" />,
  dataset_query: <Database size={18} className="text-emerald-400" />,
  web_fetch: <Globe size={18} className="text-blue-400" />,
  sub_agent: <Bot size={18} className="text-purple-400" />,
};

const toolIconsSm: Record<string, React.ReactNode> = {
  kb_search: <Search size={12} className="text-amber-400" />,
  dataset_query: <Database size={12} className="text-emerald-400" />,
  web_fetch: <Globe size={12} className="text-blue-400" />,
  sub_agent: <Bot size={12} className="text-purple-400" />,
};

const AgenticDashboard = () => {
  const navigate = useNavigate();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Selected agent for the workspace
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);

  // Execution state
  const [variableInputs, setVariableInputs] = useState<Record<string, string>>({});
  const [runOutput, setRunOutput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  // Agentic step tracking
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [currentIteration, setCurrentIteration] = useState(0);
  const [maxIterations, setMaxIterations] = useState(10);
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const [doneInfo, setDoneInfo] = useState<{
    iterations: number;
    tools_used: string[];
    total_tool_calls: number;
  } | null>(null);

  // Tab state for tools panel
  const [rightTab, setRightTab] = useState<'tools' | 'config'>('tools');

  const fetchData = async () => {
    try {
      const [agentsRes, toolsRes] = await Promise.all([
        getAgents(),
        getAvailableTools().catch(() => []),
      ]);
      // Only show agentic agents
      const agenticAgents = agentsRes.data.filter(
        (a) => a.config.agentMode === 'react' && a.config.enabledTools?.length > 0
      );
      setAgents(agenticAgents);
      setTools(toolsRes);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (outputRef.current && isRunning) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [runOutput, isRunning, steps]);

  const selectAgent = (agent: Agent) => {
    handleStop();
    setSelectedAgent(agent);
    setRunOutput('');
    setRunError(null);
    setSteps([]);
    setCurrentIteration(0);
    setDoneInfo(null);
    setCopied(false);

    const defaults: Record<string, string> = {};
    if (agent.config.variables) {
      for (const v of agent.config.variables) {
        defaults[v.name] = v.defaultValue || '';
      }
    }
    setVariableInputs(defaults);
  };

  const startRun = () => {
    if (!selectedAgent) return;
    setIsRunning(true);
    setRunOutput('');
    setRunError(null);
    setSteps([]);
    setCurrentIteration(0);
    setDoneInfo(null);
    setExpandedSteps(new Set());
    setCopied(false);

    const controller = new AbortController();
    abortRef.current = controller;

    runAgentAgentic(
      selectedAgent.id,
      variableInputs,
      {
        onAgentStart: (data) => {
          setMaxIterations(data.max_iterations);
          setSteps((prev) => [
            ...prev,
            { type: 'agent_start', data, timestamp: Date.now() },
          ]);
        },
        onIterationStart: (data) => {
          setCurrentIteration(data.iteration);
          setSteps((prev) => [
            ...prev,
            { type: 'iteration_start', data, timestamp: Date.now() },
          ]);
        },
        onToolCall: (data) => {
          setSteps((prev) => {
            const newSteps = [
              ...prev,
              { type: 'tool_call' as const, data, timestamp: Date.now() },
            ];
            setExpandedSteps((es) => new Set([...es, newSteps.length - 1]));
            return newSteps;
          });
        },
        onToolResult: (data) => {
          setSteps((prev) => [
            ...prev,
            { type: 'tool_result' as const, data, timestamp: Date.now() },
          ]);
        },
        onFinalAnswerStart: (data) => {
          setSteps((prev) => [
            ...prev,
            { type: 'final_answer_start' as const, data, timestamp: Date.now() },
          ]);
        },
        onStream: (data) => {
          setRunOutput((prev) => prev + data.content);
        },
        onAgentDone: (data) => {
          setDoneInfo(data);
          setSteps((prev) => [
            ...prev,
            { type: 'agent_done' as const, data, timestamp: Date.now() },
          ]);
          setIsRunning(false);
          abortRef.current = null;
        },
        onError: (data) => {
          setRunError(data.message);
          setSteps((prev) => [
            ...prev,
            { type: 'error' as const, data, timestamp: Date.now() },
          ]);
          setIsRunning(false);
          abortRef.current = null;
        },
        onChunk: (chunk) => {
          setRunOutput((prev) => prev + chunk);
        },
        onComplete: () => {
          setIsRunning(false);
          abortRef.current = null;
        },
      },
      controller.signal
    );
  };

  const handleStop = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      setIsRunning(false);
      abortRef.current = null;
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(runOutput);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDelete = async (agent: Agent) => {
    if (!confirm(`Delete agent "${agent.name}"?`)) return;
    setDeleting(agent.id);
    try {
      await deleteAgent(agent.id);
      setAgents((prev) => prev.filter((a) => a.id !== agent.id));
      if (selectedAgent?.id === agent.id) {
        setSelectedAgent(null);
        setRunOutput('');
        setSteps([]);
      }
    } catch (err) {
      console.error('Failed to delete agent:', err);
    } finally {
      setDeleting(null);
    }
  };

  const toggleStep = (index: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-screen">
      {/* LEFT PANEL — Agent List */}
      <div className="w-72 border-r border-slate-800 flex flex-col bg-slate-900/50 shrink-0">
        {/* Panel Header */}
        <div className="px-4 py-4 border-b border-slate-800">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Zap size={16} className="text-blue-400" />
            Agentic Agents
          </h2>
          <p className="text-[10px] text-slate-500 mt-1">
            {agents.length} agent{agents.length !== 1 ? 's' : ''} with ReAct tools
          </p>
        </div>

        {/* Agent List */}
        <div className="flex-1 overflow-y-auto py-2">
          {agents.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Zap size={32} className="text-slate-700 mx-auto mb-3" />
              <p className="text-xs text-slate-500">No agentic agents yet</p>
              <p className="text-[10px] text-slate-600 mt-1">
                Create one in Playground with Agentic Mode enabled
              </p>
              <button
                onClick={() => navigate('/playground')}
                className="mt-3 text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-1 mx-auto"
              >
                Go to Playground <ArrowRight size={10} />
              </button>
            </div>
          ) : (
            agents.map((agent) => {
              const isSelected = selectedAgent?.id === agent.id;
              const c = agent.config;
              return (
                <button
                  key={agent.id}
                  onClick={() => selectAgent(agent)}
                  className={`w-full text-left px-4 py-3 transition-colors border-l-2 ${
                    isSelected
                      ? 'bg-blue-600/10 border-blue-500 text-white'
                      : 'border-transparent text-slate-300 hover:bg-slate-800/50 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate flex-1">
                      {agent.name}
                    </span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-400 border border-blue-900/50 font-medium shrink-0">
                      {c.enabledTools?.length || 0}T
                    </span>
                  </div>
                  {agent.description && (
                    <p className="text-[10px] text-slate-500 truncate mt-0.5">
                      {agent.description}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {c.enabledTools?.slice(0, 3).map((t) => (
                      <span
                        key={t}
                        className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/50"
                      >
                        {t}
                      </span>
                    ))}
                    {(c.enabledTools?.length || 0) > 3 && (
                      <span className="text-[9px] text-slate-600">
                        +{c.enabledTools!.length - 3}
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Bottom actions */}
        <div className="px-4 py-3 border-t border-slate-800">
          <button
            onClick={() => navigate('/playground')}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
          >
            <Plus size={14} />
            New Agentic Agent
          </button>
        </div>
      </div>

      {/* CENTER — Workspace */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selectedAgent ? (
          /* Empty workspace state */
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Zap size={48} className="text-slate-800 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-slate-400">
                Select an Agent
              </h3>
              <p className="text-sm text-slate-600 mt-1">
                Choose an agentic agent from the left panel to run
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Agent Header */}
            <div className="px-6 py-4 border-b border-slate-800 bg-slate-900/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 bg-blue-600/20 border border-blue-600/30 rounded-xl flex items-center justify-center shrink-0">
                    <Zap size={20} className="text-blue-400" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="text-white font-bold text-lg truncate">
                        {selectedAgent.name}
                      </h2>
                      {isRunning && currentIteration > 0 && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-900/30 text-blue-400 border border-blue-900/50 font-mono animate-pulse">
                          iter {currentIteration}/{maxIterations}
                        </span>
                      )}
                    </div>
                    {selectedAgent.description && (
                      <p className="text-xs text-slate-400 truncate">
                        {selectedAgent.description}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() =>
                      navigate('/playground', {
                        state: {
                          agentConfig: selectedAgent.config,
                          agentName: selectedAgent.name,
                          agentId: selectedAgent.id,
                        },
                      })
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-md transition-colors border border-slate-700"
                  >
                    <Pencil size={12} /> Edit
                  </button>
                  <button
                    onClick={() => handleDelete(selectedAgent)}
                    disabled={deleting === selectedAgent.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-md transition-colors disabled:opacity-50"
                  >
                    {deleting === selectedAgent.id ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Trash2 size={12} />
                    )}
                  </button>
                </div>
              </div>

              {/* Config badges */}
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                  {selectedAgent.config.selectedModel || 'No model'}
                </span>
                <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
                  <Thermometer size={10} />
                  {selectedAgent.config.temperature}
                </span>
                {selectedAgent.config.thinking && (
                  <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-purple-900/30 text-purple-400 border border-purple-900/50">
                    <Brain size={10} /> Thinking
                  </span>
                )}
                {selectedAgent.config.ragEnabled && (
                  <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-900/30 text-amber-400 border border-amber-900/50">
                    <Database size={10} /> RAG
                  </span>
                )}
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-500">
                  max {selectedAgent.config.maxTokens} tok
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-900/30 text-blue-400 border border-blue-900/50">
                  max {selectedAgent.config.maxIterations || 10} iter
                </span>
              </div>
            </div>

            {/* Variable Inputs + Run */}
            {selectedAgent.config.variables &&
              selectedAgent.config.variables.length > 0 && (
                <div className="px-6 py-4 border-b border-slate-800 bg-slate-900/20">
                  <div className="flex items-end gap-3">
                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {selectedAgent.config.variables.map((v) => (
                        <div key={v.name}>
                          <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">
                            {v.label || v.name}
                          </label>
                          {(v.defaultValue?.length ?? 0) > 80 ? (
                            <textarea
                              value={variableInputs[v.name] || ''}
                              onChange={(e) =>
                                setVariableInputs((prev) => ({
                                  ...prev,
                                  [v.name]: e.target.value,
                                }))
                              }
                              rows={2}
                              placeholder={
                                v.defaultValue || `Enter ${v.name}...`
                              }
                              disabled={isRunning}
                              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500 outline-none resize-none font-mono disabled:opacity-50"
                            />
                          ) : (
                            <input
                              type="text"
                              value={variableInputs[v.name] || ''}
                              onChange={(e) =>
                                setVariableInputs((prev) => ({
                                  ...prev,
                                  [v.name]: e.target.value,
                                }))
                              }
                              placeholder={
                                v.defaultValue || `Enter ${v.name}...`
                              }
                              disabled={isRunning}
                              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500 outline-none font-mono disabled:opacity-50"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

            {/* Action Bar */}
            <div className="px-6 py-3 border-b border-slate-800 flex items-center gap-3 bg-slate-900/10">
              {isRunning ? (
                <button
                  onClick={handleStop}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors"
                >
                  <Square size={12} className="fill-current" /> Stop
                </button>
              ) : (
                <button
                  onClick={startRun}
                  className="flex items-center gap-1.5 px-5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
                >
                  <Play size={12} className="fill-current" />{' '}
                  {runOutput ? 'Re-run' : 'Run Agent'}
                </button>
              )}

              {runOutput && !isRunning && (
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors border border-slate-700"
                >
                  {copied ? (
                    <>
                      <CheckCircle2
                        size={12}
                        className="text-emerald-400"
                      />{' '}
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy size={12} /> Copy Output
                    </>
                  )}
                </button>
              )}

              {doneInfo && (
                <span className="text-[11px] text-emerald-400 flex items-center gap-1 ml-auto">
                  <CheckCircle2 size={12} />
                  {doneInfo.iterations} iter, {doneInfo.total_tool_calls} tool
                  call{doneInfo.total_tool_calls !== 1 ? 's' : ''}
                </span>
              )}

              {isRunning && (
                <span className="text-[11px] text-blue-400 flex items-center gap-1 ml-auto animate-pulse">
                  <Loader2 size={12} className="animate-spin" />
                  Processing...
                </span>
              )}
            </div>

            {/* Execution Area — Steps + Output */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4" ref={outputRef}>
              {/* Error */}
              {runError && (
                <div className="bg-red-900/20 border border-red-900/50 p-3 rounded-lg text-red-200 text-sm">
                  {runError}
                </div>
              )}

              {/* Steps */}
              {steps.length > 0 && (
                <div className="space-y-1.5">
                  {steps.map((step, i) => {
                    switch (step.type) {
                      case 'agent_start':
                        return (
                          <div
                            key={i}
                            className="flex items-center gap-2 text-[11px] text-slate-500"
                          >
                            <Zap size={11} className="text-blue-400" />
                            <span>
                              Agent started in{' '}
                              <span className="text-blue-400 font-medium">
                                {step.data.mode}
                              </span>{' '}
                              mode
                            </span>
                            {step.data.tools?.length > 0 && (
                              <span className="text-slate-600">
                                ({step.data.tools.length} tools)
                              </span>
                            )}
                          </div>
                        );

                      case 'iteration_start':
                        return (
                          <div
                            key={i}
                            className="flex items-center gap-2 text-[11px] text-slate-500 mt-3 pt-3 border-t border-slate-800/50"
                          >
                            <RotateCcw size={10} className="text-slate-500" />
                            <span className="font-medium">
                              Iteration {step.data.iteration}/{maxIterations}
                            </span>
                          </div>
                        );

                      case 'tool_call': {
                        const isExpanded = expandedSteps.has(i);
                        const resultStep = steps.find(
                          (s, j) =>
                            j > i &&
                            s.type === 'tool_result' &&
                            s.data.call_id === step.data.call_id
                        );
                        return (
                          <div
                            key={i}
                            className="bg-slate-800/50 border border-slate-700/50 rounded-lg overflow-hidden"
                          >
                            <button
                              onClick={() => toggleStep(i)}
                              className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-slate-800/80 transition-colors"
                            >
                              {isExpanded ? (
                                <ChevronDown
                                  size={12}
                                  className="text-slate-500 shrink-0"
                                />
                              ) : (
                                <ChevronRight
                                  size={12}
                                  className="text-slate-500 shrink-0"
                                />
                              )}
                              {toolIconsSm[step.data.tool] || (
                                <Wrench
                                  size={12}
                                  className="text-slate-400"
                                />
                              )}
                              <span className="text-xs font-medium text-slate-300">
                                {step.data.tool}
                              </span>
                              <span className="text-[10px] text-slate-500 font-mono truncate flex-1">
                                {JSON.stringify(step.data.args).slice(0, 100)}
                              </span>
                              {resultStep ? (
                                <CheckCircle2
                                  size={11}
                                  className="text-emerald-500 shrink-0"
                                />
                              ) : (
                                <Loader2
                                  size={11}
                                  className="text-blue-400 animate-spin shrink-0"
                                />
                              )}
                            </button>
                            {isExpanded && (
                              <div className="px-3 pb-3 space-y-2 border-t border-slate-700/30">
                                <div className="mt-2">
                                  <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">
                                    Arguments
                                  </p>
                                  <pre className="text-[11px] text-slate-400 font-mono bg-slate-950/50 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                                    {JSON.stringify(step.data.args, null, 2)}
                                  </pre>
                                </div>
                                {resultStep && (
                                  <div>
                                    <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">
                                      Result
                                    </p>
                                    <pre className="text-[11px] text-slate-400 font-mono bg-slate-950/50 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
                                      {resultStep.data.result}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      }

                      case 'tool_result':
                        return null;

                      case 'final_answer_start':
                        return (
                          <div
                            key={i}
                            className="flex items-center gap-2 text-[11px] text-emerald-400 mt-3 pt-3 border-t border-slate-800/50"
                          >
                            <Sparkles size={11} />
                            <span className="font-medium">
                              Generating final answer...
                            </span>
                          </div>
                        );

                      case 'agent_done':
                        return (
                          <div
                            key={i}
                            className="flex items-center gap-2 text-[11px] text-slate-500 mt-2 pt-2 border-t border-slate-800"
                          >
                            <CheckCircle2
                              size={11}
                              className="text-emerald-500"
                            />
                            <span>
                              Completed in {step.data.iterations} iteration
                              {step.data.iterations > 1 ? 's' : ''}
                              {step.data.total_tool_calls > 0 && (
                                <span className="text-slate-600">
                                  {' '}
                                  | {step.data.total_tool_calls} tool call
                                  {step.data.total_tool_calls > 1 ? 's' : ''}
                                </span>
                              )}
                            </span>
                          </div>
                        );

                      case 'error':
                        return (
                          <div
                            key={i}
                            className="bg-red-900/20 border border-red-900/50 rounded-lg px-3 py-2 text-xs text-red-300"
                          >
                            {step.data.message}
                          </div>
                        );

                      default:
                        return null;
                    }
                  })}
                </div>
              )}

              {/* Final Answer Output */}
              {(runOutput || (isRunning && steps.some(s => s.type === 'final_answer_start'))) && (
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-5">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 bg-blue-600 rounded-lg flex-shrink-0 flex items-center justify-center shadow-lg shadow-blue-900/20">
                      <Sparkles className="text-white w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0 text-slate-300 text-sm leading-relaxed break-words">
                      {(() => {
                        const parsed = parseThinkTags(runOutput);
                        return (
                          <>
                            {parsed.thinking && (
                              <details
                                open
                                className="bg-purple-900/10 border border-purple-900/30 rounded-lg p-3 mb-3"
                              >
                                <summary className="text-xs font-bold text-purple-400 cursor-pointer">
                                  Thinking...
                                </summary>
                                <div className="mt-2 text-xs text-purple-300/70 whitespace-pre-wrap font-mono">
                                  {parsed.thinking}
                                </div>
                              </details>
                            )}
                            <div
                              dangerouslySetInnerHTML={{
                                __html: renderMarkdownToHTML(parsed.content),
                              }}
                            />
                          </>
                        );
                      })()}
                      {isRunning && (
                        <span className="inline-block w-2 h-4 bg-blue-500 ml-1 animate-pulse" />
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Empty run state */}
              {!isRunning && !runOutput && steps.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-slate-600">
                  <Play size={36} className="mb-3 opacity-30" />
                  <p className="text-sm">
                    Click <span className="text-blue-400">Run Agent</span> to
                    start execution
                  </p>
                  <p className="text-[11px] text-slate-700 mt-1">
                    The agent will reason, call tools, and produce a final
                    answer
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* RIGHT PANEL — Tools & Config */}
      <div className="w-72 border-l border-slate-800 flex flex-col bg-slate-900/50 shrink-0">
        {/* Tabs */}
        <div className="flex border-b border-slate-800">
          <button
            onClick={() => setRightTab('tools')}
            className={`flex-1 px-4 py-3 text-xs font-medium transition-colors ${
              rightTab === 'tools'
                ? 'text-blue-400 border-b-2 border-blue-500 bg-blue-600/5'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <Wrench size={12} className="inline mr-1.5" />
            Tool Registry
          </button>
          <button
            onClick={() => setRightTab('config')}
            className={`flex-1 px-4 py-3 text-xs font-medium transition-colors ${
              rightTab === 'config'
                ? 'text-blue-400 border-b-2 border-blue-500 bg-blue-600/5'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <Settings2 size={12} className="inline mr-1.5" />
            Agent Config
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {rightTab === 'tools' ? (
            /* Tools Registry */
            <div className="space-y-3">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Available Tools ({tools.length})
              </p>
              {tools.map((tool) => {
                const isUsedByAgent = selectedAgent?.config.enabledTools?.includes(
                  tool.name
                );
                return (
                  <div
                    key={tool.name}
                    className={`p-3 rounded-lg border transition-colors ${
                      isUsedByAgent
                        ? 'bg-blue-900/10 border-blue-900/30'
                        : 'bg-slate-800/30 border-slate-700/50'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      {toolIconsLg[tool.name] || (
                        <Wrench size={18} className="text-slate-400" />
                      )}
                      <span className="text-sm font-medium text-slate-200">
                        {tool.name}
                      </span>
                      {isUsedByAgent && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-400 border border-blue-900/50 ml-auto">
                          ACTIVE
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      {tool.description}
                    </p>
                  </div>
                );
              })}

              {tools.length === 0 && (
                <div className="text-center py-8">
                  <Wrench
                    size={24}
                    className="text-slate-700 mx-auto mb-2"
                  />
                  <p className="text-xs text-slate-600">
                    No tools available
                  </p>
                </div>
              )}

              {/* How it works */}
              <div className="mt-4 pt-4 border-t border-slate-800">
                <div className="flex items-center gap-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3">
                  <Info size={10} />
                  How ReAct Works
                </div>
                <div className="space-y-2">
                  {[
                    { step: '1', label: 'Reason', desc: 'LLM analyzes the task' },
                    { step: '2', label: 'Act', desc: 'Calls a tool if needed' },
                    { step: '3', label: 'Observe', desc: 'Reviews tool results' },
                    { step: '4', label: 'Repeat', desc: 'Until answer is ready' },
                  ].map((item) => (
                    <div
                      key={item.step}
                      className="flex items-center gap-2 text-[11px]"
                    >
                      <span className="w-5 h-5 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-[9px] text-blue-400 font-bold shrink-0">
                        {item.step}
                      </span>
                      <span className="text-slate-300 font-medium">
                        {item.label}
                      </span>
                      <span className="text-slate-600">{item.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* Agent Config */
            <div className="space-y-4">
              {selectedAgent ? (
                <>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    Configuration
                  </p>

                  {/* Enabled Tools */}
                  <div>
                    <p className="text-[10px] text-slate-500 font-bold uppercase mb-2">
                      Enabled Tools
                    </p>
                    <div className="space-y-1.5">
                      {selectedAgent.config.enabledTools?.map((t) => (
                        <div
                          key={t}
                          className="flex items-center gap-2 text-xs text-slate-300 bg-slate-800/50 rounded px-2.5 py-1.5 border border-slate-700/50"
                        >
                          {toolIconsSm[t] || (
                            <Wrench size={12} className="text-slate-400" />
                          )}
                          {t}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* System Prompt */}
                  {selectedAgent.config.systemPrompt && (
                    <div>
                      <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">
                        System Prompt
                      </p>
                      <pre className="text-[11px] text-slate-400 font-mono bg-slate-950/50 rounded p-2 whitespace-pre-wrap max-h-32 overflow-y-auto border border-slate-800">
                        {selectedAgent.config.systemPrompt}
                      </pre>
                    </div>
                  )}

                  {/* Prompt Template */}
                  {selectedAgent.config.promptTemplate && (
                    <div>
                      <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">
                        Prompt Template
                      </p>
                      <pre className="text-[11px] text-slate-400 font-mono bg-slate-950/50 rounded p-2 whitespace-pre-wrap max-h-32 overflow-y-auto border border-slate-800">
                        {selectedAgent.config.promptTemplate}
                      </pre>
                    </div>
                  )}

                  {/* Parameters */}
                  <div>
                    <p className="text-[10px] text-slate-500 font-bold uppercase mb-2">
                      Parameters
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      {[
                        ['Temperature', selectedAgent.config.temperature],
                        ['Top P', selectedAgent.config.topP],
                        ['Max Tokens', selectedAgent.config.maxTokens],
                        ['Max Iterations', selectedAgent.config.maxIterations || 10],
                        ['Top K', selectedAgent.config.topK],
                        ['Thinking', selectedAgent.config.thinking ? 'On' : 'Off'],
                      ].map(([label, value]) => (
                        <div
                          key={String(label)}
                          className="flex justify-between bg-slate-800/30 rounded px-2 py-1.5 border border-slate-700/30"
                        >
                          <span className="text-slate-500">{label}</span>
                          <span className="text-slate-300 font-mono">
                            {String(value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-center py-8">
                  <Settings2
                    size={24}
                    className="text-slate-700 mx-auto mb-2"
                  />
                  <p className="text-xs text-slate-600">
                    Select an agent to see config
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AgenticDashboard;
