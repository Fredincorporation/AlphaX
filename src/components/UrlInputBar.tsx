import React, { useState, useEffect } from 'react';
import { useMediatorStore } from '../store/useMediatorStore';
import { Search, Loader2, ArrowRight, Bookmark, Compass, Sparkles } from 'lucide-react';
import { apiUrl } from '../lib/api';

export const UrlInputBar: React.FC = () => {
  const { targetUrl, setTargetUrl, analyzeUrl, status, currentDomain } = useMediatorStore();
  const [samples, setSamples] = useState<{ name: string; url: string; description: string; domain: string }[]>([]);
  const [samplesLoading, setSamplesLoading] = useState(true);
  const isAnalyzing = status === 'analyzing' || status === 'navigating' || status === 'generating' || status === 'executing';

  useEffect(() => {
    fetch(apiUrl('/api/samples'))
      .then(res => res.json())
      .then(data => {
        if (data.samples) setSamples(data.samples);
      })
      .catch(() => setSamples([]))
      .finally(() => setSamplesLoading(false));
  }, [currentDomain]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const enteredUrl = targetUrl.trim();
    if (enteredUrl && !isAnalyzing) {
      const normalizedUrl = /^https?:\/\//i.test(enteredUrl) ? enteredUrl : `https://${enteredUrl}`;
      setTargetUrl(normalizedUrl);
      analyzeUrl(normalizedUrl);
    }
  };

  const handleSelectSample = (sampleUrl: string) => {
    const normalizedUrl = /^https?:\/\//i.test(sampleUrl) ? sampleUrl : `https://${sampleUrl}`;
    setTargetUrl(normalizedUrl);
    analyzeUrl(normalizedUrl);
  };

  return (
    <div className="bg-card/40 border-b border-border/50 px-6 py-4">
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 max-w-5xl mx-auto">
        <div className="relative flex-1">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-muted-foreground">
            <Compass className="h-4 w-4 text-cyan-400" />
          </div>
          <input
            type="text"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            placeholder="Enter any website URL (e.g. news.ycombinator.com or quotes.toscrape.com)..."
            disabled={isAnalyzing}
            className="w-full pl-10 pr-4 py-2.5 text-sm bg-secondary/60 border border-border/80 rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/70 focus:border-cyan-500 font-mono shadow-inner transition-all disabled:opacity-60"
          />
        </div>

        <button
          type="submit"
          disabled={isAnalyzing || !targetUrl.trim()}
          className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 via-sky-600 to-blue-600 hover:from-cyan-500 hover:via-sky-500 hover:to-blue-500 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-cyan-600/25 hover:shadow-cyan-500/40 hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-50 min-w-[180px]"
        >
          {isAnalyzing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-white" />
              <span>Analyzing Page...</span>
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4 text-cyan-200" />
              <span>Generate Tools</span>
              <ArrowRight className="h-4 w-4 text-cyan-200" />
            </>
          )}
        </button>
      </form>

      {/* Preset Target Quick Launch Chips */}
      <div className="mt-3 max-w-5xl mx-auto flex items-center gap-2 overflow-x-auto pb-1 text-xs scrollbar-none">
        <span className="text-muted-foreground flex items-center gap-1 font-medium text-[11px] whitespace-nowrap">
          <Bookmark className="h-3 w-3 text-cyan-500" />
          Quick presets:
        </span>
        {samplesLoading && <span className="text-[11px] text-muted-foreground/70">Loading available targets...</span>}
        {!samplesLoading && samples.length === 0 && <span className="text-[11px] text-muted-foreground/70">No presets available</span>}
        {samples.map((sample) => (
          <button
            key={sample.url}
            onClick={() => handleSelectSample(sample.url)}
            disabled={isAnalyzing}
            className="px-3 py-1 rounded-lg bg-secondary/50 hover:bg-cyan-500/15 hover:text-cyan-700 dark:hover:text-cyan-300 hover:border-cyan-500/40 border border-border/70 text-muted-foreground transition-all whitespace-nowrap text-[11px] font-medium flex items-center gap-1 shadow-sm"
            title={sample.description}
          >
            <span>{sample.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
