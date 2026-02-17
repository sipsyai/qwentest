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
  GripVertical,
  Sparkles,
  Wrench,
  Search,
  Database,
  Globe,
  Settings2,
  Pencil,
} from 'lucide-react';
import { getAgents, Agent } from '../services/agentsApi';
import {
  getWorkflows,
  getWorkflow,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  runWorkflow,
  Workflow,
  WorkflowStep,
  WorkflowRunCallbacks,
} from '../services/workflowApi';
import { parseThinkTags, renderMarkdownToHTML } from '../services/markdown';

// Tool icon mapping (small)
const toolIconsSm: Record<string, React.ReactNode> = {
  kb_search: <Search size={12} className="text-amber-400" />,
  dataset_query: <Database size={12} className="text-emerald-400" />,
  web_fetch: <Globe size={12} className="text-blue-400" />,
  sub_agent: <Bot size={12} className="text-purple-400" />,
};

// Generate a simple unique ID
const uid = () => Math.random().toString(36).slice(2, 10);

const Workflows = () => {
  // --- Data ---
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  // --- Editor state ---
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editSteps, setEditSteps] = useState<WorkflowStep[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // --- Run state ---
  const [isRunning, setIsRunning] = useState(false);
  const [runStepStates, setRunStepStates] = useState<
    Record<string, 'pending' | 'running' | 'done' | 'error'>
  >({});
  const [runStepOutputs, setRunStepOutputs] = useState<Record<string, string>>({});
  const [runStepErrors, setRunStepErrors] = useState<Record<string, string>>({});
  const [runToolCalls, setRunToolCalls] = useState<
    Record<string, { tool: string; args: any; result?: string }[]>
  >({});
  const [workflowDone, setWorkflowDone] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const [expandedRunSteps, setExpandedRunSteps] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);

  // --- Fetch data ---
  const fetchData = async () => {
    try {
      const [wfRes, agRes] = await Promise.all([
        getWorkflows(),
        getAgents(),
      ]);
      setWorkflows(wfRes.data);
      setAgents(agRes.data);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Auto-scroll execution area
  useEffect(() => {
    if (outputRef.current && isRunning) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [runStepOutputs, runStepStates, isRunning]);

  // --- Helpers ---
  const agentById = (id: string) => agents.find((a) => a.id === id);

  const selectWorkflow = (wf: Workflow) => {
    handleStop();
    setSelectedId(wf.id);
    setEditName(wf.name);
    setEditDesc(wf.description);
    setEditSteps(wf.steps.map((s) => ({ ...s })));
    setIsDirty(false);
    resetRunState();
  };

  const createNew = () => {
    handleStop();
    setSelectedId('__new__');
    setEditName('New Workflow');
    setEditDesc('');
    setEditSteps([]);
    setIsDirty(true);
    resetRunState();
  };

  const resetRunState = () => {
    setRunStepStates({});
    setRunStepOutputs({});
    setRunStepErrors({});
    setRunToolCalls({});
    setWorkflowDone(false);
    setRunError(null);
    setExpandedRunSteps(new Set());
  };

  const markDirty = () => setIsDirty(true);

  // --- Step management ---
  const addStep = () => {
    const newStep: WorkflowStep = {
      id: uid(),
      agentId: '',
      agentName: '',
      variableMappings: {},
    };
    setEditSteps([...editSteps, newStep]);
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

    // Build default variable mappings
    const mappings: Record<string, string> = {};
    if (agent.config.variables) {
      for (const v of agent.config.variables) {
        if (stepIndex > 0) {
          // Default: use previous output for first variable, empty for others
          mappings[v.name] = Object.keys(mappings).length === 0 ? '{{prev_output}}' : '';
        } else {
          mappings[v.name] = v.defaultValue || '';
        }
      }
    }

    updateStep(stepIndex, {
      agentId: agent.id,
      agentName: agent.name,
      variableMappings: mappings,
    });
  };

  const updateMapping = (stepIndex: number, varName: string, value: string) => {
    setEditSteps((prev) => {
      const next = [...prev];
      next[stepIndex] = {
        ...next[stepIndex],
        variableMappings: {
          ...next[stepIndex].variableMappings,
          [varName]: value,
        },
      };
      return next;
    });
    markDirty();
  };

  // --- Save / Delete ---
  const handleSave = async () => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: editName.trim(),
        description: editDesc.trim(),
        steps: editSteps,
      };

      if (selectedId === '__new__') {
        const created = await createWorkflow(payload);
        setWorkflows((prev) => [created, ...prev]);
        setSelectedId(created.id);
      } else if (selectedId) {
        const updated = await updateWorkflow(selectedId, payload);
        setWorkflows((prev) =>
          prev.map((w) => (w.id === selectedId ? updated : w))
        );
      }
      setIsDirty(false);
    } catch (err) {
      console.error('Failed to save workflow:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
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

  // --- Run workflow ---
  const handleRun = () => {
    if (!selectedId || selectedId === '__new__' || editSteps.length === 0) return;

    resetRunState();
    setIsRunning(true);
    setWorkflowDone(false);

    // Initialize all steps as pending
    const initStates: Record<string, 'pending'> = {};
    for (const s of editSteps) initStates[s.id] = 'pending';
    setRunStepStates(initStates);

    const controller = new AbortController();
    abortRef.current = controller;

    const callbacks: WorkflowRunCallbacks = {
      onStepStart: (data) => {
        setRunStepStates((prev) => ({ ...prev, [data.step_id]: 'running' }));
        setExpandedRunSteps((prev) => new Set([...prev, data.index]));
      },
      onStepStream: (data) => {
        setRunStepOutputs((prev) => ({
          ...prev,
          [data.step_id]: (prev[data.step_id] || '') + data.content,
        }));
      },
      onStepDone: (data) => {
        setRunStepStates((prev) => ({ ...prev, [data.step_id]: 'done' }));
        setRunStepOutputs((prev) => ({
          ...prev,
          [data.step_id]: data.output_preview || prev[data.step_id] || '',
        }));
      },
      onStepError: (data) => {
        setRunStepStates((prev) => ({ ...prev, [data.step_id]: 'error' }));
        setRunStepErrors((prev) => ({ ...prev, [data.step_id]: data.error }));
      },
      onStepToolCall: (data) => {
        setRunToolCalls((prev) => ({
          ...prev,
          [data.step_id]: [
            ...(prev[data.step_id] || []),
            { tool: data.tool, args: data.args },
          ],
        }));
      },
      onStepToolResult: (data) => {
        setRunToolCalls((prev) => {
          const calls = [...(prev[data.step_id] || [])];
          // Attach result to last matching call
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
        setWorkflowDone(true);
        setIsRunning(false);
        abortRef.current = null;
      },
      onError: (msg) => {
        setRunError(msg);
        setIsRunning(false);
        abortRef.current = null;
      },
      onComplete: () => {
        setIsRunning(false);
        abortRef.current = null;
      },
    };

    runWorkflow(selectedId, callbacks, controller.signal);
  };

  const handleStop = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      setIsRunning(false);
      abortRef.current = null;
    }
  };

  const copyOutput = (stepId: string) => {
    const text = runStepOutputs[stepId] || '';
    navigator.clipboard.writeText(text);
    setCopied(stepId);
    setTimeout(() => setCopied(null), 2000);
  };

  const toggleRunStep = (idx: number) => {
    setExpandedRunSteps((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  // Get all possible variable source options for a step
  const getSourceOptions = (stepIndex: number) => {
    const sources: { label: string; value: string }[] = [];
    if (stepIndex > 0) {
      sources.push({ label: 'Previous step output', value: '{{prev_output}}' });
    }
    // Reference specific steps
    for (let i = 0; i < stepIndex; i++) {
      const s = editSteps[i];
      const agentName = s.agentName || `Step ${i + 1}`;
      sources.push({
        label: `Step ${i + 1}: ${agentName}`,
        value: `{{step:${s.id}}}`,
      });
    }
    sources.push({ label: 'Custom value', value: '__custom__' });
    return sources;
  };

  // --- Loading state ---
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
      </div>
    );
  }

  const isNew = selectedId === '__new__';
  const canRun = selectedId && !isNew && editSteps.length > 0 && editSteps.every((s) => s.agentId);
  const hasRunResults = Object.keys(runStepStates).length > 0;

  return (
    <div className="flex h-screen">
      {/* ─── LEFT PANEL: Workflow List ─── */}
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
                  <span className="text-sm font-medium truncate flex-1">
                    {wf.name}
                  </span>
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
            <Plus size={14} />
            New Workflow
          </button>
        </div>
      </div>

      {/* ─── CENTER: Pipeline Builder + Execution ─── */}
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
            <div className="px-6 py-4 border-b border-slate-800 bg-slate-900/30">
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0 flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-600/20 border border-emerald-600/30 rounded-xl flex items-center justify-center shrink-0">
                    <GitBranch size={20} className="text-emerald-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => {
                        setEditName(e.target.value);
                        markDirty();
                      }}
                      placeholder="Workflow name..."
                      className="bg-transparent text-white font-bold text-lg w-full outline-none placeholder:text-slate-600 focus:bg-slate-800/30 rounded px-1 -mx-1"
                    />
                    <input
                      type="text"
                      value={editDesc}
                      onChange={(e) => {
                        setEditDesc(e.target.value);
                        markDirty();
                      }}
                      placeholder="Description (optional)..."
                      className="bg-transparent text-slate-400 text-xs w-full outline-none placeholder:text-slate-700 focus:bg-slate-800/30 rounded px-1 -mx-1 mt-0.5"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {isDirty && (
                    <span className="text-[10px] text-amber-400 mr-1">Unsaved</span>
                  )}
                  <button
                    onClick={handleSave}
                    disabled={saving || !editName.trim()}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-md transition-colors disabled:opacity-50"
                  >
                    {saving ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Save size={12} />
                    )}
                    Save
                  </button>
                  {!isNew && (
                    <button
                      onClick={handleDelete}
                      disabled={deleting}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-md transition-colors disabled:opacity-50"
                    >
                      {deleting ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Trash2 size={12} />
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* Action bar */}
              <div className="flex items-center gap-3 mt-3">
                {isRunning ? (
                  <button
                    onClick={handleStop}
                    className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors"
                  >
                    <Square size={12} className="fill-current" /> Stop
                  </button>
                ) : (
                  <button
                    onClick={handleRun}
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

                {workflowDone && (
                  <span className="text-[11px] text-emerald-400 flex items-center gap-1 ml-auto">
                    <CheckCircle2 size={12} />
                    Pipeline complete
                  </span>
                )}

                {isRunning && (
                  <span className="text-[11px] text-blue-400 flex items-center gap-1 ml-auto animate-pulse">
                    <Loader2 size={12} className="animate-spin" />
                    Running...
                  </span>
                )}
              </div>
            </div>

            {/* Pipeline Area */}
            <div className="flex-1 overflow-y-auto" ref={outputRef}>
              <div className="p-6 max-w-3xl mx-auto space-y-0">
                {runError && (
                  <div className="bg-red-900/20 border border-red-900/50 p-3 rounded-lg text-red-200 text-sm mb-4">
                    {runError}
                  </div>
                )}

                {editSteps.map((step, idx) => {
                  const agent = agentById(step.agentId);
                  const stepState = runStepStates[step.id];
                  const stepOutput = runStepOutputs[step.id] || '';
                  const stepError = runStepErrors[step.id];
                  const toolCalls = runToolCalls[step.id] || [];
                  const isExpanded = expandedRunSteps.has(idx);
                  const variables = agent?.config.variables || [];

                  return (
                    <React.Fragment key={step.id}>
                      {/* Arrow connector */}
                      {idx > 0 && (
                        <div className="flex justify-center py-1">
                          <div className="flex flex-col items-center">
                            <div className="w-px h-4 bg-slate-700" />
                            <ArrowDown size={14} className="text-slate-600 -my-0.5" />
                            <div className="w-px h-1 bg-slate-700" />
                          </div>
                        </div>
                      )}

                      {/* Step Card */}
                      <div
                        className={`border rounded-xl transition-colors ${
                          stepState === 'running'
                            ? 'border-blue-500/50 bg-blue-900/10 shadow-lg shadow-blue-900/10'
                            : stepState === 'done'
                            ? 'border-emerald-500/30 bg-emerald-900/5'
                            : stepState === 'error'
                            ? 'border-red-500/30 bg-red-900/5'
                            : 'border-slate-700/60 bg-slate-900/30'
                        }`}
                      >
                        {/* Step Header */}
                        <div className="flex items-center gap-3 px-4 py-3">
                          {/* Drag / order */}
                          <div className="flex flex-col gap-0.5 shrink-0">
                            <button
                              onClick={() => moveStep(idx, idx - 1)}
                              disabled={idx === 0 || isRunning}
                              className="text-slate-600 hover:text-slate-300 disabled:opacity-20 disabled:cursor-not-allowed"
                              title="Move up"
                            >
                              <ChevronRight size={12} className="rotate-[-90deg]" />
                            </button>
                            <button
                              onClick={() => moveStep(idx, idx + 1)}
                              disabled={idx === editSteps.length - 1 || isRunning}
                              className="text-slate-600 hover:text-slate-300 disabled:opacity-20 disabled:cursor-not-allowed"
                              title="Move down"
                            >
                              <ChevronRight size={12} className="rotate-90" />
                            </button>
                          </div>

                          {/* Step number badge */}
                          <div
                            className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                              stepState === 'running'
                                ? 'bg-blue-600 text-white'
                                : stepState === 'done'
                                ? 'bg-emerald-600 text-white'
                                : stepState === 'error'
                                ? 'bg-red-600 text-white'
                                : 'bg-slate-800 text-slate-400 border border-slate-700'
                            }`}
                          >
                            {stepState === 'running' ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : stepState === 'done' ? (
                              <CheckCircle2 size={14} />
                            ) : stepState === 'error' ? (
                              <AlertCircle size={14} />
                            ) : (
                              idx + 1
                            )}
                          </div>

                          {/* Agent selector */}
                          <div className="flex-1 min-w-0">
                            <select
                              value={step.agentId}
                              onChange={(e) => selectAgentForStep(idx, e.target.value)}
                              disabled={isRunning}
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

                          {/* Agentic badge */}
                          {agent?.config.agentMode === 'react' && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-400 border border-blue-900/50 font-medium shrink-0">
                              AGENTIC
                            </span>
                          )}

                          {/* Remove step */}
                          <button
                            onClick={() => removeStep(idx)}
                            disabled={isRunning}
                            className="text-slate-600 hover:text-red-400 transition-colors disabled:opacity-30 shrink-0"
                            title="Remove step"
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
                              const sources = getSourceOptions(idx);
                              const isRef =
                                currentVal.startsWith('{{prev_output}}') ||
                                currentVal.startsWith('{{step:');
                              const matchingSource = sources.find(
                                (s) => s.value === currentVal
                              );

                              return (
                                <div key={v.name} className="flex items-center gap-2">
                                  <span className="text-[11px] text-slate-400 font-mono w-28 shrink-0 truncate" title={v.name}>
                                    {'{{'}{v.name}{'}}'}
                                  </span>
                                  <span className="text-slate-600 text-[10px]">&larr;</span>
                                  <select
                                    value={
                                      matchingSource ? matchingSource.value : '__custom__'
                                    }
                                    onChange={(e) => {
                                      if (e.target.value === '__custom__') {
                                        updateMapping(idx, v.name, '');
                                      } else {
                                        updateMapping(idx, v.name, e.target.value);
                                      }
                                    }}
                                    disabled={isRunning}
                                    className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] text-white outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 flex-1 min-w-0"
                                  >
                                    {sources.map((s) => (
                                      <option key={s.value} value={s.value}>
                                        {s.label}
                                      </option>
                                    ))}
                                  </select>
                                  {/* Show text input if custom */}
                                  {!isRef && !matchingSource && (
                                    <input
                                      type="text"
                                      value={currentVal}
                                      onChange={(e) =>
                                        updateMapping(idx, v.name, e.target.value)
                                      }
                                      placeholder={v.defaultValue || 'Enter value...'}
                                      disabled={isRunning}
                                      className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] text-white outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 flex-1 min-w-0 font-mono"
                                    />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Agent info row */}
                        {agent && (
                          <div className="px-4 pb-3 flex flex-wrap items-center gap-1.5 mx-3">
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-400 border border-slate-700/50">
                              {agent.config.selectedModel || 'default'}
                            </span>
                            {agent.config.enabledTools?.map((t) => (
                              <span
                                key={t}
                                className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-slate-800/60 text-slate-500 border border-slate-700/30"
                              >
                                {toolIconsSm[t] || <Wrench size={10} className="text-slate-500" />}
                                {t}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Execution Output (when running or done) */}
                        {(stepState === 'running' || stepState === 'done' || stepState === 'error') && (
                          <div className="border-t border-slate-800/50">
                            <button
                              onClick={() => toggleRunStep(idx)}
                              className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-slate-800/30 transition-colors"
                            >
                              {isExpanded ? (
                                <ChevronDown size={12} className="text-slate-500" />
                              ) : (
                                <ChevronRight size={12} className="text-slate-500" />
                              )}
                              <span className="text-[11px] text-slate-400 font-medium">
                                {stepState === 'running'
                                  ? 'Running...'
                                  : stepState === 'done'
                                  ? 'Output'
                                  : 'Error'}
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
                                {/* Tool calls */}
                                {toolCalls.length > 0 && (
                                  <div className="space-y-1.5">
                                    {toolCalls.map((tc, tci) => (
                                      <div
                                        key={tci}
                                        className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-2.5"
                                      >
                                        <div className="flex items-center gap-2 mb-1">
                                          {toolIconsSm[tc.tool] || (
                                            <Wrench size={12} className="text-slate-400" />
                                          )}
                                          <span className="text-xs font-medium text-slate-300">
                                            {tc.tool}
                                          </span>
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
                                            {tc.result.slice(0, 500)}
                                            {tc.result.length > 500 ? '...' : ''}
                                          </pre>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* Step Error */}
                                {stepError && (
                                  <div className="bg-red-900/20 border border-red-900/50 rounded-lg px-3 py-2 text-xs text-red-300">
                                    {stepError}
                                  </div>
                                )}

                                {/* Step Output */}
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
                                                    <summary className="text-[10px] font-bold text-purple-400 cursor-pointer">
                                                      Thinking...
                                                    </summary>
                                                    <div className="mt-1 text-[10px] text-purple-300/70 whitespace-pre-wrap font-mono">
                                                      {parsed.thinking}
                                                    </div>
                                                  </details>
                                                )}
                                                <div
                                                  className="text-xs"
                                                  dangerouslySetInnerHTML={{
                                                    __html: renderMarkdownToHTML(parsed.content),
                                                  }}
                                                />
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
                                        onClick={() => copyOutput(step.id)}
                                        className="absolute top-2 right-2 p-1.5 text-slate-500 hover:text-slate-300 bg-slate-800/80 rounded border border-slate-700/50 transition-colors"
                                        title="Copy output"
                                      >
                                        {copied === step.id ? (
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

                {/* Add Step Button */}
                {!isRunning && (
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
                {!isRunning && (
                  <div className="flex justify-center">
                    <button
                      onClick={addStep}
                      className="flex items-center gap-2 px-6 py-3 text-xs font-medium text-slate-400 bg-slate-800/30 hover:bg-slate-800/60 hover:text-white border-2 border-dashed border-slate-700 hover:border-slate-500 rounded-xl transition-all"
                    >
                      <Plus size={14} />
                      Add Step
                    </button>
                  </div>
                )}

                {/* Empty pipeline */}
                {editSteps.length === 0 && (
                  <div className="text-center py-12">
                    <GitBranch size={36} className="text-slate-800 mx-auto mb-3" />
                    <p className="text-sm text-slate-500">
                      Add steps to build your pipeline
                    </p>
                    <p className="text-[11px] text-slate-700 mt-1">
                      Each step runs an agent and passes its output to the next
                    </p>
                  </div>
                )}

                {/* Pipeline complete summary */}
                {workflowDone && (
                  <div className="mt-6 bg-emerald-900/10 border border-emerald-900/30 rounded-xl p-5 text-center">
                    <CheckCircle2 size={24} className="text-emerald-400 mx-auto mb-2" />
                    <p className="text-sm font-medium text-emerald-300">
                      Pipeline Complete
                    </p>
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

      {/* ─── RIGHT PANEL: Agent Palette ─── */}
      <div className="w-64 border-l border-slate-800 flex flex-col bg-slate-900/50 shrink-0">
        <div className="px-4 py-4 border-b border-slate-800">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Bot size={12} />
            Agent Palette
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
                  <p className="text-[10px] text-slate-500 line-clamp-2">
                    {agent.description}
                  </p>
                )}
                {agent.config.variables && agent.config.variables.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {agent.config.variables.map((v) => (
                      <span
                        key={v.name}
                        className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-500 border border-slate-700/30"
                      >
                        {'{{'}{v.name}{'}}'}
                      </span>
                    ))}
                  </div>
                )}
                {agent.config.enabledTools && agent.config.enabledTools.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {agent.config.enabledTools.map((t) => (
                      <span
                        key={t}
                        className="flex items-center gap-0.5 text-[8px] px-1 py-0.5 rounded bg-slate-800/60 text-slate-500"
                      >
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

        {/* Data flow info */}
        <div className="px-4 py-3 border-t border-slate-800">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
            Data Flow
          </p>
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
              <span className="text-slate-400 font-mono shrink-0">text</span>
              <span className="text-slate-600">Literal value</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Workflows;
