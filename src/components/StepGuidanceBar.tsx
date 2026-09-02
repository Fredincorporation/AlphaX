import React from 'react';
import { useMediatorStore } from '../store/useMediatorStore';
import { Compass, Sparkles, Bot, CheckCircle2, ArrowRight, Play } from 'lucide-react';

export const StepGuidanceBar: React.FC = () => {
  const { proposedTools, approvedTools, status, analyzeUrl, setTargetUrl, approveAllTools } = useMediatorStore();

  const isAnalyzing = status === 'analyzing' || status === 'navigating' || status === 'generating';

  // Determine current active step in the journey
  let currentStep = 1;
  if (isAnalyzing || proposedTools.length > 0) {
    currentStep = 2;
  } else if (approvedTools.length > 0) {
    currentStep = 3;
  }

  const handleQuickDemo = async () => {
    const demoUrl = 'https://news.ycombinator.com';
    setTargetUrl(demoUrl);
    await analyzeUrl(demoUrl);
    // Auto-approve tools so operator lands in working Step 3 state
    const current = useMediatorStore.getState();
    const safeTools = current.proposedTools.filter(tool =>
      tool.annotations.readOnly && !tool.annotations.destructive && !tool.annotations.requiresConfirmation
    );
    for (const tool of safeTools) {
      await useMediatorStore.getState().approveTool(tool.id);
    }
  };

  return (
    <div className="bg-secondary/20 border-b border-border/50 px-6 py-2.5">
      <div className="max-w-[1600px] mx-auto flex flex-col md:flex-row items-center justify-between gap-3">
        {/* Step Indicator */}
        <div className="flex items-center gap-2 sm:gap-4 overflow-x-auto w-full md:w-auto scrollbar-none py-0.5 text-xs">
          {/* Step 1 */}
          <div
            className={`flex items-center gap-2 px-3 py-1 rounded-full transition-all shrink-0 ${currentStep === 1
                ? 'bg-cyan-500/15 border border-cyan-500/40 text-cyan-700 dark:text-cyan-300 font-semibold shadow-sm'
                : 'text-muted-foreground opacity-70'
              }`}
          >
            <span
              className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold ${currentStep > 1
                  ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                  : currentStep === 1
                    ? 'bg-cyan-600 text-white'
                    : 'bg-secondary text-muted-foreground'
                }`}
            >
              {currentStep > 1 ? <CheckCircle2 className="h-3.5 w-3.5" /> : '1'}
            </span>
            <span>Enter Website</span>
          </div>

          <ArrowRight className="h-3 w-3 text-muted-foreground/40 shrink-0 hidden sm:inline" />

          {/* Step 2 */}
          <div
            className={`flex items-center gap-2 px-3 py-1 rounded-full transition-all shrink-0 ${currentStep === 2
                ? 'bg-cyan-500/15 border border-cyan-500/40 text-cyan-700 dark:text-cyan-300 font-semibold shadow-sm animate-pulse'
                : 'text-muted-foreground opacity-70'
              }`}
          >
            <span
              className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold ${currentStep > 2
                  ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                  : currentStep === 2
                    ? 'bg-cyan-600 text-white'
                    : 'bg-secondary text-muted-foreground'
                }`}
            >
              {currentStep > 2 ? <CheckCircle2 className="h-3.5 w-3.5" /> : '2'}
            </span>
            <span>Generate & Approve Tools</span>
          </div>

          <ArrowRight className="h-3 w-3 text-muted-foreground/40 shrink-0 hidden sm:inline" />

          {/* Step 3 */}
          <div
            className={`flex items-center gap-2 px-3 py-1 rounded-full transition-all shrink-0 ${currentStep === 3
                ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-700 dark:text-emerald-300 font-semibold shadow-sm'
                : 'text-muted-foreground opacity-70'
              }`}
          >
            <span
              className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold ${currentStep === 3
                  ? 'bg-emerald-600 text-white'
                  : 'bg-secondary text-muted-foreground'
                }`}
            >
              3
            </span>
            <span>Test with Agent</span>
          </div>
        </div>

        {/* Quick Demo CTA */}
        <div className="flex items-center gap-2 shrink-0 self-end md:self-auto">
          <button
            onClick={handleQuickDemo}
            disabled={isAnalyzing}
            className="px-3 py-1 rounded-full bg-cyan-600/10 hover:bg-cyan-600/20 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30 text-xs font-medium flex items-center gap-1.5 transition-all shadow-sm hover:scale-[1.02] disabled:opacity-50"
            title="Auto-load Hacker News demo with pre-configured tools"
          >
            <Sparkles className="h-3.5 w-3.5 text-cyan-500" />
            <span>Try 1-Click Demo</span>
          </button>
        </div>
      </div>
    </div>
  );
};
