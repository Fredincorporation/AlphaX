import React, { useState, useEffect } from 'react';
import { WebMCPToolDefinition } from '@shared/types';
import { useMediatorStore } from '../store/useMediatorStore';
import { Code, Check, X, Shield, AlertTriangle, Layers, Play } from 'lucide-react';

interface Props {
  tool: WebMCPToolDefinition | null;
  onClose: () => void;
}

export const ToolEditorModal: React.FC<Props> = ({ tool, onClose }) => {
  const { updateToolDefinition, approveTool } = useMediatorStore();
  const [editedTool, setEditedTool] = useState<WebMCPToolDefinition | null>(null);
  const [jsonSchemaString, setJsonSchemaString] = useState('');
  const [schemaError, setSchemaError] = useState<string | null>(null);

  useEffect(() => {
    if (tool) {
      setEditedTool(JSON.parse(JSON.stringify(tool)));
      setJsonSchemaString(JSON.stringify(tool.inputSchema, null, 2));
      setSchemaError(null);
    }
  }, [tool]);

  if (!tool || !editedTool) return null;

  const handleSave = () => {
    try {
      const parsedSchema = JSON.parse(jsonSchemaString);
      const updated = {
        ...editedTool,
        inputSchema: parsedSchema,
        updatedAt: new Date().toISOString(),
      };
      updateToolDefinition(updated);
      onClose();
    } catch (e: any) {
      setSchemaError(`JSON Schema Parse Error: ${e.message}`);
    }
  };

  const handleApproveFromEditor = async () => {
    handleSave();
    await approveTool(tool.id);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-card border border-border/80 rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border/80 flex items-center justify-between bg-secondary/40">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-cyan-950/80 border border-cyan-500/30 text-cyan-300">
              <Code className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground">WebMCP Tool Definition Inspector</h3>
              <p className="text-xs text-muted-foreground font-mono">{editedTool.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-6 overflow-y-auto space-y-4 text-xs">
          {/* Name & Domain */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-muted-foreground font-medium mb-1">Tool Name (WebMCP Identifier)</label>
              <input
                type="text"
                value={editedTool.name}
                onChange={(e) => setEditedTool({ ...editedTool, name: e.target.value })}
                className="w-full px-3 py-2 bg-secondary/50 border border-border rounded-lg text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </div>
            <div>
              <label className="block text-muted-foreground font-medium mb-1">Target Domain</label>
              <input
                type="text"
                disabled
                value={editedTool.domain}
                className="w-full px-3 py-2 bg-secondary/30 border border-border/50 rounded-lg text-muted-foreground font-mono"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-muted-foreground font-medium mb-1">Description for Agent Discovery</label>
            <textarea
              rows={2}
              value={editedTool.description}
              onChange={(e) => setEditedTool({ ...editedTool, description: e.target.value })}
              className="w-full px-3 py-2 bg-secondary/50 border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
          </div>

          {/* Annotations & Safety Gates */}
          <div className="p-3.5 rounded-xl bg-secondary/30 border border-border/70 space-y-2.5">
            <h4 className="font-semibold text-foreground flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5 text-cyan-400" /> WebMCP Supervision Annotations
            </h4>
            <div className="grid grid-cols-3 gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editedTool.annotations.readOnly}
                  onChange={(e) => setEditedTool({
                    ...editedTool,
                    annotations: { ...editedTool.annotations, readOnly: e.target.checked }
                  })}
                  className="rounded border-border text-cyan-500 focus:ring-0"
                />
                <span className="text-muted-foreground">Read Only</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editedTool.annotations.requiresConfirmation}
                  onChange={(e) => setEditedTool({
                    ...editedTool,
                    annotations: { ...editedTool.annotations, requiresConfirmation: e.target.checked }
                  })}
                  className="rounded border-border text-amber-500 focus:ring-0"
                />
                <span className="text-amber-300">Confirmation Gate</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editedTool.annotations.destructive}
                  onChange={(e) => setEditedTool({
                    ...editedTool,
                    annotations: { ...editedTool.annotations, destructive: e.target.checked }
                  })}
                  className="rounded border-border text-rose-500 focus:ring-0"
                />
                <span className="text-rose-300">Destructive/Mutation</span>
              </label>
            </div>
          </div>

          {/* Input Schema (JSON) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-muted-foreground font-medium">Input JSON Schema</label>
              <span className="text-[10px] text-muted-foreground font-mono">JSON Schema Draft-07</span>
            </div>
            <textarea
              rows={6}
              value={jsonSchemaString}
              onChange={(e) => {
                setJsonSchemaString(e.target.value);
                setSchemaError(null);
              }}
              className="w-full px-3 py-2 bg-secondary/80 border border-border rounded-lg text-cyan-300 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
            {schemaError && (
              <p className="text-rose-400 text-[11px] mt-1 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> {schemaError}
              </p>
            )}
          </div>

          {/* Action Recipe Summary */}
          <div>
            <label className="block text-muted-foreground font-medium mb-1 flex items-center gap-1">
              <Layers className="h-3.5 w-3.5 text-cyan-400" /> Playwright Action Steps ({editedTool.actionRecipe.length})
            </label>
            <div className="space-y-1.5 max-h-32 overflow-y-auto">
              {editedTool.actionRecipe.map((step, idx) => (
                <div key={idx} className="p-2 rounded bg-secondary/40 border border-border/50 flex items-center justify-between text-[11px] font-mono">
                  <span className="text-cyan-300 font-semibold">{idx + 1}. [{step.type}]</span>
                  <span className="text-muted-foreground truncate max-w-[300px]">
                    {step.selector || step.url || step.description || ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 border-t border-border/80 bg-secondary/40 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-muted-foreground hover:bg-secondary text-xs transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 rounded-lg bg-secondary border border-border text-foreground hover:bg-secondary/80 text-xs font-medium transition-colors"
          >
            Save Changes
          </button>
          <button
            onClick={handleApproveFromEditor}
            className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium shadow-md shadow-cyan-600/20 flex items-center gap-1.5 transition-colors"
          >
            <Check className="h-3.5 w-3.5" /> Approve & Register
          </button>
        </div>
      </div>
    </div>
  );
};
