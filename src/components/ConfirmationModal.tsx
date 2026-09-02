import React, { useState, useEffect } from 'react';
import { useMediatorStore } from '../store/useMediatorStore';
import { ShieldAlert, Check, X, AlertTriangle, Clock, Terminal } from 'lucide-react';

export const ConfirmationModal: React.FC = () => {
  const { pendingConfirmation, respondToConfirmation } = useMediatorStore();
  const [timeLeft, setTimeLeft] = useState(60);

  useEffect(() => {
    if (!pendingConfirmation) return;
    setTimeLeft(pendingConfirmation.timeoutSeconds || 60);

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          respondToConfirmation(pendingConfirmation.id, false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [pendingConfirmation]);

  if (!pendingConfirmation) return null;

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-card border-2 border-amber-500/60 rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Warning Banner Header */}
        <div className="bg-amber-500/15 border-b border-amber-500/30 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-amber-300">Human Confirmation Required</h3>
              <p className="text-xs text-muted-foreground">WebMCP Supervision Gate Triggered</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-950/80 border border-amber-500/30 text-amber-300 font-mono text-xs">
            <Clock className="h-3.5 w-3.5 animate-spin" />
            <span>{timeLeft}s</span>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wider font-mono mb-1">
              Requested Tool
            </div>
            <div className="text-sm font-mono font-bold text-cyan-300 bg-secondary/50 px-3 py-1.5 rounded-lg border border-border">
              {pendingConfirmation.toolName}
            </div>
          </div>

          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wider font-mono mb-1">
              Parameters Provided by Agent
            </div>
            <pre className="p-3 bg-secondary/80 border border-border/80 rounded-lg text-xs font-mono text-emerald-300 overflow-x-auto max-h-36">
              {JSON.stringify(pendingConfirmation.parameters, null, 2)}
            </pre>
          </div>

          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-200/90 leading-relaxed">
            <p className="font-medium flex items-center gap-1.5 mb-1 text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Action Risk Assessment
            </p>
            {pendingConfirmation.impactDescription}
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 py-4 border-t border-border bg-secondary/40 flex items-center justify-end gap-3">
          <button
            onClick={() => respondToConfirmation(pendingConfirmation.id, false)}
            className="px-4 py-2.5 rounded-xl bg-destructive/10 hover:bg-destructive/20 text-destructive border border-destructive/30 text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <X className="h-4 w-4" /> Reject Action
          </button>

          <button
            onClick={() => respondToConfirmation(pendingConfirmation.id, true)}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/20 flex items-center gap-1.5 transition-all"
          >
            <Check className="h-4 w-4" /> Approve & Execute
          </button>
        </div>
      </div>
    </div>
  );
};
