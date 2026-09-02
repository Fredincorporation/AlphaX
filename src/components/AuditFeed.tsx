import React, { useEffect } from 'react';
import { useMediatorStore } from '../store/useMediatorStore';
import { History, ShieldCheck, ShieldAlert, CheckCircle2, Clock, Globe } from 'lucide-react';

export const AuditFeed: React.FC = () => {
  const { auditHistory, fetchAuditHistory, currentDomain } = useMediatorStore();

  useEffect(() => {
    fetchAuditHistory();
  }, [currentDomain]);

  return (
    <div className="bg-card/70 border border-border/70 rounded-xl overflow-hidden shadow-lg flex flex-col h-[320px]">
      {/* Audit Header */}
      <div className="bg-secondary/70 px-4 py-2.5 border-b border-border/70 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-cyan-500" />
          <span className="text-xs font-bold text-foreground">Execution History & Audit</span>
        </div>
        <span className="text-[11px] font-medium text-muted-foreground bg-secondary/80 px-2 py-0.5 rounded-full border border-border/50">
          {auditHistory.length} verified action{auditHistory.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Audit List */}
      <div className="flex-1 p-3 overflow-y-auto space-y-2">
        {auditHistory.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground/70 text-xs gap-1">
            <History className="h-5 w-5 text-muted-foreground/40 mb-1" />
            <p>No verified audit logs yet.</p>
            <p className="text-[11px] text-muted-foreground/60">Executed tool operations and human approvals will be persisted here.</p>
          </div>
        ) : (
          auditHistory.map((entry) => (
            <div
              key={entry.id}
              className="p-2.5 rounded-lg bg-secondary/30 border border-border/50 text-xs font-mono flex items-center justify-between gap-3 hover:border-cyan-500/30 transition-colors"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {entry.confirmed_by_human ? (
                  <span className="p-1 rounded bg-amber-950/80 text-amber-300 border border-amber-500/30" title="Human Approved">
                    <ShieldCheck className="h-3.5 w-3.5" />
                  </span>
                ) : (
                  <span className="p-1 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-500/30" title="Automated Tool Execution">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  </span>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-cyan-300 truncate">{entry.tool_name}</span>
                    <span className="text-[10px] text-muted-foreground">({entry.domain})</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground/80 truncate">
                    Params: {typeof entry.request_params === 'string' ? entry.request_params : JSON.stringify(entry.request_params)}
                  </div>
                </div>
              </div>

              <div className="text-right shrink-0">
                <div className="text-[10px] text-emerald-400 font-bold">{entry.execution_time_ms}ms</div>
                <div className="text-[9px] text-muted-foreground">
                  {new Date(entry.created_at).toLocaleTimeString()}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
