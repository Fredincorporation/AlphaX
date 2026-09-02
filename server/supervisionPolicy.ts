import { WebMCPToolDefinition } from '../shared/types.js';

export type SupervisionMode = 'strict' | 'supervised' | 'autonomous';

export function requiresConfirmation(tool: WebMCPToolDefinition, mode: SupervisionMode): boolean {
  if (mode === 'strict') return true;
  if (mode === 'autonomous') return false;
  return tool.annotations.readOnly !== true || tool.annotations.destructive === true || tool.annotations.requiresConfirmation === true;
}
