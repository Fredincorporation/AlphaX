import React, { useState } from 'react';
import { useMediatorStore } from '../store/useMediatorStore';
import { WebMCPToolDefinition } from '@shared/types';
import { ToolEditorModal } from './ToolEditorModal';
import {
  CheckCircle2,
  Sparkles,
  Check,
  X,
  Edit3,
  ShieldAlert,
  Eye,
  Code,
  Lock,
  Play,
  Database,
  ArrowUpRight
} from 'lucide-react';

export const ToolReviewPanel: React.FC = () => {
  const {
    proposedTools,
    approvedTools,
    approveTool,
    approveAllTools,
    rejectTool,
    setSelectedTool,
    currentDomain
  } = useMediatorStore();

  const [activeTab, setActiveTab] = useState<'proposed' | 'approved'>('proposed');
  const [inspectingTool, setInspectingTool] = useState<WebMCPToolDefinition | null>(null);

  const displayTools = activeTab === 'proposed' ? proposedTools : approvedTools;

  return (
    <div className="bg-card/70 border border-border/70 rounded-xl overflow-hidden shadow-lg flex flex-col h-[520px]">
      {/* Panel Tab Header */}
      <div className="bg-secondary/70 px-4 py-2.5 border-b border-border/70 flex items-center justify-between">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            onClick={() => setActiveTab('proposed')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${activeTab === 'proposed'
                ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
              }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Proposed ({proposedTools.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('approved')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${activeTab === 'approved'
                ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40 shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
              }`}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>Active WebMCP ({approvedTools.length})</span>
          </button>
        </div>

        {activeTab === 'proposed' && proposedTools.length > 0 && (
          <button
            onClick={approveAllTools}
            className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold flex items-center gap-1.5 transition-all shadow-md shadow-emerald-600/20 hover:scale-[1.02]"
            title="Approve and register all proposed tools onto document.modelContext"
          >
            <Check className="h-3.5 w-3.5" /> Approve All ({proposedTools.length})
          </button>
        )}
      </div>

      {/* Tool List Content */}
      <div className="flex-1 p-4 overflow-y-auto space-y-3">
        {displayTools.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground p-6">
            <div className="h-14 w-14 rounded-2xl bg-secondary/50 border border-border/60 flex items-center justify-center mb-3 text-muted-foreground/60">
              <Database className="h-7 w-7" />
            </div>
            <p className="text-sm font-semibold text-foreground mb-1">
              {activeTab === 'proposed' ? 'No Proposed Tools Waiting' : 'No Active Tools Yet'}
            </p>
            <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
              {activeTab === 'proposed'
                ? 'Tools will appear here after you click "Generate Tools" on any website.'
                : 'Approve tools from the Proposed tab to register them for agent execution.'}
            </p>
          </div>
        ) : (
          displayTools.map((tool) => (
            <div
              key={tool.id}
              className="bg-secondary/30 hover:bg-secondary/50 border border-border/60 hover:border-cyan-500/40 rounded-xl p-3.5 transition-all space-y-2.5 group"
            >
              {/* Tool Title & Badges */}
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-semibold text-xs text-cyan-700 dark:text-cyan-300 bg-cyan-100 dark:bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-300 dark:border-cyan-500/30">
                      {tool.name}
                    </span>

                    {/* Safety Badges */}
                    {tool.annotations.readOnly ? (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-500/30">
                        readOnly
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-500/30 flex items-center gap-1">
                        <Lock className="h-2.5 w-2.5" /> write
                      </span>
                    )}

                    {tool.annotations.requiresConfirmation && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-500/30 flex items-center gap-1">
                        <ShieldAlert className="h-2.5 w-2.5" /> gated
                      </span>
                    )}

                    {tool.annotations.category && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                        {tool.annotations.category}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {tool.description}
                  </p>
                </div>

                {/* Quick Action Controls */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setInspectingTool(tool)}
                    title="Inspect & Edit Schema"
                    className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-cyan-300 border border-transparent hover:border-border transition-colors"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </button>

                  {activeTab === 'proposed' ? (
                    <>
                      <button
                        onClick={() => approveTool(tool.id)}
                        title="Approve and register with WebMCP"
                        className="p-1.5 rounded-md bg-cyan-600/20 hover:bg-cyan-600 hover:text-white text-cyan-400 border border-cyan-500/30 transition-all"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => rejectTool(tool.id)}
                        title="Reject tool"
                        className="p-1.5 rounded-md hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => rejectTool(tool.id)}
                      title="Disable tool"
                      className="p-1.5 rounded-md hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Schema Properties summary */}
              {tool.inputSchema.properties && Object.keys(tool.inputSchema.properties).length > 0 && (
                <div className="pt-1 flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground flex-wrap">
                  <span className="text-foreground/70">Params:</span>
                  {Object.entries(tool.inputSchema.properties).map(([key, val]) => (
                    <span
                      key={key}
                      className="px-1.5 py-0.5 rounded bg-secondary/80 border border-border/40 text-[10px] text-cyan-200/90"
                    >
                      {key}: {val.type}
                      {tool.inputSchema.required?.includes(key) ? '*' : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Editor Modal */}
      {inspectingTool && (
        <ToolEditorModal
          tool={inspectingTool}
          onClose={() => setInspectingTool(null)}
        />
      )}
    </div>
  );
};
