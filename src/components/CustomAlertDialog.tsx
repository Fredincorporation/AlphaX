import React from 'react';
import { useMediatorStore } from '../store/useMediatorStore';
import { AlertTriangle, ShieldAlert, Info, X } from 'lucide-react';

export const CustomAlertDialog: React.FC = () => {
  const { alertDialog, closeAlertDialog } = useMediatorStore();

  if (!alertDialog || !alertDialog.isOpen) return null;

  const handleConfirm = () => {
    alertDialog.onConfirm();
    closeAlertDialog();
  };

  const handleCancel = () => {
    if (alertDialog.onCancel) {
      alertDialog.onCancel();
    }
    closeAlertDialog();
  };

  const isDanger = alertDialog.variant === 'danger';
  const isWarning = alertDialog.variant === 'warning';

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border/80 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
        <div className="p-6">
          <div className="flex items-start gap-3.5 mb-4">
            <div
              className={`p-2.5 rounded-xl border shrink-0 ${isDanger
                ? 'bg-rose-500/15 border-rose-500/30 text-rose-400'
                : isWarning
                  ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                  : 'bg-cyan-500/15 border-cyan-500/30 text-cyan-400'
                }`}
            >
              {isDanger ? (
                <ShieldAlert className="h-5 w-5" />
              ) : isWarning ? (
                <AlertTriangle className="h-5 w-5" />
              ) : (
                <Info className="h-5 w-5" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <h3 className="text-base font-bold text-foreground mb-1">
                {alertDialog.title}
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {alertDialog.message}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 mt-6 pt-4 border-t border-border/60">
            <button
              onClick={handleCancel}
              className="px-4 py-2 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/70 border border-transparent transition-colors"
            >
              {alertDialog.cancelText || 'Cancel'}
            </button>

            <button
              onClick={handleConfirm}
              className={`px-4 py-2 rounded-xl text-xs font-semibold shadow-lg transition-all ${isDanger
                ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/20'
                : isWarning
                  ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-600/20'
                  : 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-cyan-600/20'
                }`}
            >
              {alertDialog.confirmText || 'Confirm'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
