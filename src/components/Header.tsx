import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useMediatorStore } from '../store/useMediatorStore';
import { ThemeToggle } from './ThemeToggle';
import { apiUrl } from '../lib/api';
import { Shield, ShieldAlert, Cpu, Key, Trash2, Globe, Radio, Sparkles, CheckCircle2 } from 'lucide-react';

export const Header: React.FC = () => {
  const {
    supervisionMode,
    setSupervisionMode,
    currentDomain,
    revokeDomainTools,
    approvedTools,
    isLiveStreaming,
    openAlertDialog,
    addToast
  } = useMediatorStore();

  const [showKeyModal, setShowKeyModal] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [keySavedMessage, setKeySavedMessage] = useState('');

  const handleSaveKey = async () => {
    try {
      const res = await fetch(apiUrl('/api/config/llm-key'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKeyInput }),
      });
      if (res.ok) {
        addToast({
          type: 'success',
          title: 'LLM Engine Configured',
          message: 'API key updated for high-speed tool synthesis.',
        });
        setShowKeyModal(false);
      } else {
        addToast({
          type: 'error',
          title: 'Configuration Error',
          message: 'Failed to update API key.',
        });
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <header className="border-b border-border/60 bg-card/70 backdrop-blur-md sticky top-0 z-40 px-6 py-3.5 flex items-center justify-between">
      {/* Brand & WebMCP Badge */}
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-gradient-to-tr from-cyan-600 to-blue-500 flex items-center justify-center shadow-md shadow-cyan-500/20">
          <Sparkles className="h-5 w-5 text-white" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold tracking-tight bg-gradient-to-r from-cyan-400 via-sky-300 to-white bg-clip-text text-transparent">
              ALPHAX
            </h1>
            <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-950/80 border border-cyan-500/30 text-cyan-300 font-mono font-medium">
              WebMCP Mediator v1.0
            </span>
          </div>
          <p className="text-xs text-muted-foreground hidden sm:block">
            Universal Human-Supervised Agent Surface for Any Website
          </p>
        </div>
      </div>

      {/* Center status indicators */}
      <div className="hidden lg:flex items-center gap-4">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary/40 border border-border/50 text-xs font-mono">
          <Radio className={`h-3.5 w-3.5 ${isLiveStreaming ? 'text-emerald-400 animate-pulse' : 'text-amber-400'}`} />
          <span className="text-muted-foreground">WebMCP Runtime:</span>
          <span className="text-foreground font-semibold">Active & Registered ({approvedTools.length} tools)</span>
        </div>

        {currentDomain && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary/40 border border-border/50 text-xs font-mono">
            <Globe className="h-3.5 w-3.5 text-cyan-400" />
            <span className="text-muted-foreground">Domain:</span>
            <span className="text-cyan-300 font-semibold">{currentDomain}</span>
          </div>
        )}
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-3">
        {/* Supervision Mode Selector */}
        <div className="flex items-center bg-secondary/50 p-1 rounded-lg border border-border/50 text-xs">
          <span className="text-[11px] font-medium text-muted-foreground px-2 hidden sm:inline">Mode:</span>
          <button
            onClick={() => setSupervisionMode('strict')}
            title="Strict: Confirmation modal required for every single tool call"
            className={`px-2.5 py-1 rounded-md font-medium transition-all ${supervisionMode === 'strict'
              ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30 font-semibold'
              : 'text-muted-foreground hover:text-foreground'
              }`}
          >
            Strict
          </button>
          <button
            onClick={() => setSupervisionMode('supervised')}
            title="Supervised (Recommended): Read-only calls proceed automatically; mutations/writes ask for confirmation"
            className={`px-2.5 py-1 rounded-md font-medium transition-all ${supervisionMode === 'supervised'
              ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border border-cyan-500/40 font-semibold'
              : 'text-muted-foreground hover:text-foreground'
              }`}
          >
            Supervised
          </button>
          <button
            onClick={() => setSupervisionMode('autonomous')}
            title="Autonomous: Fast automatic tool execution without confirmation gates"
            className={`px-2.5 py-1 rounded-md font-medium transition-all ${supervisionMode === 'autonomous'
              ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40 font-semibold'
              : 'text-muted-foreground hover:text-foreground'
              }`}
          >
            Autonomous
          </button>
        </div>

        {/* API Key Modal Button */}
        <button
          onClick={() => setShowKeyModal(true)}
          className="p-2 rounded-lg bg-secondary/50 hover:bg-secondary text-muted-foreground hover:text-foreground border border-border/50 transition-colors"
          title="Configure LLM API Key (Optional)"
        >
          <Key className="h-4 w-4" />
        </button>

        {/* Theme Switcher Toggle */}
        <ThemeToggle />

        {/* Revoke Domain Tools Button */}
        <button
          onClick={() => {
            openAlertDialog({
              title: `Revoke Tools for ${currentDomain}?`,
              message: `This will unregister all active WebMCP tools for ${currentDomain} from document.modelContext and clear domain definitions.`,
              confirmText: 'Revoke All Tools',
              cancelText: 'Cancel',
              variant: 'danger',
              onConfirm: () => {
                revokeDomainTools();
              },
            });
          }}
          disabled={approvedTools.length === 0}
          className="px-2.5 py-1.5 rounded-lg bg-destructive/10 hover:bg-destructive/20 text-destructive border border-destructive/20 text-xs font-medium flex items-center gap-1.5 disabled:opacity-40 transition-colors"
          title="Revoke all approved tools for this domain"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Revoke</span>
        </button>
      </div>

      {/* API Key Modal */}
      {showKeyModal && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 overflow-y-auto px-4 py-8 sm:py-12">
          <div className="bg-card border border-border rounded-xl p-6 max-w-md w-full mx-auto max-h-[calc(100vh-4rem)] overflow-y-auto shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <h3 className="text-base font-bold text-foreground mb-1 flex items-center gap-2">
              <Key className="h-4 w-4 text-cyan-400" />
              Configure LLM Engine (Optional)
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              AlphaX utilizes an intelligent built-in heuristic AST tool synthesizer by default (no keys needed). Provide a GroqCloud (<code className="text-cyan-300">gsk_...</code>) or Google Gemini API key to activate high-speed neural tool synthesis.
            </p>
            <input
              type="password"
              placeholder="gsk_... or Gemini API Key"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-secondary/50 border border-border rounded-lg mb-4 text-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500 font-mono"
            />
            {keySavedMessage && (
              <p className="text-xs text-emerald-400 mb-3 flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" /> {keySavedMessage}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowKeyModal(false)}
                className="px-4 py-2 text-xs rounded-lg text-muted-foreground hover:bg-secondary transition-colors"
              >
                Close
              </button>
              <button
                onClick={handleSaveKey}
                className="px-4 py-2 text-xs rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium shadow-md shadow-cyan-600/20 transition-colors"
              >
                Save Key
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </header>
  );
};
