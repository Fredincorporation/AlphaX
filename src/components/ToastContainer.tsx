import React from 'react';
import { useMediatorStore, ToastNotification } from '../store/useMediatorStore';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useMediatorStore();

  if (toasts.length === 0) return null;

  const getIcon = (type: ToastNotification['type']) => {
    switch (type) {
      case 'success':
        return <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />;
      case 'warn':
        return <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />;
      case 'error':
        return <XCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />;
      default:
        return <Info className="h-4 w-4 text-cyan-400 shrink-0 mt-0.5" />;
    }
  };

  const getBorderColor = (type: ToastNotification['type']) => {
    switch (type) {
      case 'success':
        return 'border-emerald-500/40 bg-slate-900/90 shadow-emerald-950/40';
      case 'warn':
        return 'border-amber-500/40 bg-slate-900/90 shadow-amber-950/40';
      case 'error':
        return 'border-rose-500/40 bg-slate-900/90 shadow-rose-950/40';
      default:
        return 'border-cyan-500/40 bg-slate-900/90 shadow-cyan-950/40';
    }
  };

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none px-4 sm:px-0">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto rounded-xl border backdrop-blur-xl p-3.5 shadow-xl transition-all duration-200 animate-in slide-in-from-bottom-3 fade-in flex items-start gap-3 ${getBorderColor(
            toast.type
          )}`}
        >
          {getIcon(toast.type)}

          <div className="flex-1 min-w-0">
            {toast.title && (
              <h4 className="text-xs font-bold text-foreground mb-0.5 font-mono">
                {toast.title}
              </h4>
            )}
            <p className="text-xs text-muted-foreground leading-snug break-words">
              {toast.message}
            </p>
          </div>

          <button
            onClick={() => removeToast(toast.id)}
            className="text-muted-foreground hover:text-foreground p-0.5 rounded-md hover:bg-white/10 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};
