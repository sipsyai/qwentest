import React, { useState, useEffect, useRef } from 'react';
import {
  GitBranch,
  Plus,
  Trash2,
  Save,
  Play,
  Square,
  Loader2,
  ChevronDown,
  ChevronRight,
  ArrowDown,
  Bot,
  CheckCircle2,
  AlertCircle,
  X,
  Copy,
  Sparkles,
  Wrench,
  Search,
  Database,
  Globe,
  Settings2,
  Zap,
  Brain,
  Thermometer,
  RotateCcw,
  Info,
  ArrowRight,
  Pencil,
} from 'lucide-react';
import {
  getAgents,
  deleteAgent,
  runAgent,
  runAgentAgentic,
  getAvailableTools,
  Agent,
  AgentStep,
  ToolInfo,
} from '../services/agentsApi';
import {
  getWorkflows,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  runWorkflow,
  Workflow,
  WorkflowStep,
  StepCondition,
  WorkflowRunCallbacks,
} from '../services/workflowApi';
import { parseThinkTags, renderMarkdownToHTML } from '../services/markdown';

// ─── Tool icons ────────────────────────────────────────────────────────────
const toolIconsSm: Record<string, React.ReactNode> = {
  kb_search: <Search size={12} className="text-amber-400" />,
  dataset_query: <Database size={12} className="text-emerald-400" />,
  web_fetch: <Globe size={12} className="text-blue-400" />,
  sub_agent: <Bot size={12} className="text-purple-400" />,
};
const toolIconsLg: Record<string, React.ReactNode> = {
  kb_search: <Search size={18} className="text-amber-400" />,
  dataset_query: <Database size={18} className="text-emerald-400" />,
  web_fetch: <Globe size={18} className="text-blue-400" />,
  sub_agent: <Bot size={18} className="text-purple-400" />,
};

// ─── Helpers ───────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 10);

function collectInputVars(
  steps: WorkflowStep[],
  agents: Agent[],
): { name: string; label: string; defaultValue: string }[] {
  const seen = new Set<string>();
  const result: { name: string; label: string; defaultValue: string }[] = [];
  for (const step of steps) {
    const agent = agents.find((a) => a.id === step.agentId);
    for (const [varName, mapping] of Object.entries(step.variableMappings)) {
      if (mapping.startsWith('{{input:') && mapping.endsWith('}}')) {
        const inputKey = mapping.slice(8, -2);
        if (!seen.has(inputKey)) {
          seen.add(inputKey);
          const agentVar = (agent?.config.variables as any[] | undefined)?.find(
            (v: any) => v.name === varName,
          );
          result.push({
            name: inputKey,
            label: agentVar?.label || inputKey,
            defaultValue: agentVar?.defaultValue || '',
          });
        }
      }
    }
  }
  return result;
}

// ─── Shared step renderer (used by both pipeline tool calls and agent runner) ──
function renderAgentSteps(
  steps: AgentStep[],
  expandedSteps: Set<number>,
  maxIterations: number,
  toggleStep: (i: number) => void,
) {
  return steps.map((step, i) => {
    switch (step.type) {
      case 'agent_start':
        return (
          <div key={i} className="flex items-center gap-2 text-[11px] text-slate-500">
            <Zap size={11} className="text-blue-400" />
            <span>
              Agent started in{' '}
              <span className="text-blue-400 font-medium">{step.data.mode}</span> mode
            </span>
            {step.data.tools?.length > 0 && (
              <span className="text-slate-600">({step.data.tools.length} tools)</span>
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
            j > i && s.type === 'tool_result' && s.data.call_id === step.data.call_id,
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
                <ChevronDown size={12} className="text-slate-500 shrink-0" />
              ) : (
                <ChevronRight size={12} className="text-slate-500 shrink-0" />
              )}
              {toolIconsSm[step.data.tool] || <Wrench size={12} className="text-slate-400" />}
              <span className="text-xs font-medium text-slate-300">{step.data.tool}</span>
              <span className="text-[10px] text-slate-500 font-mono truncate flex-1">
                {JSON.stringify(step.data.args).slice(0, 100)}
              </span>
              {resultStep ? (
                <CheckCircle2 size={11} className="text-emerald-500 shrink-0" />
              ) : (
                <Loader2 size={11} className="text-blue-400 animate-spin shrink-0" />
              )}
            </button>
            {isExpanded && (
              <div className="px-3 pb-3 space-y-2 border-t border-slate-700/30">
                <div className="mt-2">
                  <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">Arguments</p>
                  <pre className="text-[11px] text-slate-400 font-mono bg-slate-950/50 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(step.data.args, null, 2)}
                  </pre>
                </div>
                {resultStep && (
                  <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">Result</p>
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
            <span className="font-medium">Generating final answer...</span>
          </div>
        );
      case 'agent_done':
        return (
          <div
            key={i}
            className="flex items-center gap-2 text-[11px] text-slate-500 mt-2 pt-2 border-t border-slate-800"
          >
            <CheckCircle2 size={11} className="text-emerald-500" />
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
  });
}

// ═══════════════════════════════════════════════════════════════════════════
const Workflows = () => {
  // ── Tab ───────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'pipeline' | 'runner'>('pipeline');

  // ── Shared data ───────────────────────────────────────────────────────────
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Pipeline editor ───────────────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editSteps, setEditSteps] = useState<WorkflowStep[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // ── Pipeline run ──────────────────────────────────────────────────────────
  const [pipeRunning, setPipeRunning] = useState(false);
  const [pipeStepStates, setPipeStepStates] = useState<
    Record<string, 'pending' | 'running' | 'done' | 'error' | 'skipped'>
  >({});
  const [pipeStepOutputs, setPipeStepOutputs] = useState<Record<string, string>>({});
  const [pipeStepErrors, setPipeStepErrors] = useState<Record<string, string>>({});
  const [pipeToolCalls, setPipeToolCalls] = useState<
    Record<string, { tool: string; args: any; result?: string }[]>
  >({});
  const [pipeWorkflowDone, setPipeWorkflowDone] = useState(false);
  const [pipeRunError, setPipeRunError] = useState<string | null>(null);
  const pipeAbortRef = useRef<AbortController | null>(null);
  const pipeOutputRef = useRef<HTMLDivElement>(null);
  const [pipeExpandedSteps, setPipeExpandedSteps] = useState<Set<number>>(new Set());
  const [pipeCopied, setPipeCopied] = useState<string | null>(null);
  const [showRunModal, setShowRunModal] = useState(false);
  const [runInputValues, setRunInputValues] = useState<Record<string, string>>({});

  // ── Agent Runner ──────────────────────────────────────────────────────────
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [wsVars, setWsVars] = useState<Record<string, string>>({});
  const [wsOutput, setWsOutput] = useState('');
  const [wsRunning, setWsRunning] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);
  const [wsCopied, setWsCopied] = useState(false);
  const [wsSteps, setWsSteps] = useState<AgentStep[]>([]);
  const [wsIter, setWsIter] = useState(0);
  const [wsMaxIter, setWsMaxIter] = useState(10);
  const [wsExpandedSteps, setWsExpandedSteps] = useState<Set<number>>(new Set());
  const [wsDoneInfo, setWsDoneInfo] = useState<{
    iterations: number;
    tools_used: string[];
    total_tool_calls: number;
  } | null>(null);
  const [wsRightTab, setWsRightTab] = useState<'tools' | 'config'>('tools');
  const wsAbortRef = useRef<AbortController | null>(null);
  const wsOutputRef = useRef<HTMLDivElement>(null);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchData = async () => {
    try {
      const [wfRes, agRes, toolsRes] = await Promise.all([
        getWorkflows(),
        getAgents(),
        getAvailableTools().catch(() => []),
      ]);
      setWorkflows(wfRes.data);
      setAgents(agRes.data);
      setTools(toolsRes);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  // Auto-scroll
  useEffect(() => {
    if (pipeOutputRef.current && pipeRunning)
      pipeOutputRef.current.scrollTop = pipeOutputRef.current.scrollHeight;
  }, [pipeStepOutputs, pipeStepStates, pipeRunning]);

  useEffect(() => {
    if (wsOutputRef.current && wsRunning)
      wsOutputRef.current.scrollTop = wsOutputRef.current.scrollHeight;
  }, [wsOutput, wsRunning, wsSteps]);

  // ── Pipeline helpers ───────────────────────────────────────────────────────
  const agentById = (id: string) => agents.find((a) => a.id === id);

  const selectWorkflow = (wf: Workflow) => {
    handlePipeStop();
    setSelectedId(wf.id);
    setEditName(wf.name);
    setEditDesc(wf.description);
    setEditSteps(wf.steps.map((s) => ({ ...s })));
    setIsDirty(false);
    resetPipeRun();
  };

  const createNew = () => {
    handlePipeStop();
    setSelectedId('__new__');
    setEditName('New Workflow');
    setEditDesc('');
    setEditSteps([]);
    setIsDirty(true);
    resetPipeRun();
  };

  const resetPipeRun = () => {
    setPipeStepStates({});
    setPipeStepOutputs({});
    setPipeStepErrors({});
    setPipeToolCalls({});
    setPipeWorkflowDone(false);
    setPipeRunError(null);
    setPipeExpandedSteps(new Set());
  };

  const markDirty = () => setIsDirty(true);

  const addStep = () => {
    setEditSteps([...editSteps, { id: uid(), agentId: '', agentName: '', variableMappings: {} }]);
    markDirty();
  };

  const updateStep = (index: number, patch: Partial<WorkflowStep>) => {
    setEditSteps((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
    markDirty();
  };

  const removeStep = (index: number) => {
    setEditSteps((prev) => prev.filter((_, i) => i !== index));
    markDirty();
  };

  const moveStep = (from: number, to: number) => {
    if (to < 0 || to >= editSteps.length) return;
    setEditSteps((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    markDirty();
  };

  const selectAgentForStep = (stepIndex: number, agentId: string) => {
    const agent = agentById(agentId);
    if (!agent) return;
    const mappings: Record<string, string> = {};
    if (agent.config.variables) {
      for (const v of agent.config.variables) {
        mappings[v.name] =
          stepIndex > 0 && Object.keys(mappings).length === 0 ? '{{prev_output}}' : '';
      }
    }
    updateStep(stepIndex, { agentId: agent.id, agentName: agent.name, variableMappings: mappings });
  };

  const updateMapping = (stepIndex: number, varName: string, value: string) => {
    setEditSteps((prev) => {
      const next = [...prev];
      next[stepIndex] = {
        ...next[stepIndex],
        variableMappings: { ...next[stepIndex].variableMappings, [varName]: value },
      };
      return next;
    });
    markDirty();
  };

  const handleSave = async () => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      const payload = { name: editName.trim(), description: editDesc.trim(), steps: editSteps };
      if (selectedId === '__new__') {
        const created = await createWorkflow(payload);
        setWorkflows((prev) => [created, ...prev]);
        setSelectedId(created.id);
      } else if (selectedId) {
        const updated = await updateWorkflow(selectedId, payload);
        setWorkflows((prev) => prev.map((w) => (w.id === selectedId ? updated : w)));
      }
      setIsDirty(false);
    } catch (err) {
      console.error('Failed to save workflow:', err);
    } finally {
      setSaving(false);
    }
  };

  const handlePipeDelete = async () => {
    if (!selectedId || selectedId === '__new__') return;
    if (!confirm('Delete this workflow?')) return;
    setDeleting(true);
    try {
      await deleteWorkflow(selectedId);
      setWorkflows((prev) => prev.filter((w) => w.id !== selectedId));
      setSelectedId(null);
      setEditSteps([]);
    } catch (err) {
      console.error('Failed to delete workflow:', err);
    } finally {
      setDeleting(false);
    }
  };

  const handlePipeRun = () => {
    if (!selectedId || selectedId === '__new__' || editSteps.length === 0) return;
    const inputVars = collectInputVars(editSteps, agents);
    if (inputVars.length > 0) {
      const defaults: Record<string, string> = {};
      for (const v of inputVars) defaults[v.name] = v.defaultValue;
      setRunInputValues(defaults);
      setShowRunModal(true);
    } else {
      executePipeRun({});
    }
  };

  const executePipeRun = (variables: Record<string, string>) => {
    if (!selectedId || selectedId === '__new__' || editSteps.length === 0) return;
    resetPipeRun();
    setPipeRunning(true);
    const initStates: Record<string, 'pending'> = {};
    for (const s of editSteps) initStates[s.id] = 'pending';
    setPipeStepStates(initStates);
    const controller = new AbortController();
    pipeAbortRef.current = controller;

    const callbacks: WorkflowRunCallbacks = {
      onStepStart: (data) => {
        setPipeStepStates((prev) => ({ ...prev, [data.step_id]: 'running' }));
        setPipeExpandedSteps((prev) => new Set([...prev, data.index]));
      },
      onStepStream: (data) => {
        setPipeStepOutputs((prev) => ({
          ...prev,
          [data.step_id]: (prev[data.step_id] || '') + data.content,
        }));
      },
      onStepDone: (data) => {
        setPipeStepStates((prev) => ({ ...prev, [data.step_id]: 'done' }));
        setPipeStepOutputs((prev) => ({
          ...prev,
          // Prefer full streamed text over the 500-char output_preview
          [data.step_id]: prev[data.step_id] || data.output_preview || '',
        }));
      },
      onStepError: (data) => {
        setPipeStepStates((prev) => ({ ...prev, [data.step_id]: 'error' }));
        setPipeStepErrors((prev) => ({ ...prev, [data.step_id]: data.error }));
      },
      onStepSkip: (data) => {
        setPipeStepStates((prev) => ({ ...prev, [data.step_id]: 'skipped' }));
        setPipeStepOutputs((prev) => ({ ...prev, [data.step_id]: data.default_output }));
      },
      onStepToolCall: (data) => {
        setPipeToolCalls((prev) => ({
          ...prev,
          [data.step_id]: [...(prev[data.step_id] || []), { tool: data.tool, args: data.args }],
        }));
      },
      onStepToolResult: (data) => {
        setPipeToolCalls((prev) => {
          const calls = [...(prev[data.step_id] || [])];
          for (let i = calls.length - 1; i >= 0; i--) {
            if (calls[i].tool === data.tool && !calls[i].result) {
              calls[i] = { ...calls[i], result: data.result };
              break;
            }
          }
          return { ...prev, [data.step_id]: calls };
        });
      },
      onWorkflowDone: () => {
        setPipeWorkflowDone(true);
        setPipeRunning(false);
        pipeAbortRef.current = null;
      },
      onError: (msg) => {
        setPipeRunError(msg);
        setPipeRunning(false);
        pipeAbortRef.current = null;
      },
      onComplete: () => {
        setPipeRunning(false);
        pipeAbortRef.current = null;
      },
    };
    runWorkflow(selectedId, variables, callbacks, controller.signal);
  };

  const handlePipeStop = () => {
    if (pipeAbortRef.current) {
      pipeAbortRef.current.abort();
      setPipeRunning(false);
      pipeAbortRef.current = null;
    }
  };

  const copyPipeOutput = (stepId: string) => {
    navigator.clipboard.writeText(pipeStepOutputs[stepId] || '');
    setPipeCopied(stepId);
    setTimeout(() => setPipeCopied(null), 2000);
  };

  const togglePipeRunStep = (idx: number) => {
    setPipeExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const getSourceOptions = (stepIndex: number, varName?: string) => {
    const sources: { label: string; value: string }[] = [];
    if (stepIndex > 0) sources.push({ label: 'Previous step output', value: '{{prev_output}}' });
    for (let i = 0; i < stepIndex; i++) {
      const s = editSteps[i];
      sources.push({ label: `Step ${i + 1}: ${s.agentName || `Step ${i + 1}`}`, value: `{{step:${s.id}}}` });
    }
    if (varName) sources.push({ label: 'User input at runtime', value: `{{input:${varName}}}` });
    sources.push({ label: 'Custom value', value: '__custom__' });
    return sources;
  };

  // ── Agent Runner handlers ──────────────────────────────────────────────────
  const selectRunnerAgent = (agent: Agent) => {
    handleWsStop();
    setSelectedAgent(agent);
    setWsOutput('');
    setWsError(null);
    setWsSteps([]);
    setWsIter(0);
    setWsDoneInfo(null);
    setWsCopied(false);
    const defaults: Record<string, string> = {};
    if (agent.config.variables) {
      for (const v of agent.config.variables) defaults[v.name] = v.defaultValue || '';
    }
    setWsVars(defaults);
  };

  const wsIsAgentic =
    !!selectedAgent &&
    selectedAgent.config.agentMode === 'react' &&
    (selectedAgent.config.enabledTools?.length ?? 0) > 0;

  const startWsRun = () => {
    if (!selectedAgent) return;
    setWsRunning(true);
    setWsOutput('');
    setWsError(null);
    setWsSteps([]);
    setWsIter(0);
    setWsDoneInfo(null);
    setWsExpandedSteps(new Set());
    setWsCopied(false);
    const controller = new AbortController();
    wsAbortRef.current = controller;

    if (wsIsAgentic) {
      runAgentAgentic(
        selectedAgent.id,
        wsVars,
        {
          onAgentStart: (d) => {
            setWsMaxIter(d.max_iterations);
            setWsSteps((p) => [...p, { type: 'agent_start', data: d, timestamp: Date.now() }]);
          },
          onIterationStart: (d) => {
            setWsIter(d.iteration);
            setWsSteps((p) => [...p, { type: 'iteration_start', data: d, timestamp: Date.now() }]);
          },
          onToolCall: (d) => {
            setWsSteps((p) => {
              const n = [...p, { type: 'tool_call' as const, data: d, timestamp: Date.now() }];
              setWsExpandedSteps((es) => new Set([...es, n.length - 1]));
              return n;
            });
          },
          onToolResult: (d) => {
            setWsSteps((p) => [...p, { type: 'tool_result' as const, data: d, timestamp: Date.now() }]);
          },
          onFinalAnswerStart: (d) => {
            setWsSteps((p) => [...p, { type: 'final_answer_start' as const, data: d, timestamp: Date.now() }]);
          },
          onStream: (d) => { setWsOutput((prev) => prev + d.content); },
          onAgentDone: (d) => {
            setWsDoneInfo(d);
            setWsSteps((p) => [...p, { type: 'agent_done' as const, data: d, timestamp: Date.now() }]);
            setWsRunning(false);
            wsAbortRef.current = null;
          },
          onError: (d) => {
            setWsError(d.message);
            setWsSteps((p) => [...p, { type: 'error' as const, data: d, timestamp: Date.now() }]);
            setWsRunning(false);
            wsAbortRef.current = null;
          },
          onChunk: (chunk) => { setWsOutput((prev) => prev + chunk); },
          onComplete: () => { setWsRunning(false); wsAbortRef.current = null; },
        },
        controller.signal,
      );
    } else {
      // Simple mode
      runAgent(
        selectedAgent.id,
        wsVars,
        (chunk) => setWsOutput((prev) => prev + chunk),
        () => { setWsRunning(false); wsAbortRef.current = null; },
        (err) => { setWsError(err); setWsRunning(false); wsAbortRef.current = null; },
        controller.signal,
      );
    }
  };

  const handleWsStop = () => {
    if (wsAbortRef.current) {
      wsAbortRef.current.abort();
      setWsRunning(false);
      wsAbortRef.current = null;
    }
  };

  const toggleWsStep = (i: number) => {
    setWsExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
      </div>
    );
  }

  const isNew = selectedId === '__new__';
  const canRun =
    selectedId && !isNew && editSteps.length > 0 && editSteps.every((s) => s.agentId);
  const hasRunResults = Object.keys(pipeStepStates).length > 0;

  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="flex flex-col h-screen">

      {/* ─── Tab Bar ───────────────────────────────────────────────────────── */}
      <div className="flex items-center border-b border-slate-800 bg-slate-900 shrink-0 px-2">
        <button
          onClick={() => setActiveTab('pipeline')}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors border-b-2 ${
            activeTab === 'pipeline'
              ? 'text-emerald-400 border-emerald-500'
              : 'text-slate-500 border-transparent hover:text-slate-300'
          }`}
        >
          <GitBranch size={14} />
          Pipeline Builder
          {workflows.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-900/40 text-emerald-400 border border-emerald-900/50">
              {workflows.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('runner')}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors border-b-2 ${
            activeTab === 'runner'
              ? 'text-blue-400 border-blue-500'
              : 'text-slate-500 border-transparent hover:text-slate-300'
          }`}
        >
          <Zap size={14} />
          Agent Runner
          {agents.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-900/40 text-blue-400 border border-blue-900/50">
              {agents.length}
            </span>
          )}
        </button>
      </div>

      {/* ─── Content ───────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* PIPELINE BUILDER TAB                                              */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'pipeline' && (
          <>
            {/* Left — Workflow List */}
            <div className="w-72 border-r border-slate-800 flex flex-col bg-slate-900/50 shrink-0">
              <div className="px-4 py-4 border-b border-slate-800">
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  <GitBranch size={16} className="text-emerald-400" />
                  Workflows
                </h2>
                <p className="text-[10px] text-slate-500 mt-1">
                  {workflows.length} pipeline{workflows.length !== 1 ? 's' : ''}
                </p>
              </div>
              <div className="flex-1 overflow-y-auto py-2">
                {workflows.length === 0 && !isNew && (
                  <div className="px-4 py-8 text-center">
                    <GitBranch size={32} className="text-slate-700 mx-auto mb-3" />
                    <p className="text-xs text-slate-500">No workflows yet</p>
                    <p className="text-[10px] text-slate-600 mt-1">
                      Create a pipeline to chain agents together
                    </p>
                  </div>
                )}
                {workflows.map((wf) => {
                  const isSelected = selectedId === wf.id;
                  return (
                    <button
                      key={wf.id}
                      onClick={() => selectWorkflow(wf)}
                      className={`w-full text-left px-4 py-3 transition-colors border-l-2 ${
                        isSelected
                          ? 'bg-emerald-600/10 border-emerald-500 text-white'
                          : 'border-transparent text-slate-300 hover:bg-slate-800/50 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate flex-1">{wf.name}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-400 border border-emerald-900/50 font-medium shrink-0">
                          {wf.steps.length}S
                        </span>
                      </div>
                      {wf.description && (
                        <p className="text-[10px] text-slate-500 truncate mt-0.5">
                          {wf.description}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="px-4 py-3 border-t border-slate-800">
                <button
                  onClick={createNew}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors"
                >
                  <Plus size={14} /> New Workflow
                </button>
              </div>
            </div>

            {/* Center — Pipeline Builder */}
            <div className="flex-1 flex flex-col min-w-0">
              {!selectedId ? (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center">
                    <GitBranch size={48} className="text-slate-800 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-slate-400">
                      Select or Create a Workflow
                    </h3>
                    <p className="text-sm text-slate-600 mt-1">
                      Chain agents together into a pipeline
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {/* Workflow Header */}
                  <div className="px-6 py-4 border-b border-slate-800 bg-slate-900/30 shrink-0">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1 min-w-0 flex items-center gap-3">
                        <div className="w-10 h-10 bg-emerald-600/20 border border-emerald-600/30 rounded-xl flex items-center justify-center shrink-0">
                          <GitBranch size={20} className="text-emerald-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => { setEditName(e.target.value); markDirty(); }}
                            placeholder="Workflow name..."
                            className="bg-transparent text-white font-bold text-lg w-full outline-none placeholder:text-slate-600 focus:bg-slate-800/30 rounded px-1 -mx-1"
                          />
                          <input
                            type="text"
                            value={editDesc}
                            onChange={(e) => { setEditDesc(e.target.value); markDirty(); }}
                            placeholder="Description (optional)..."
                            className="bg-transparent text-slate-400 text-xs w-full outline-none placeholder:text-slate-700 focus:bg-slate-800/30 rounded px-1 -mx-1 mt-0.5"
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {isDirty && <span className="text-[10px] text-amber-400 mr-1">Unsaved</span>}
                        <button
                          onClick={handleSave}
                          disabled={saving || !editName.trim()}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-md transition-colors disabled:opacity-50"
                        >
                          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                          Save
                        </button>
                        {!isNew && (
                          <button
                            onClick={handlePipeDelete}
                            disabled={deleting}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-md transition-colors disabled:opacity-50"
                          >
                            {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 mt-3">
                      {pipeRunning ? (
                        <button
                          onClick={handlePipeStop}
                          className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors"
                        >
                          <Square size={12} className="fill-current" /> Stop
                        </button>
                      ) : (
                        <button
                          onClick={handlePipeRun}
                          disabled={!canRun}
                          className="flex items-center gap-1.5 px-5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Play size={12} className="fill-current" />
                          {hasRunResults ? 'Re-run' : 'Run Pipeline'}
                        </button>
                      )}
                      <span className="text-[10px] text-slate-500">
                        {editSteps.length} step{editSteps.length !== 1 ? 's' : ''}
                        {editSteps.filter((s) => s.agentId).length < editSteps.length && (
                          <span className="text-amber-500 ml-2">
                            ({editSteps.length - editSteps.filter((s) => s.agentId).length} unconfigured)
                          </span>
                        )}
                      </span>
                      {pipeWorkflowDone && (
                        <span className="text-[11px] text-emerald-400 flex items-center gap-1 ml-auto">
                          <CheckCircle2 size={12} /> Pipeline complete
                        </span>
                      )}
                      {pipeRunning && (
                        <span className="text-[11px] text-blue-400 flex items-center gap-1 ml-auto animate-pulse">
                          <Loader2 size={12} className="animate-spin" /> Running...
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Pipeline Area */}
                  <div className="flex-1 overflow-y-auto" ref={pipeOutputRef}>
                    <div className="p-6 max-w-3xl mx-auto space-y-0">
                      {pipeRunError && (
                        <div className="bg-red-900/20 border border-red-900/50 p-3 rounded-lg text-red-200 text-sm mb-4">
                          {pipeRunError}
                        </div>
                      )}

                      {editSteps.map((step, idx) => {
                        const agent = agentById(step.agentId);
                        const stepState = pipeStepStates[step.id];
                        const stepOutput = pipeStepOutputs[step.id] || '';
                        const stepError = pipeStepErrors[step.id];
                        const toolCalls = pipeToolCalls[step.id] || [];
                        const isExpanded = pipeExpandedSteps.has(idx);
                        const variables = agent?.config.variables || [];

                        return (
                          <React.Fragment key={step.id}>
                            {idx > 0 && (
                              <div className="flex justify-center py-1">
                                <div className="flex flex-col items-center">
                                  <div className="w-px h-4 bg-slate-700" />
                                  <ArrowDown size={14} className="text-slate-600 -my-0.5" />
                                  <div className="w-px h-1 bg-slate-700" />
                                </div>
                              </div>
                            )}
                            <div
                              className={`border rounded-xl transition-colors ${
                                stepState === 'running'
                                  ? 'border-blue-500/50 bg-blue-900/10 shadow-lg shadow-blue-900/10'
                                  : stepState === 'done'
                                  ? 'border-emerald-500/30 bg-emerald-900/5'
                                  : stepState === 'error'
                                  ? 'border-red-500/30 bg-red-900/5'
                                  : stepState === 'skipped'
                                  ? 'border-slate-600/40 bg-slate-900/20 opacity-70'
                                  : 'border-slate-700/60 bg-slate-900/30'
                              }`}
                            >
                              {/* Step Header */}
                              <div className="flex items-center gap-3 px-4 py-3">
                                <div className="flex flex-col gap-0.5 shrink-0">
                                  <button
                                    onClick={() => moveStep(idx, idx - 1)}
                                    disabled={idx === 0 || pipeRunning}
                                    className="text-slate-600 hover:text-slate-300 disabled:opacity-20 disabled:cursor-not-allowed"
                                  >
                                    <ChevronRight size={12} className="rotate-[-90deg]" />
                                  </button>
                                  <button
                                    onClick={() => moveStep(idx, idx + 1)}
                                    disabled={idx === editSteps.length - 1 || pipeRunning}
                                    className="text-slate-600 hover:text-slate-300 disabled:opacity-20 disabled:cursor-not-allowed"
                                  >
                                    <ChevronRight size={12} className="rotate-90" />
                                  </button>
                                </div>
                                <div
                                  className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                                    stepState === 'running'
                                      ? 'bg-blue-600 text-white'
                                      : stepState === 'done'
                                      ? 'bg-emerald-600 text-white'
                                      : stepState === 'error'
                                      ? 'bg-red-600 text-white'
                                      : stepState === 'skipped'
                                      ? 'bg-slate-700 text-slate-400'
                                      : 'bg-slate-800 text-slate-400 border border-slate-700'
                                  }`}
                                >
                                  {stepState === 'running' ? (
                                    <Loader2 size={14} className="animate-spin" />
                                  ) : stepState === 'done' ? (
                                    <CheckCircle2 size={14} />
                                  ) : stepState === 'error' ? (
                                    <AlertCircle size={14} />
                                  ) : stepState === 'skipped' ? (
                                    <ArrowRight size={14} />
                                  ) : (
                                    idx + 1
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <select
                                    value={step.agentId}
                                    onChange={(e) => selectAgentForStep(idx, e.target.value)}
                                    disabled={pipeRunning}
                                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 appearance-none cursor-pointer"
                                  >
                                    <option value="">Select agent...</option>
                                    {agents.map((a) => (
                                      <option key={a.id} value={a.id}>
                                        {a.name}
                                        {a.config.agentMode === 'react' ? ' [Agentic]' : ''}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                {agent?.config.agentMode === 'react' && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-400 border border-blue-900/50 font-medium shrink-0">
                                    AGENTIC
                                  </span>
                                )}
                                {stepState === 'skipped' && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-400 border border-slate-600/50 font-medium shrink-0">
                                    SKIPPED
                                  </span>
                                )}
                                <button
                                  onClick={() => removeStep(idx)}
                                  disabled={pipeRunning}
                                  className="text-slate-600 hover:text-red-400 transition-colors disabled:opacity-30 shrink-0"
                                >
                                  <X size={14} />
                                </button>
                              </div>

                              {/* Variable Mappings */}
                              {agent && variables.length > 0 && (
                                <div className="px-4 pb-3 space-y-2 border-t border-slate-800/50 pt-3 mx-3">
                                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                                    Variable Mappings
                                  </p>
                                  {variables.map((v) => {
                                    const currentVal = step.variableMappings[v.name] || '';
                                    // FR-2: detect {{step:id.field}} dot-notation
                                    const isStepRefWithField =
                                      currentVal.startsWith('{{step:') &&
                                      currentVal.endsWith('}}') &&
                                      currentVal.slice(7, -2).includes('.');
                                    let baseRef = currentVal;
                                    let fieldName = '';
                                    if (isStepRefWithField) {
                                      const inner = currentVal.slice(7, -2);
                                      const dotIdx = inner.indexOf('.');
                                      baseRef = `{{step:${inner.slice(0, dotIdx)}}}`;
                                      fieldName = inner.slice(dotIdx + 1);
                                    }
                                    const sources = getSourceOptions(idx, v.name);
                                    const isRef =
                                      currentVal.startsWith('{{prev_output}}') ||
                                      currentVal.startsWith('{{step:') ||
                                      currentVal.startsWith('{{input:');
                                    const matchingSource = sources.find((s) => s.value === baseRef);
                                    const isStepSource =
                                      baseRef.startsWith('{{step:') && !!matchingSource;
                                    return (
                                      <div key={v.name} className="flex items-center gap-2 flex-wrap">
                                        <span className="text-[11px] text-slate-400 font-mono w-28 shrink-0 truncate">
                                          {'{{'}{v.name}{'}}'}
                                        </span>
                                        <span className="text-slate-600 text-[10px]">&larr;</span>
                                        <select
                                          value={matchingSource ? matchingSource.value : (isRef ? '__custom__' : '__custom__')}
                                          onChange={(e) => {
                                            if (e.target.value === '__custom__') updateMapping(idx, v.name, '');
                                            else updateMapping(idx, v.name, e.target.value);
                                          }}
                                          disabled={pipeRunning}
                                          className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] text-white outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 flex-1 min-w-0"
                                        >
                                          {sources.map((s) => (
                                            <option key={s.value} value={s.value}>{s.label}</option>
                                          ))}
                                        </select>
                                        {/* FR-2: JSON field input for {{step:id.field}} */}
                                        {isStepSource && (
                                          <input
                                            type="text"
                                            value={fieldName}
                                            onChange={(e) => {
                                              const f = e.target.value;
                                              const base = baseRef.slice(0, -2); // strip "}}"
                                              updateMapping(idx, v.name, f ? `${base}.${f}}}` : baseRef);
                                            }}
                                            placeholder=".field (optional)"
                                            disabled={pipeRunning}
                                            className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-300 outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 w-32 font-mono"
                                          />
                                        )}
                                        {!isRef && !matchingSource && (
                                          <input
                                            type="text"
                                            value={currentVal}
                                            onChange={(e) => updateMapping(idx, v.name, e.target.value)}
                                            placeholder={v.defaultValue || 'Enter value...'}
                                            disabled={pipeRunning}
                                            className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] text-white outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 flex-1 min-w-0 font-mono"
                                          />
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}

                              {/* FR-1: Condition Section */}
                              {agent && (
                                <div className="px-4 pb-3 space-y-2 border-t border-slate-800/50 pt-3 mx-3">
                                  <label className="flex items-center gap-2 cursor-pointer select-none">
                                    <input
                                      type="checkbox"
                                      checked={!!step.condition}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          updateStep(idx, {
                                            condition: { source: '', operator: 'in', values: [] },
                                          });
                                        } else {
                                          updateStep(idx, { condition: undefined });
                                        }
                                      }}
                                      disabled={pipeRunning}
                                      className="w-3 h-3 rounded accent-emerald-500 disabled:opacity-50"
                                    />
                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                                      Conditional Execution
                                    </span>
                                  </label>
                                  {step.condition && (() => {
                                    const cond = step.condition;
                                    // Parse condition source for dot-notation
                                    const src = cond.source || '';
                                    const isSrcStepWithField =
                                      src.startsWith('{{step:') && src.endsWith('}}') && src.slice(7, -2).includes('.');
                                    let srcBase = src;
                                    let srcField = '';
                                    if (isSrcStepWithField) {
                                      const inner = src.slice(7, -2);
                                      const di = inner.indexOf('.');
                                      srcBase = `{{step:${inner.slice(0, di)}}}`;
                                      srcField = inner.slice(di + 1);
                                    }
                                    const condSources: { label: string; value: string }[] = [];
                                    for (let i = 0; i < idx; i++) {
                                      const s = editSteps[i];
                                      condSources.push({
                                        label: `Step ${i + 1}: ${s.agentName || `Step ${i + 1}`}`,
                                        value: `{{step:${s.id}}}`,
                                      });
                                    }
                                    const matchingSrc = condSources.find((s) => s.value === srcBase);
                                    const needsValues = !['empty', 'not_empty'].includes(cond.operator);
                                    return (
                                      <div className="pl-5 space-y-2">
                                        {/* Source */}
                                        <div className="flex items-center gap-2">
                                          <span className="text-[10px] text-slate-500 w-14 shrink-0">Source</span>
                                          <select
                                            value={matchingSrc ? matchingSrc.value : ''}
                                            onChange={(e) => {
                                              const newSrc = e.target.value;
                                              updateStep(idx, {
                                                condition: { ...cond, source: newSrc },
                                              });
                                            }}
                                            disabled={pipeRunning}
                                            className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] text-white outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50 flex-1 min-w-0"
                                          >
                                            <option value="">Select step output...</option>
                                            {condSources.map((s) => (
                                              <option key={s.value} value={s.value}>{s.label}</option>
                                            ))}
                                          </select>
                                          {/* field input */}
                                          {matchingSrc && (
                                            <input
                                              type="text"
                                              value={srcField}
                                              onChange={(e) => {
                                                const f = e.target.value;
                                                const base = srcBase.slice(0, -2);
                                                updateStep(idx, {
                                                  condition: {
                                                    ...cond,
                                                    source: f ? `${base}.${f}}}` : srcBase,
                                                  },
                                                });
                                              }}
                                              placeholder=".field"
                                              disabled={pipeRunning}
                                              className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-300 outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50 w-24 font-mono"
                                            />
                                          )}
                                        </div>
                                        {/* Operator */}
                                        <div className="flex items-center gap-2">
                                          <span className="text-[10px] text-slate-500 w-14 shrink-0">Operator</span>
                                          <select
                                            value={cond.operator}
                                            onChange={(e) =>
                                              updateStep(idx, {
                                                condition: {
                                                  ...cond,
                                                  operator: e.target.value as StepCondition['operator'],
                                                },
                                              })
                                            }
                                            disabled={pipeRunning}
                                            className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] text-white outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50 flex-1 min-w-0"
                                          >
                                            <option value="in">is one of</option>
                                            <option value="not_in">is not one of</option>
                                            <option value="eq">equals</option>
                                            <option value="ne">not equals</option>
                                            <option value="contains">contains</option>
                                            <option value="empty">is empty</option>
                                            <option value="not_empty">is not empty</option>
                                          </select>
                                        </div>
                                        {/* Values */}
                                        {needsValues && (
                                          <div className="flex items-center gap-2">
                                            <span className="text-[10px] text-slate-500 w-14 shrink-0">Values</span>
                                            <input
                                              type="text"
                                              value={cond.values.join(', ')}
                                              onChange={(e) => {
                                                const vals = e.target.value
                                                  .split(',')
                                                  .map((v) => v.trim())
                                                  .filter(Boolean);
                                                updateStep(idx, {
                                                  condition: { ...cond, values: vals },
                                                });
                                              }}
                                              placeholder="value1, value2, ..."
                                              disabled={pipeRunning}
                                              className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] text-white outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50 flex-1 min-w-0 font-mono"
                                            />
                                          </div>
                                        )}
                                        {/* Default output */}
                                        <div className="space-y-1">
                                          <span className="text-[10px] text-slate-500">
                                            Default output if skipped
                                          </span>
                                          <textarea
                                            value={step.defaultOutput || ''}
                                            onChange={(e) =>
                                              updateStep(idx, { defaultOutput: e.target.value })
                                            }
                                            placeholder="Output to pass downstream when this step is skipped..."
                                            disabled={pipeRunning}
                                            rows={2}
                                            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-[11px] text-white outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50 resize-none font-mono"
                                          />
                                        </div>
                                      </div>
                                    );
                                  })()}
                                </div>
                              )}

                              {/* Agent info */}
                              {agent && (
                                <div className="px-4 pb-3 flex flex-wrap items-center gap-1.5 mx-3">
                                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-400 border border-slate-700/50">
                                    {agent.config.selectedModel || 'default'}
                                  </span>
                                  {agent.config.enabledTools?.map((t) => (
                                    <span key={t} className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-slate-800/60 text-slate-500 border border-slate-700/30">
                                      {toolIconsSm[t] || <Wrench size={10} className="text-slate-500" />}
                                      {t}
                                    </span>
                                  ))}
                                </div>
                              )}

                              {/* Execution Output */}
                              {(stepState === 'running' || stepState === 'done' || stepState === 'error' || stepState === 'skipped') && (
                                <div className="border-t border-slate-800/50">
                                  <button
                                    onClick={() => togglePipeRunStep(idx)}
                                    className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-slate-800/30 transition-colors"
                                  >
                                    {isExpanded ? (
                                      <ChevronDown size={12} className="text-slate-500" />
                                    ) : (
                                      <ChevronRight size={12} className="text-slate-500" />
                                    )}
                                    <span className="text-[11px] text-slate-400 font-medium">
                                      {stepState === 'running' ? 'Running...' : stepState === 'done' ? 'Output' : stepState === 'skipped' ? 'Skipped (default output)' : 'Error'}
                                    </span>
                                    {stepOutput && stepState === 'done' && (
                                      <span className="text-[10px] text-slate-600 truncate flex-1">
                                        {stepOutput.slice(0, 80)}...
                                      </span>
                                    )}
                                    {toolCalls.length > 0 && (
                                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-400 border border-blue-900/50 shrink-0">
                                        {toolCalls.length} tool call{toolCalls.length > 1 ? 's' : ''}
                                      </span>
                                    )}
                                    {stepState === 'running' && (
                                      <Loader2 size={11} className="text-blue-400 animate-spin shrink-0" />
                                    )}
                                  </button>
                                  {isExpanded && (
                                    <div className="px-4 pb-4 space-y-3">
                                      {toolCalls.length > 0 && (
                                        <div className="space-y-1.5">
                                          {toolCalls.map((tc, tci) => (
                                            <div key={tci} className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-2.5">
                                              <div className="flex items-center gap-2 mb-1">
                                                {toolIconsSm[tc.tool] || <Wrench size={12} className="text-slate-400" />}
                                                <span className="text-xs font-medium text-slate-300">{tc.tool}</span>
                                                {tc.result ? (
                                                  <CheckCircle2 size={10} className="text-emerald-500 ml-auto" />
                                                ) : (
                                                  <Loader2 size={10} className="text-blue-400 animate-spin ml-auto" />
                                                )}
                                              </div>
                                              <pre className="text-[10px] text-slate-500 font-mono bg-slate-950/50 rounded p-1.5 overflow-x-auto whitespace-pre-wrap max-h-20 overflow-y-auto">
                                                {JSON.stringify(tc.args, null, 2)}
                                              </pre>
                                              {tc.result && (
                                                <pre className="text-[10px] text-slate-400 font-mono bg-slate-950/50 rounded p-1.5 overflow-x-auto whitespace-pre-wrap max-h-24 overflow-y-auto mt-1.5 border-t border-slate-800/50 pt-1.5">
                                                  {tc.result.slice(0, 500)}{tc.result.length > 500 ? '...' : ''}
                                                </pre>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                      {stepError && (
                                        <div className="bg-red-900/20 border border-red-900/50 rounded-lg px-3 py-2 text-xs text-red-300">
                                          {stepError}
                                        </div>
                                      )}
                                      {stepOutput && (
                                        <div className="relative">
                                          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
                                            <div className="flex items-start gap-2">
                                              <Sparkles size={14} className="text-emerald-400 mt-0.5 shrink-0" />
                                              <div className="flex-1 min-w-0 text-sm text-slate-300 leading-relaxed break-words">
                                                {(() => {
                                                  const parsed = parseThinkTags(stepOutput);
                                                  return (
                                                    <>
                                                      {parsed.thinking && (
                                                        <details className="bg-purple-900/10 border border-purple-900/30 rounded-lg p-2 mb-2">
                                                          <summary className="text-[10px] font-bold text-purple-400 cursor-pointer">Thinking...</summary>
                                                          <div className="mt-1 text-[10px] text-purple-300/70 whitespace-pre-wrap font-mono">{parsed.thinking}</div>
                                                        </details>
                                                      )}
                                                      <div className="text-xs" dangerouslySetInnerHTML={{ __html: renderMarkdownToHTML(parsed.content) }} />
                                                    </>
                                                  );
                                                })()}
                                                {stepState === 'running' && (
                                                  <span className="inline-block w-2 h-3 bg-blue-500 ml-1 animate-pulse" />
                                                )}
                                              </div>
                                            </div>
                                          </div>
                                          {stepState === 'done' && (
                                            <button
                                              onClick={() => copyPipeOutput(step.id)}
                                              className="absolute top-2 right-2 p-1.5 text-slate-500 hover:text-slate-300 bg-slate-800/80 rounded border border-slate-700/50 transition-colors"
                                            >
                                              {pipeCopied === step.id ? (
                                                <CheckCircle2 size={12} className="text-emerald-400" />
                                              ) : (
                                                <Copy size={12} />
                                              )}
                                            </button>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </React.Fragment>
                        );
                      })}

                      {/* Add step */}
                      {!pipeRunning && (
                        <div className="flex justify-center pt-4">
                          {editSteps.length > 0 && (
                            <div className="flex flex-col items-center">
                              <div className="w-px h-4 bg-slate-700" />
                              <ArrowDown size={14} className="text-slate-600 -my-0.5" />
                              <div className="w-px h-2 bg-slate-700" />
                            </div>
                          )}
                        </div>
                      )}
                      {!pipeRunning && (
                        <div className="flex justify-center">
                          <button
                            onClick={addStep}
                            className="flex items-center gap-2 px-6 py-3 text-xs font-medium text-slate-400 bg-slate-800/30 hover:bg-slate-800/60 hover:text-white border-2 border-dashed border-slate-700 hover:border-slate-500 rounded-xl transition-all"
                          >
                            <Plus size={14} /> Add Step
                          </button>
                        </div>
                      )}

                      {editSteps.length === 0 && (
                        <div className="text-center py-12">
                          <GitBranch size={36} className="text-slate-800 mx-auto mb-3" />
                          <p className="text-sm text-slate-500">Add steps to build your pipeline</p>
                          <p className="text-[11px] text-slate-700 mt-1">
                            Each step runs an agent and passes its output to the next
                          </p>
                        </div>
                      )}

                      {pipeWorkflowDone && (
                        <div className="mt-6 bg-emerald-900/10 border border-emerald-900/30 rounded-xl p-5 text-center">
                          <CheckCircle2 size={24} className="text-emerald-400 mx-auto mb-2" />
                          <p className="text-sm font-medium text-emerald-300">Pipeline Complete</p>
                          <p className="text-[11px] text-emerald-500/70 mt-1">
                            All {editSteps.length} steps finished successfully
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Right — Agent Palette */}
            <div className="w-64 border-l border-slate-800 flex flex-col bg-slate-900/50 shrink-0">
              <div className="px-4 py-4 border-b border-slate-800">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Bot size={12} /> Agent Palette
                </h3>
                <p className="text-[10px] text-slate-600 mt-0.5">
                  {agents.length} available agent{agents.length !== 1 ? 's' : ''}
                </p>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {agents.map((agent) => {
                  const isAgentic = agent.config.agentMode === 'react';
                  const isUsed = editSteps.some((s) => s.agentId === agent.id);
                  return (
                    <div
                      key={agent.id}
                      className={`p-3 rounded-lg border transition-colors ${
                        isUsed
                          ? 'bg-emerald-900/10 border-emerald-900/30'
                          : 'bg-slate-800/30 border-slate-700/50 hover:border-slate-600'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Bot size={14} className={isAgentic ? 'text-blue-400' : 'text-slate-400'} />
                        <span className="text-xs font-medium text-slate-200 truncate flex-1">
                          {agent.name}
                        </span>
                        {isAgentic && (
                          <span className="text-[8px] px-1 py-0.5 rounded bg-blue-900/40 text-blue-400 border border-blue-900/50">
                            REACT
                          </span>
                        )}
                        {isUsed && (
                          <span className="text-[8px] px-1 py-0.5 rounded bg-emerald-900/40 text-emerald-400 border border-emerald-900/50">
                            IN USE
                          </span>
                        )}
                      </div>
                      {agent.description && (
                        <p className="text-[10px] text-slate-500 line-clamp-2">{agent.description}</p>
                      )}
                      {agent.config.variables && agent.config.variables.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {agent.config.variables.map((v) => (
                            <span key={v.name} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-500 border border-slate-700/30">
                              {'{{'}{v.name}{'}}'}
                            </span>
                          ))}
                        </div>
                      )}
                      {agent.config.enabledTools && agent.config.enabledTools.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {agent.config.enabledTools.map((t) => (
                            <span key={t} className="flex items-center gap-0.5 text-[8px] px-1 py-0.5 rounded bg-slate-800/60 text-slate-500">
                              {toolIconsSm[t] || <Wrench size={8} className="text-slate-500" />}
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {agents.length === 0 && (
                  <div className="text-center py-8">
                    <Bot size={24} className="text-slate-700 mx-auto mb-2" />
                    <p className="text-[10px] text-slate-600">No agents available</p>
                  </div>
                )}
              </div>
              <div className="px-4 py-3 border-t border-slate-800">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Data Flow</p>
                <div className="space-y-1.5 text-[10px] text-slate-500">
                  <div className="flex items-start gap-1.5">
                    <span className="text-emerald-400 font-mono shrink-0">{'{{prev_output}}'}</span>
                    <span className="text-slate-600">Previous step result</span>
                  </div>
                  <div className="flex items-start gap-1.5">
                    <span className="text-blue-400 font-mono shrink-0">{'{{step:id}}'}</span>
                    <span className="text-slate-600">Specific step result</span>
                  </div>
                  <div className="flex items-start gap-1.5">
                    <span className="text-blue-400 font-mono shrink-0">{'{{step:id.field}}'}</span>
                    <span className="text-slate-600">JSON field from step</span>
                  </div>
                  <div className="flex items-start gap-1.5">
                    <span className="text-amber-400 font-mono shrink-0">{'{{input:key}}'}</span>
                    <span className="text-slate-600">User input at runtime</span>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* AGENT RUNNER TAB                                                  */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'runner' && (
          <>
            {/* Left — Agent List */}
            <div className="w-72 border-r border-slate-800 flex flex-col bg-slate-900/50 shrink-0">
              <div className="px-4 py-4 border-b border-slate-800">
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  <Bot size={16} className="text-blue-400" />
                  Agents
                </h2>
                <p className="text-[10px] text-slate-500 mt-1">
                  {agents.length} agent{agents.length !== 1 ? 's' : ''} available
                </p>
              </div>
              <div className="flex-1 overflow-y-auto py-2">
                {agents.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <Bot size={32} className="text-slate-700 mx-auto mb-3" />
                    <p className="text-xs text-slate-500">No agents yet</p>
                    <p className="text-[10px] text-slate-600 mt-1">Create agents from the Agents page</p>
                  </div>
                ) : (
                  agents.map((agent) => {
                    const isSelected = selectedAgent?.id === agent.id;
                    const isAgentic =
                      agent.config.agentMode === 'react' &&
                      (agent.config.enabledTools?.length ?? 0) > 0;
                    return (
                      <button
                        key={agent.id}
                        onClick={() => selectRunnerAgent(agent)}
                        className={`w-full text-left px-4 py-3 transition-colors border-l-2 ${
                          isSelected
                            ? 'bg-blue-600/10 border-blue-500 text-white'
                            : 'border-transparent text-slate-300 hover:bg-slate-800/50 hover:text-white'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <Bot size={14} className={isAgentic ? 'text-blue-400' : 'text-slate-400'} />
                          <span className="text-sm font-medium truncate flex-1">{agent.name}</span>
                          {isAgentic ? (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-400 border border-blue-900/50 font-medium shrink-0">
                              REACT
                            </span>
                          ) : (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 border border-slate-700/50 font-medium shrink-0">
                              SIMPLE
                            </span>
                          )}
                        </div>
                        {agent.description && (
                          <p className="text-[10px] text-slate-500 truncate mt-0.5">{agent.description}</p>
                        )}
                        {agent.config.enabledTools && agent.config.enabledTools.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {agent.config.enabledTools.slice(0, 3).map((t) => (
                              <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/50">
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Center — Workspace */}
            <div className="flex-1 flex flex-col min-w-0">
              {!selectedAgent ? (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center">
                    <Zap size={48} className="text-slate-800 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-slate-400">Select an Agent</h3>
                    <p className="text-sm text-slate-600 mt-1">
                      Choose an agent from the left panel to run it
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {/* Agent Header */}
                  <div className="px-6 py-4 border-b border-slate-800 bg-slate-900/30 shrink-0">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${wsIsAgentic ? 'bg-blue-600/20 border border-blue-600/30' : 'bg-slate-700/30 border border-slate-700/50'}`}>
                          {wsIsAgentic ? <Zap size={20} className="text-blue-400" /> : <Bot size={20} className="text-slate-400" />}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h2 className="text-white font-bold text-lg truncate">{selectedAgent.name}</h2>
                            {wsIsAgentic ? (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-900/30 text-blue-400 border border-blue-900/50 font-medium shrink-0">
                                AGENTIC
                              </span>
                            ) : (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-500 border border-slate-700/50 font-medium shrink-0">
                                SIMPLE
                              </span>
                            )}
                            {wsRunning && wsIsAgentic && wsIter > 0 && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-900/30 text-blue-400 border border-blue-900/50 font-mono animate-pulse shrink-0">
                                iter {wsIter}/{wsMaxIter}
                              </span>
                            )}
                          </div>
                          {selectedAgent.description && (
                            <p className="text-xs text-slate-400 truncate">{selectedAgent.description}</p>
                          )}
                        </div>
                      </div>
                    </div>
                    {/* Config badges */}
                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                        {selectedAgent.config.selectedModel || 'No model'}
                      </span>
                      <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
                        <Thermometer size={10} /> {selectedAgent.config.temperature}
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
                    </div>
                  </div>

                  {/* Variable Inputs */}
                  {selectedAgent.config.variables && selectedAgent.config.variables.length > 0 && (
                    <div className="px-6 py-4 border-b border-slate-800 bg-slate-900/20 shrink-0">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3">
                        Variables
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {selectedAgent.config.variables.map((v) => (
                          <div key={v.name}>
                            <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">
                              {v.label || v.name}
                            </label>
                            {(v.defaultValue?.length ?? 0) > 80 ? (
                              <textarea
                                value={wsVars[v.name] || ''}
                                onChange={(e) => setWsVars((prev) => ({ ...prev, [v.name]: e.target.value }))}
                                rows={2}
                                placeholder={v.defaultValue || `Enter ${v.name}...`}
                                disabled={wsRunning}
                                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500 outline-none resize-none font-mono disabled:opacity-50"
                              />
                            ) : (
                              <input
                                type="text"
                                value={wsVars[v.name] || ''}
                                onChange={(e) => setWsVars((prev) => ({ ...prev, [v.name]: e.target.value }))}
                                placeholder={v.defaultValue || `Enter ${v.name}...`}
                                disabled={wsRunning}
                                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500 outline-none font-mono disabled:opacity-50"
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Action Bar */}
                  <div className="px-6 py-3 border-b border-slate-800 flex items-center gap-3 bg-slate-900/10 shrink-0">
                    {wsRunning ? (
                      <button
                        onClick={handleWsStop}
                        className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors"
                      >
                        <Square size={12} className="fill-current" /> Stop
                      </button>
                    ) : (
                      <button
                        onClick={startWsRun}
                        className="flex items-center gap-1.5 px-5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
                      >
                        <Play size={12} className="fill-current" />
                        {wsOutput ? 'Re-run' : 'Run Agent'}
                      </button>
                    )}
                    {wsOutput && !wsRunning && (
                      <button
                        onClick={() => { navigator.clipboard.writeText(wsOutput); setWsCopied(true); setTimeout(() => setWsCopied(false), 2000); }}
                        className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors border border-slate-700"
                      >
                        {wsCopied ? <><CheckCircle2 size={12} className="text-emerald-400" /> Copied!</> : <><Copy size={12} /> Copy</>}
                      </button>
                    )}
                    {wsDoneInfo && (
                      <span className="text-[11px] text-emerald-400 flex items-center gap-1 ml-auto">
                        <CheckCircle2 size={12} />
                        {wsDoneInfo.iterations} iter, {wsDoneInfo.total_tool_calls} tool call{wsDoneInfo.total_tool_calls !== 1 ? 's' : ''}
                      </span>
                    )}
                    {wsRunning && (
                      <span className="text-[11px] text-blue-400 flex items-center gap-1 ml-auto animate-pulse">
                        <Loader2 size={12} className="animate-spin" /> Processing...
                      </span>
                    )}
                  </div>

                  {/* Execution Area */}
                  <div className="flex-1 overflow-y-auto p-6 space-y-4" ref={wsOutputRef}>
                    {wsError && (
                      <div className="bg-red-900/20 border border-red-900/50 p-3 rounded-lg text-red-200 text-sm">
                        {wsError}
                      </div>
                    )}

                    {/* Agentic Steps */}
                    {wsIsAgentic && wsSteps.length > 0 && (
                      <div className="space-y-1.5">
                        {renderAgentSteps(wsSteps, wsExpandedSteps, wsMaxIter, toggleWsStep)}
                      </div>
                    )}

                    {/* Output */}
                    {(wsOutput || (wsRunning && wsSteps.some((s) => s.type === 'final_answer_start'))) && (
                      <div className="bg-slate-950 border border-slate-800 rounded-lg p-5">
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 bg-blue-600 rounded-lg flex-shrink-0 flex items-center justify-center shadow-lg shadow-blue-900/20">
                            <Sparkles className="text-white w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0 text-slate-300 text-sm leading-relaxed break-words">
                            {(() => {
                              const parsed = parseThinkTags(wsOutput);
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
                            {wsRunning && <span className="inline-block w-2 h-4 bg-blue-500 ml-1 animate-pulse" />}
                          </div>
                        </div>
                      </div>
                    )}

                    {!wsRunning && !wsOutput && wsSteps.length === 0 && (
                      <div className="flex flex-col items-center justify-center py-16 text-slate-600">
                        <Play size={36} className="mb-3 opacity-30" />
                        <p className="text-sm">
                          Click <span className="text-blue-400">Run Agent</span> to start execution
                        </p>
                        {wsIsAgentic && (
                          <p className="text-[11px] text-slate-700 mt-1">
                            The agent will reason, call tools, and produce a final answer
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Right — Tools & Config */}
            <div className="w-72 border-l border-slate-800 flex flex-col bg-slate-900/50 shrink-0">
              <div className="flex border-b border-slate-800 shrink-0">
                <button
                  onClick={() => setWsRightTab('tools')}
                  className={`flex-1 px-4 py-3 text-xs font-medium transition-colors ${
                    wsRightTab === 'tools'
                      ? 'text-blue-400 border-b-2 border-blue-500 bg-blue-600/5'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <Wrench size={12} className="inline mr-1.5" /> Tool Registry
                </button>
                <button
                  onClick={() => setWsRightTab('config')}
                  className={`flex-1 px-4 py-3 text-xs font-medium transition-colors ${
                    wsRightTab === 'config'
                      ? 'text-blue-400 border-b-2 border-blue-500 bg-blue-600/5'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <Settings2 size={12} className="inline mr-1.5" /> Agent Config
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                {wsRightTab === 'tools' ? (
                  <div className="space-y-3">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      Available Tools ({tools.length})
                    </p>
                    {tools.map((tool) => {
                      const isActive = selectedAgent?.config.enabledTools?.includes(tool.name);
                      return (
                        <div
                          key={tool.name}
                          className={`p-3 rounded-lg border transition-colors ${
                            isActive
                              ? 'bg-blue-900/10 border-blue-900/30'
                              : 'bg-slate-800/30 border-slate-700/50'
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-1.5">
                            {toolIconsLg[tool.name] || <Wrench size={18} className="text-slate-400" />}
                            <span className="text-sm font-medium text-slate-200">{tool.name}</span>
                            {isActive && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-400 border border-blue-900/50 ml-auto">
                                ACTIVE
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500 leading-relaxed">{tool.description}</p>
                        </div>
                      );
                    })}
                    {tools.length === 0 && (
                      <div className="text-center py-8">
                        <Wrench size={24} className="text-slate-700 mx-auto mb-2" />
                        <p className="text-xs text-slate-600">No tools available</p>
                      </div>
                    )}
                    {wsIsAgentic && (
                      <div className="mt-4 pt-4 border-t border-slate-800">
                        <div className="flex items-center gap-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3">
                          <Info size={10} /> How ReAct Works
                        </div>
                        <div className="space-y-2">
                          {[
                            { step: '1', label: 'Reason', desc: 'LLM analyzes the task' },
                            { step: '2', label: 'Act', desc: 'Calls a tool if needed' },
                            { step: '3', label: 'Observe', desc: 'Reviews tool results' },
                            { step: '4', label: 'Repeat', desc: 'Until answer is ready' },
                          ].map((item) => (
                            <div key={item.step} className="flex items-center gap-2 text-[11px]">
                              <span className="w-5 h-5 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-[9px] text-blue-400 font-bold shrink-0">
                                {item.step}
                              </span>
                              <span className="text-slate-300 font-medium">{item.label}</span>
                              <span className="text-slate-600">{item.desc}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {selectedAgent ? (
                      <>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Configuration</p>
                        {selectedAgent.config.enabledTools && selectedAgent.config.enabledTools.length > 0 && (
                          <div>
                            <p className="text-[10px] text-slate-500 font-bold uppercase mb-2">Enabled Tools</p>
                            <div className="space-y-1.5">
                              {selectedAgent.config.enabledTools.map((t) => (
                                <div key={t} className="flex items-center gap-2 text-xs text-slate-300 bg-slate-800/50 rounded px-2.5 py-1.5 border border-slate-700/50">
                                  {toolIconsSm[t] || <Wrench size={12} className="text-slate-400" />}
                                  {t}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {selectedAgent.config.systemPrompt && (
                          <div>
                            <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">System Prompt</p>
                            <pre className="text-[11px] text-slate-400 font-mono bg-slate-950/50 rounded p-2 whitespace-pre-wrap max-h-32 overflow-y-auto border border-slate-800">
                              {selectedAgent.config.systemPrompt}
                            </pre>
                          </div>
                        )}
                        {selectedAgent.config.promptTemplate && (
                          <div>
                            <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">Prompt Template</p>
                            <pre className="text-[11px] text-slate-400 font-mono bg-slate-950/50 rounded p-2 whitespace-pre-wrap max-h-32 overflow-y-auto border border-slate-800">
                              {selectedAgent.config.promptTemplate}
                            </pre>
                          </div>
                        )}
                        <div>
                          <p className="text-[10px] text-slate-500 font-bold uppercase mb-2">Parameters</p>
                          <div className="grid grid-cols-2 gap-2 text-[11px]">
                            {[
                              ['Temperature', selectedAgent.config.temperature],
                              ['Max Tokens', selectedAgent.config.maxTokens],
                              ['Top P', selectedAgent.config.topP],
                              ['Thinking', selectedAgent.config.thinking ? 'On' : 'Off'],
                              ['RAG', selectedAgent.config.ragEnabled ? 'On' : 'Off'],
                              ['Max Iter', selectedAgent.config.maxIterations || 10],
                            ].map(([label, value]) => (
                              <div key={String(label)} className="flex justify-between bg-slate-800/30 rounded px-2 py-1.5 border border-slate-700/30">
                                <span className="text-slate-500">{label}</span>
                                <span className="text-slate-300 font-mono">{String(value)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="text-center py-8">
                        <Settings2 size={24} className="text-slate-700 mx-auto mb-2" />
                        <p className="text-xs text-slate-600">Select an agent to see config</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ─── Pre-run Input Modal (Pipeline) ────────────────────────────────── */}
      {showRunModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md mx-4">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center gap-3">
              <div className="w-8 h-8 bg-blue-600/20 border border-blue-600/30 rounded-lg flex items-center justify-center shrink-0">
                <Play size={14} className="text-blue-400" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Pipeline Input</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">Provide values for runtime variables</p>
              </div>
              <button
                onClick={() => setShowRunModal(false)}
                className="ml-auto text-slate-500 hover:text-slate-300 transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              {collectInputVars(editSteps, agents).map((v) => (
                <div key={v.name}>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1.5">
                    <span className="font-mono text-amber-400">{'{{'}input:{v.name}{'}}'}</span>
                    {v.label !== v.name && <span className="ml-2 text-slate-500">{v.label}</span>}
                  </label>
                  <textarea
                    value={runInputValues[v.name] || ''}
                    onChange={(e) => setRunInputValues((prev) => ({ ...prev, [v.name]: e.target.value }))}
                    placeholder={v.defaultValue || `Enter ${v.label}...`}
                    rows={3}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500 resize-none placeholder:text-slate-600"
                  />
                </div>
              ))}
            </div>
            <div className="px-5 py-4 border-t border-slate-800 flex justify-end gap-2">
              <button
                onClick={() => setShowRunModal(false)}
                className="px-4 py-2 text-xs text-slate-400 hover:text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { setShowRunModal(false); executePipeRun(runInputValues); }}
                className="flex items-center gap-1.5 px-5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
              >
                <Play size={12} className="fill-current" /> Run Pipeline
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Workflows;
