import React, { useRef, useEffect } from 'react';
import { useMediatorStore } from '../store/useMediatorStore';
import { Terminal, Shield, CheckCircle2, AlertTriangle, XCircle, Info, Trash2 } from 'lucide-react';

export const SupervisionConsole: React.FC = () => {
  const { executionLogs, clearLogs, activeExecutionTool, status } = useMediatorStore();
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [executionLogs]);

  const getLogIcon = (level: string) => {
    switch (level) {
      case 'success':
        return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />;
      case 'security':
        return <Shield className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />;
      case 'warn':
        return <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />;
      case 'error':
        return <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0 mt-0.5" />;
      default:
        return <Info className="h-3.5 w-3.5 text-cyan-400 shrink-0 mt-0.5" />;
    }
  };

  const getLogColor = (level: string) => {
    switch (level) {
      case 'success':
        return 'text-emerald-300';
      case 'security':
        return 'text-amber-300 bg-amber-950/20 px-1 rounded';
      case 'warn':
        return 'text-amber-300';
      case 'error':
        return 'text-rose-300 bg-rose-950/20 px-1 rounded';
      default:
        return 'text-slate-300';
    }
  };

  return (
    <div className="bg-card/70 border border-border/70 rounded-xl overflow-hidden shadow-lg flex flex-col h-[320px]">
      {/* Console Header */}
      <div className="bg-secondary/70 px-4 py-2.5 border-b border-border/70 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-cyan-500" />
          <span className="text-xs font-bold text-foreground">Real-Time Action Log</span>
          {activeExecutionTool && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border border-cyan-500/40 animate-pulse font-medium">
              Executing: {activeExecutionTool}
            </span>
          )}
        </div>

        <button
          onClick={clearLogs}
          disabled={executionLogs.length === 0}
          className="text-muted-foreground hover:text-foreground text-[11px] flex items-center gap-1 disabled:opacity-30 transition-colors"
        >
          <Trash2 className="h-3 w-3" /> Clear
        </button>
      </div>

      {/* Log Stream */}
      <div
        ref={logContainerRef}
        className="flex-1 p-3.5 bg-background/80 dark:bg-slate-950/70 overflow-y-auto space-y-1.5 font-mono text-xs"
      >
        {executionLogs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground/70 text-xs gap-1">
            <Terminal className="h-5 w-5 text-muted-foreground/40 mb-1" />
            <p>Awaiting agent actions or playground calls...</p>
            <p className="text-[11px] text-muted-foreground/60">Live step-by-step telemetry will stream here in real time.</p>
          </div>
        ) : (
          executionLogs.map((log) => (
            <div key={log.id} className="flex items-start gap-2 leading-relaxed">
              <span className="text-[10px] text-muted-foreground/60 shrink-0 font-mono">
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>
              {getLogIcon(log.level)}
              <span className={`text-xs ${getLogColor(log.level)} break-all`}>
                {log.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
