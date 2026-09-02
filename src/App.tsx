import React, { useEffect } from 'react';
import { Header } from './components/Header';
import { StepGuidanceBar } from './components/StepGuidanceBar';
import { UrlInputBar } from './components/UrlInputBar';
import { LiveBrowserView } from './components/LiveBrowserView';
import { ToolReviewPanel } from './components/ToolReviewPanel';
import { AgentPlayground } from './components/AgentPlayground';
import { SupervisionConsole } from './components/SupervisionConsole';
import { AuditFeed } from './components/AuditFeed';
import { ConfirmationModal } from './components/ConfirmationModal';
import { ToastContainer } from './components/ToastContainer';
import { CustomAlertDialog } from './components/CustomAlertDialog';
import { useMediatorStore } from './store/useMediatorStore';
import { webmcpBridge } from './lib/webmcpBridge';
import { ShieldCheck, Sparkles, Terminal, Activity, Layers, Bot, Cpu } from 'lucide-react';

export const App: React.FC = () => {
  const { theme } = useMediatorStore();

  useEffect(() => {
    // Synchronize HTML theme class on initial mount
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col selection:bg-cyan-500/30 selection:text-cyan-200 transition-colors duration-200">
      {/* Top Navigation & Status */}
      <Header />

      {/* 3-Step Primary Flow Indicator & 1-Click Demo */}
      <StepGuidanceBar />

      {/* URL Input & Presets Bar */}
      <UrlInputBar />

      {/* Main Content Layout */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto p-4 sm:p-6 space-y-6">
        {/* Top Grid: Live Browser + Tool Review & Synthesis + Agent Playground */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Target Page Live Viewport */}
          <div className="lg:col-span-4">
            <LiveBrowserView />
          </div>

          {/* Center Column: WebMCP Tool Proposals & Human Review */}
          <div className="lg:col-span-4">
            <ToolReviewPanel />
          </div>

          {/* Right Column: Agent Test Playground */}
          <div className="lg:col-span-4">
            <AgentPlayground />
          </div>
        </div>

        {/* Bottom Grid: Real-time Supervision Console & Provenance Audit Log */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SupervisionConsole />
          <AuditFeed />
        </div>
      </main>

      {/* Confirmation Modal Gatekeeper */}
      <ConfirmationModal />

      {/* Custom Alert Dialog */}
      <CustomAlertDialog />

      {/* Global Toast Notifications */}
      <ToastContainer />

      {/* Footer */}
      <footer className="border-t border-border/40 py-4 px-6 text-center text-xs text-muted-foreground font-mono flex flex-col sm:flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
          <span>AlphaX Universal WebMCP Mediation Surface</span>
        </div>
        <div className="text-[11px] text-muted-foreground/80">
          Open Source MIT
        </div>
      </footer>
    </div>
  );
};
