import React from 'react';
import { useMediatorStore } from '../store/useMediatorStore';
import { Globe, RefreshCw, Eye, ShieldCheck, Activity, Maximize2, ShieldAlert } from 'lucide-react';

export const LiveBrowserView: React.FC = () => {
  const {
    liveScreenshot,
    analysis,
    status,
    statusMessage,
    currentDomain,
    targetUrl
  } = useMediatorStore();

  const isNavigating = status === 'navigating' || status === 'analyzing';
  const isAutomationChallenge = status === 'error' && /anti-bot challenge|captcha|verify you are human|robot check|access denied/i.test(statusMessage);

  return (
    <div className="bg-card/70 border border-border/70 rounded-xl overflow-hidden shadow-lg flex flex-col h-[520px]">
      {/* Browser Bar Header */}
      <div className="bg-secondary/70 px-4 py-2.5 border-b border-border/70 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 flex-1 min-w-0 pr-4">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-500/80 inline-block" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500/80 inline-block" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80 inline-block" />
          </div>

          <div className="flex-1 min-w-0 ml-2 bg-background/80 border border-border/80 px-3 py-1 rounded-md flex items-center gap-2 font-mono text-[11px] text-muted-foreground truncate">
            <Globe className="h-3 w-3 text-cyan-400 shrink-0" />
            <span className="truncate text-foreground">{analysis?.url || targetUrl || 'about:blank'}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-300 font-medium text-[11px]">
            <Activity className="h-3 w-3 animate-pulse text-emerald-500" />
            <span>Live Browser View</span>
          </div>
        </div>
      </div>

      {/* Viewport Canvas / Image */}
      <div className="flex-1 bg-background relative overflow-hidden flex items-center justify-center">
        {isAutomationChallenge ? (
          <div className="flex flex-col items-center justify-center p-8 text-center max-w-lg">
            <ShieldAlert className="h-10 w-10 text-amber-400 mb-3" />
            <p className="text-sm font-semibold text-amber-300 mb-2">Anti-bot challenge detected</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              This website is blocking automated access. The challenge cannot be completed in the controlled Chromium window or through a popup.
            </p>
          </div>
        ) : liveScreenshot ? (
          <div className="relative w-full h-full flex items-center justify-center p-2 bg-slate-200/50 dark:bg-slate-950/40">
            <img
              src={`data:image/jpeg;base64,${liveScreenshot}`}
              alt="Live Target Browser Viewport"
              className="max-w-full max-h-full object-contain rounded border border-border/50 shadow-md"
            />
            {/* Live Provenance Watermark */}
            <div className="absolute bottom-4 left-4 bg-background/90 dark:bg-black/80 backdrop-blur-md px-2.5 py-1 rounded-md border border-border text-[10px] font-medium text-cyan-700 dark:text-cyan-300 flex items-center gap-1.5 shadow-sm">
              <ShieldCheck className="h-3 w-3 text-cyan-500" />
              <span>Live Controlled Session</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
            <div className="h-16 w-16 rounded-2xl bg-secondary/50 border border-border/60 flex items-center justify-center mb-3 text-muted-foreground/60">
              <Globe className="h-8 w-8" />
            </div>
            <p className="text-sm font-semibold text-foreground mb-1">Live Viewport Ready</p>
            <p className="text-xs max-w-sm text-muted-foreground leading-relaxed">
              Enter a website URL above or choose a Quick Preset to load the page and synthesize WebMCP tools.
            </p>
          </div>
        )}

        {/* Loading Overlay */}
        {isNavigating && (
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex flex-col items-center justify-center gap-3 z-20">
            <div className="h-10 w-10 rounded-full border-2 border-cyan-500/20 border-t-cyan-400 animate-spin" />
            <p className="text-xs font-mono text-cyan-300 animate-pulse">{statusMessage}</p>
          </div>
        )}
      </div>

      {/* Status Footer */}
      <div className="bg-secondary/40 px-4 py-2 border-t border-border/60 flex items-center justify-between text-[11px] text-muted-foreground font-mono">
        <div className="flex items-center gap-2 truncate">
          <span className="h-2 w-2 rounded-full bg-cyan-400" />
          <span className="truncate">{analysis?.title || 'No active page'}</span>
        </div>
        {analysis && (
          <div className="hidden sm:flex items-center gap-3 shrink-0">
            <span>{analysis.interactiveElements.length} targets</span>
            <span>•</span>
            <span>{analysis.forms.length} forms</span>
          </div>
        )}
      </div>
    </div>
  );
};
