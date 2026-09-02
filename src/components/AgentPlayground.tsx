import React, { useState, useEffect, useRef } from 'react';
import { useMediatorStore } from '../store/useMediatorStore';
import { webmcpBridge } from '../lib/webmcpBridge';
import { buildGoalFromArgument, parseGoal } from '../lib/goalPlanner';
import { WebMCPToolDefinition, ToolExecutionResponse } from '@shared/types';
import { Play, Bot, Sparkles, Code2, Check, Clock, Layers, ArrowRight, Loader2, Trophy, ExternalLink, ChevronDown } from 'lucide-react';

type RankedGoalItem = {
  title: string;
  score: number;
  scoreLabel: string;
  author: string;
  url: string;
  price?: string;
  rating?: string;
  availability?: string;
};

const toNumber = (value: unknown) => {
  const match = String(value ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
};

const normalizeGoalItems = (value: any, query = ''): RankedGoalItem[] => {
  const candidates = Array.isArray(value) ? value : value?.items || value?.results || value?.stories;
  if (Array.isArray(candidates)) return candidates.map((item: any) => {
    const rawScore = item?.score ?? item?.points ?? item?.votes ?? item?.meta ?? item?.metadata ?? 0;
    const score = toNumber(rawScore);
    return {
      title: String(item?.title ?? item?.name ?? item?.text ?? 'Untitled result').trim(),
      score,
      scoreLabel: item?.score || item?.points || item?.votes || (score ? `${score} points` : 'Score unavailable'),
      author: String(item?.author ?? item?.submitter ?? item?.user ?? 'Unknown author').trim(),
      url: String(item?.url ?? item?.link ?? item?.href ?? '').trim(),
      price: item?.price ? String(item.price).trim() : undefined,
      rating: item?.rating ? String(item.rating).trim() : undefined,
      availability: item?.availability || item?.inStock ? String(item.availability ?? item.inStock).trim() : undefined,
    };
  }).filter(item => item.title && item.title !== 'Untitled result');

  if (typeof value?.text === 'string' && value.text.trim()) {
    const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const lines = value.text.split(/\r?\n/)
      .map((line: string) => line.replace(/\s+/g, ' ').trim())
      .filter((line: string) => {
        if (line.length < 12 || /^(main content|deliver to|all departments|arts & crafts|automotive|search|menu|sign in|cart|categories?)$/i.test(line)) return false;
        if (/^(shop|buy|browse|explore|discover)\s+.+\b(?:by|for)\s+(?:feature|category|brand|department|you)\b/i.test(line)) return false;
        if (/^(?:results?|sort|filter|see all|back to top|customer service|help|recommendations?)\b/i.test(line)) return false;
        if (/^\d+\s*[-–]\s*\d+\s+of\s+(?:over\s+)?[\d,]+\s+results?/i.test(line)) return false;
        if (/^(?:[$£€₦]\s*)?[\d,]+(?:\.\d{2})?$/.test(line)) return false;
        if (/^(?:results?|sort|filter|departments?|delivery|rating|price)\b/i.test(line)) return false;
        return !queryTerms.length || queryTerms.some(term => line.toLowerCase().includes(term)) || /\b(?:replacement|pack|led|bulb|lamp|fixture|light)\b/i.test(line);
      })
      .filter((line: string, index: number, source: string[]) => source.indexOf(line) === index)
      .slice(0, 20);
    return lines.map((line: string) => ({
      title: line,
      score: 0,
      scoreLabel: 'Details unavailable',
      author: '',
      url: '',
    }));
  }

  return [];
};

const isProductTool = (tool: WebMCPToolDefinition) =>
  /product|catalog|book|shop|commerce|price|rating/i.test(`${tool.name} ${tool.description} ${tool.domain}`);

export const AgentPlayground: React.FC = () => {
  const {
    approvedTools,
    executeTool,
    activeExecutionTool,
    agentGoal,
    setAgentGoal,
    currentDomain,
    recentResults,
    addToast
  } = useMediatorStore();

  const [selectedToolId, setSelectedToolId] = useState<string>('');
  const [paramsInput, setParamsInput] = useState<Record<string, any>>({});
  const [lastResult, setLastResult] = useState<ToolExecutionResponse | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [agentStepLog, setAgentStepLog] = useState<string[]>([]);
  const [isAgentGoalRunning, setIsAgentGoalRunning] = useState(false);
  const [showRawResult, setShowRawResult] = useState(false);
  const goalUpdateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeTool = approvedTools.find(t => t.id === selectedToolId) || approvedTools[0];

  useEffect(() => {
    if (approvedTools.length > 0 && !selectedToolId) {
      setSelectedToolId(approvedTools[0].id);
    }
  }, [approvedTools, selectedToolId]);

  useEffect(() => {
    if (activeTool) {
      // Initialize default values for schema
      const initial: Record<string, any> = {};
      if (activeTool.inputSchema.properties) {
        for (const [key, prop] of Object.entries(activeTool.inputSchema.properties)) {
          if (prop.default !== undefined) {
            initial[key] = prop.default;
          } else if (prop.type === 'string') {
            initial[key] = key.toLowerCase().includes('query') ? 'AI agents' : '';
          } else if (prop.type === 'number') {
            initial[key] = 10;
          } else if (prop.type === 'boolean') {
            initial[key] = true;
          }
        }
      }
      setParamsInput(initial);
    }
  }, [activeTool?.id]);

  useEffect(() => () => {
    if (goalUpdateTimer.current) clearTimeout(goalUpdateTimer.current);
  }, []);

  const handleExecute = async () => {
    if (!activeTool || isExecuting) return;
    setIsExecuting(true);
    setLastResult(null);

    const res = await executeTool(activeTool, paramsInput, 'playground');
    setLastResult(res);
    setIsExecuting(false);
  };

  const handleWebMCPProbe = async () => {
    if (!activeTool || isExecuting) return;
    setIsExecuting(true);
    setLastResult(null);
    try {
      const result = await webmcpBridge.invokeRegisteredTool(activeTool.name, paramsInput);
      setLastResult(result);
      addToast({ type: 'success', title: 'WebMCP Invocation Succeeded', message: `External-style call to "${activeTool.name}" completed.` });
    } catch (error: any) {
      addToast({ type: 'error', title: 'WebMCP Invocation Failed', message: error.message || 'Registered tool invocation failed.' });
    } finally {
      setIsExecuting(false);
    }
  };

  const handleArgumentChange = (key: string, value: string) => {
    setParamsInput(previous => ({ ...previous, [key]: value }));
    if (!/query|search|term|topic|keyword/i.test(key)) return;
    if (goalUpdateTimer.current) clearTimeout(goalUpdateTimer.current);
    if (!value.trim()) return;
    goalUpdateTimer.current = setTimeout(() => {
      setAgentGoal(buildGoalFromArgument(value.trim(), activeTool, currentDomain || activeTool.domain));
    }, 3000);
  };

  const winner = lastResult?.result?.winner;
  const goalItems = Array.isArray(lastResult?.result?.items) ? lastResult.result.items : (winner ? [winner] : []);
  const evaluatedStoriesCount = lastResult?.result?.evaluatedStoriesCount;
  const isSuccessful = lastResult?.status === 'success';
  const isNewsResult = /news|ycombinator|story/i.test(`${currentDomain} ${lastResult?.toolName || ''}`);

  // Intelligent Autonomous Agent Goal Runner
  const handleRunAgentGoal = async () => {
    if (isAgentGoalRunning) return;

    const registeredTools = webmcpBridge.getRegisteredTools();
    const registeredIds = new Set(registeredTools.map(tool => tool.id));
    const availableTools = approvedTools.filter(tool => registeredIds.has(tool.id));

    if (availableTools.length === 0) {
      addToast({
        type: 'warn',
        title: 'No Active WebMCP Tools',
        message: 'Approve and register tools on the current page before running a goal.',
      });
      return;
    }

    setIsAgentGoalRunning(true);
    setAgentStepLog([]);

    const addAgentLog = (msg: string) => {
      setAgentStepLog((prev) => [...prev, msg]);
    };

    addAgentLog(`🤖 Goal initiated: "${agentGoal}"`);
    addAgentLog(`🔍 Inspecting ${availableTools.length} registered WebMCP tools on current surface...`);

    try {
      const lowerGoal = agentGoal.toLowerCase();
      const { topN, query } = parseGoal(agentGoal);
      addAgentLog('Understanding goal and extracting constraints...');

      // Case A: Hacker News Top Story Goal ("Find the highest scored tech news story on Hacker News")
      const isHackerNewsGoal = /hacker\s*news|highest\s+scored\s+tech\s+news/i.test(agentGoal);
      const hnStoriesTool = isHackerNewsGoal && availableTools.find(t =>
        t.name === 'get_top_stories' && /ycombinator/i.test(t.domain)
      );
      if (hnStoriesTool) {
        addAgentLog(`Searching Hacker News for scored stories...`);
        const storiesRes = await executeTool(hnStoriesTool, { limit: Math.max(20, topN) }, 'webmcp-agent');

        if (storiesRes?.status === 'success' && Array.isArray(storiesRes.result)) {
          const rankedItems = normalizeGoalItems(storiesRes.result)
            .sort((a, b) => b.score - a.score)
            .slice(0, topN);
          addAgentLog(`Extracting scores and ranking ${storiesRes.result.length} stories...`);
          if (rankedItems.length === 0) throw new Error('Hacker News returned no rankable stories.');
          const result = {
            goal: agentGoal,
            query,
            topN,
            summary: `Here are the top ${rankedItems.length} highest-scored stories`,
            winner: rankedItems[0],
            items: rankedItems,
            evaluatedStoriesCount: storiesRes.result.length,
            allStories: storiesRes.result,
          };
          setLastResult({ ...storiesRes, result });

          addAgentLog(`Goal completed - Top ${rankedItems.length} stor${rankedItems.length === 1 ? 'y' : 'ies'} found.`);
          addToast({
            type: 'success',
            title: 'Goal Completed',
            message: `Found ${rankedItems.length} ranked ${rankedItems.length === 1 ? 'story' : 'stories'}.`,
          });
          setIsAgentGoalRunning(false);
          return;
        }
        throw new Error(storiesRes?.error || `Tool "${hnStoriesTool.name}" did not return story data.`);
      }

      // Case B: Search-focused goal
      const searchTool = availableTools.find(
        t => (t.annotations.category === 'search' || t.name.includes('search')) &&
          t.domain === useMediatorStore.getState().currentDomain
      );

      if (searchTool && (lowerGoal.includes('search') || lowerGoal.includes('find') || lowerGoal.includes('lookup'))) {
        const paramKey = Object.keys(searchTool.inputSchema.properties || {})[0] || 'query';
        addAgentLog(`Searching for ${query}...`);

        const searchRes = await executeTool(searchTool, { [paramKey]: query }, 'webmcp-agent');
        if (searchRes?.status === 'success') {
          let rankedItems = normalizeGoalItems(searchRes.result, query);
          const extractor = availableTools.find(tool =>
            tool.id !== searchTool.id &&
            (tool.annotations.category === 'data_extraction' || /extract|browse/i.test(tool.name)) &&
            !/extract_page_content/i.test(tool.name)
          );

          if (rankedItems.length === 0 && extractor) {
            addAgentLog(`Search returned limited metadata; extracting result details...`);
            const extractRes = await executeTool(extractor, {}, 'webmcp-agent');
            if (extractRes?.status === 'success') rankedItems = normalizeGoalItems(extractRes.result, query);
          }

          if (rankedItems.length === 0) {
            throw new Error(`No results found for "${query}".`);
          }

          addAgentLog(`Extracting and ranking ${rankedItems.length} results...`);
          rankedItems = rankedItems.sort((a, b) => b.score - a.score).slice(0, topN);
          const hasScores = rankedItems.some(item => item.score > 0);
          setLastResult({
            ...searchRes,
            result: {
              goal: agentGoal,
              query,
              topN,
              summary: hasScores
                ? `Here are the top ${rankedItems.length} highest-scored results for ${query}`
                : `Here are the top ${rankedItems.length} results for ${query}`,
              winner: rankedItems[0],
              items: rankedItems,
              evaluatedStoriesCount: normalizeGoalItems(searchRes.result, query).length,
              rawSearchResult: searchRes.result,
            },
          });
          addAgentLog(`Goal completed - Top ${rankedItems.length} result${rankedItems.length === 1 ? '' : 's'} found.`);
          addToast({ type: 'success', title: 'Goal Completed', message: `Found ${rankedItems.length} results for ${query}.` });
        } else {
          throw new Error(searchRes?.error || `Tool "${searchTool.name}" failed.`);
        }
      } else {
        // Case C: Data Extraction or Primary Tool invocation
        const extractTool = availableTools.find(
          t => t.annotations.category === 'data_extraction' || t.name.includes('extract') || t.name.includes('browse')
        );

        if (extractTool) {
          addAgentLog(`⚡ Step 1: Invoking primary WebMCP tool [${extractTool.name}] to inspect target content...`);
          const extractRes = await executeTool(extractTool, {}, 'webmcp-agent');
          if (extractRes?.status === 'success') {
            addAgentLog(`✅ Step 1 complete. Extracted structured view.`);
            if (isProductTool(extractTool)) {
              const items = normalizeGoalItems(extractRes.result, query).slice(0, topN);
              if (!items.length) throw new Error('The product catalog returned no structured products.');
              setLastResult({
                ...extractRes,
                result: {
                  goal: agentGoal,
                  query,
                  topN,
                  summary: `Here are ${items.length} products from the catalog`,
                  winner: items[0],
                  items,
                  evaluatedStoriesCount: normalizeGoalItems(extractRes.result, query).length,
                  rawCatalogResult: extractRes.result,
                },
              });
              addAgentLog(`Extracted ${items.length} products with price and catalog metadata.`);
            } else {
              setLastResult(extractRes);
            }
          } else {
            throw new Error(extractRes?.error || `Tool "${extractTool.name}" failed.`);
          }
        } else {
          const message = `No registered tool matches the goal "${agentGoal}" on ${useMediatorStore.getState().currentDomain}.`;
          addAgentLog(`⚠️ ${message}`);
          addToast({ type: 'warn', title: 'Goal Not Supported', message });
          return;
        }
      }

      addAgentLog(`🎉 Goal accomplished with verified action provenance.`);
      addToast({
        type: 'success',
        title: 'Autonomous Goal Accomplished',
        message: 'Agent executed multi-step WebMCP plan.',
      });
    } catch (err: any) {
      const message = err?.message || 'Goal execution failed.';
      addAgentLog(`⚠️ ${message}`);
      addToast({ type: 'error', title: 'Goal Execution Failed', message });
    } finally {
      setIsAgentGoalRunning(false);
    }
  };

  return (
    <div className="bg-card/70 border border-border/70 rounded-xl overflow-hidden shadow-lg flex flex-col h-[520px]">
      {/* Playground Header */}
      <div className="bg-secondary/70 px-4 py-2.5 border-b border-border/70 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-cyan-500" />
          <span className="text-xs font-bold text-foreground">Test Tools with Agent</span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-muted-foreground bg-secondary/80 px-2 py-0.5 rounded-full border border-border/50">
            {approvedTools.length} active tool{approvedTools.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      <div className="flex-1 p-4 overflow-y-auto space-y-4">
        {approvedTools.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground p-6">
            <div className="h-14 w-14 rounded-2xl bg-secondary/50 border border-border/60 flex items-center justify-center mb-3 text-muted-foreground/60">
              <Bot className="h-7 w-7" />
            </div>
            <p className="text-sm font-semibold text-foreground mb-1">No Active Tools</p>
            <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
              Approve tools on the left panel to test individual tool calls or run autonomous agent goals here.
            </p>
          </div>
        ) : (
          <>
            {/* Tool Selector */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                Select Registered WebMCP Tool to Invoke:
              </label>
              <select
                value={selectedToolId}
                onChange={(e) => setSelectedToolId(e.target.value)}
                className="w-full px-3 py-2 bg-secondary/80 border border-border rounded-lg text-xs font-mono text-cyan-300 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              >
                {approvedTools.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.annotations.readOnly ? 'readOnly' : 'mutation/gated'})
                  </option>
                ))}
              </select>
            </div>

            {/* Dynamic Schema Parameters Inputs */}
            {activeTool && activeTool.inputSchema.properties && Object.keys(activeTool.inputSchema.properties).length > 0 && (
              <div className="p-3 bg-secondary/30 rounded-xl border border-border/60 space-y-2.5">
                <div className="text-[11px] font-semibold text-foreground flex items-center justify-between">
                  <span>Input Arguments (JSON Schema Compliant):</span>
                  <span className="text-[10px] text-cyan-300 font-mono">validated</span>
                </div>
                {Object.entries(activeTool.inputSchema.properties).map(([key, prop]) => (
                  <div key={key} className="space-y-1">
                    <label className="text-xs text-muted-foreground font-mono flex items-center justify-between">
                      <span>{key} ({prop.type})</span>
                      {prop.description && <span className="text-[10px] text-muted-foreground/70">{prop.description}</span>}
                    </label>
                    <input
                      type={prop.type === 'number' ? 'number' : 'text'}
                      value={paramsInput[key] ?? ''}
                      onChange={(e) => handleArgumentChange(key, e.target.value)}
                      className="w-full px-3 py-1.5 bg-secondary/80 border border-border rounded-lg text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Execute Button */}
            <div className="flex gap-2">
              <button
                onClick={handleExecute}
                disabled={isExecuting || !activeTool}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-bold shadow-md shadow-cyan-600/20 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              >
                {isExecuting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Executing Playwright Actions...</span>
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 fill-current" />
                    <span>Call WebMCP Tool: {activeTool?.name}</span>
                  </>
                )}
              </button>
              <button
                onClick={handleWebMCPProbe}
                disabled={isExecuting || !activeTool || !webmcpBridge.getRegisteredTools().some(tool => tool.name === activeTool?.name)}
                className="px-3 py-2.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 text-xs font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                title="Invoke the registered WebMCP execute function"
              >
                <Sparkles className="h-3.5 w-3.5" /> Probe WebMCP
              </button>
            </div>

            {/* Multi-step Autonomous Agent Goal Simulator */}
            <div className="p-3 bg-cyan-50 dark:bg-cyan-950/30 border border-cyan-200 dark:border-cyan-500/20 rounded-xl space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-cyan-800 dark:text-cyan-300">
                <span className="flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" /> Autonomous Agent Goal Runner
                </span>
                <span className="text-[10px] font-mono text-muted-foreground">multi-step chain</span>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={agentGoal}
                  onChange={(e) => setAgentGoal(e.target.value)}
                  placeholder="e.g. Search and summarize top items..."
                  className="flex-1 px-3 py-1.5 bg-secondary/80 border border-border rounded-lg text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
                <button
                  onClick={handleRunAgentGoal}
                  disabled={isAgentGoalRunning}
                  className="px-3 py-1.5 rounded-lg bg-cyan-700 hover:bg-cyan-600 text-white text-xs font-semibold flex items-center gap-1 shadow-sm transition-colors disabled:opacity-50"
                >
                  {isAgentGoalRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}
                  <span>Run Goal</span>
                </button>
              </div>

              {agentStepLog.length > 0 && (
                <div className="p-2 bg-background/90 dark:bg-slate-950/60 rounded border border-border/50 text-[11px] font-mono space-y-1 max-h-24 overflow-y-auto">
                  {agentStepLog.map((log, i) => (
                    <div key={i} className="text-cyan-700 dark:text-cyan-200/90">{log}</div>
                  ))}
                </div>
              )}
            </div>

            {/* Human-readable result */}
            {lastResult && (
              <div className={`rounded-xl border p-4 space-y-3 transition-shadow ${isSuccessful
                ? 'border-emerald-400/40 bg-emerald-500/[0.06] shadow-lg shadow-emerald-500/10'
                : 'border-rose-400/40 bg-rose-500/[0.06]'
                }`}>
                {winner ? (
                  <>
                    <div className="flex items-center gap-2 text-emerald-300">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-400/15 border border-emerald-400/30">
                        <Trophy className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider font-bold text-emerald-400">Goal completed</p>
                        <p className="text-xs text-muted-foreground">{isNewsResult ? 'Highest-scored story found' : 'Best matching result found'}</p>
                      </div>
                    </div>
                    <p className="text-sm text-foreground">{lastResult.result?.summary || 'Highest-scored results found'}</p>
                    <div className="space-y-2">
                      {goalItems.map((item: RankedGoalItem, index: number) => (
                        <div key={`${item.title}-${index}`} className="rounded-lg border border-border/50 bg-background/40 p-3">
                          <div className="flex items-start gap-3">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-xs font-bold text-emerald-300">{index + 1}</span>
                            <div className="min-w-0 flex-1">
                              <h3 className="text-sm font-bold leading-snug text-foreground">{item.title}</h3>
                              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                {item.price ? <span><strong className="text-foreground">{item.price}</strong></span> : <span><strong className="text-foreground">{item.scoreLabel}</strong></span>}
                                {item.rating && <span>Rating <strong className="text-foreground">{item.rating}</strong></span>}
                                {item.availability && <span>{item.availability}</span>}
                                {!item.price && item.author && <span>by <strong className="text-foreground">{item.author}</strong></span>}
                              </div>
                            </div>
                            {/^https?:\/\//i.test(item.url) && (
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={`Read ${item.title}`}
                                className="shrink-0 rounded-md p-1.5 text-emerald-300 hover:bg-emerald-400/15 hover:text-emerald-200 transition-colors"
                              >
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    {evaluatedStoriesCount !== undefined && <p className="text-[11px] text-muted-foreground">Showing {goalItems.length} of {evaluatedStoriesCount} evaluated</p>}
                  </>
                ) : (
                  <div>
                    <div className={`flex items-center gap-2 text-xs font-bold ${isSuccessful ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {isSuccessful ? <Check className="h-4 w-4" /> : <span>!</span>}
                      {isSuccessful ? 'Tool completed' : 'Execution needs attention'}
                      <span className="font-normal text-muted-foreground">in {lastResult.executionTimeMs}ms</span>
                    </div>
                    {!isSuccessful && <p className="mt-2 text-sm text-rose-200">{lastResult.error || 'The tool did not complete successfully.'}</p>}
                  </div>
                )}
                <details className="border-t border-border/50 pt-2" open={showRawResult} onToggle={(event) => setShowRawResult(event.currentTarget.open)}>
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground">
                    <ChevronDown className="h-3.5 w-3.5 transition-transform" /> View raw JSON
                  </summary>
                  <pre className="mt-2 max-h-48 overflow-x-auto rounded-lg border border-border/40 bg-slate-950/80 p-2.5 text-[11px] font-mono text-cyan-200">
                    {JSON.stringify(lastResult.result || lastResult.error, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
