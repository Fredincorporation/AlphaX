import { WebMCPToolDefinition } from '@shared/types';

export interface GoalPlan {
  query: string;
  topN: number;
  wantsRanking: boolean;
  wantsRecent: boolean;
  intent: 'search' | 'extract' | 'unknown';
}

const STOP_WORDS = /\b(top\s+\d+|highest|highest[- ]scored|best|most\s+popular|recent|latest|scored|score|rank(?:ed|ing)?|find|search|look\s*up|show|list|get|relevant|relevance|products?|stories?|articles?|items?|results?|on|from|in|for|about|with|the|a|an|of)\b/gi;

export function parseGoal(goal: string): GoalPlan {
  const normalizedGoal = goal.trim();
  const topMatch = normalizedGoal.match(/\btop\s+(\d+)\b/i);
  const topN = Math.max(1, Math.min(20, topMatch ? Number(topMatch[1]) : 1));
  const query = normalizedGoal
    .replace(STOP_WORDS, ' ')
    .replace(/[^a-z0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'technology';

  return {
    query,
    topN,
    wantsRanking: /\b(top|highest|best|scored|score|rank)/i.test(normalizedGoal),
    wantsRecent: /\b(recent|latest|newest|today)/i.test(normalizedGoal),
    intent: /\b(find|search|look\s*up|show|list|get)\b/i.test(normalizedGoal)
      ? 'search'
      : normalizedGoal ? 'extract' : 'unknown',
  };
}

export function buildGoalFromArgument(query: string, tool: WebMCPToolDefinition, domain: string): string {
  const context = `${domain} ${tool.name} ${tool.description}`;
  if (/news|ycombinator|reddit|hacker/i.test(context)) return `Find the top 5 scored ${query} stories`;
  if (/amazon|shop|store|commerce|product|catalog|price/i.test(context)) return `Find the top 5 relevant ${query} products`;
  return `Find the top 5 relevant ${query} results`;
}
