CREATE TABLE IF NOT EXISTS domains (
  id TEXT PRIMARY KEY,
  domain TEXT UNIQUE NOT NULL,
  title TEXT,
  favicon_url TEXT,
  last_analyzed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS saved_tools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL REFERENCES domains(domain) ON DELETE CASCADE,
  description TEXT NOT NULL,
  input_schema TEXT NOT NULL DEFAULT '{}',
  annotations TEXT NOT NULL DEFAULT '{}',
  action_recipe TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'approved',
  version INTEGER NOT NULL DEFAULT 1,
  human_notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_executions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  tool_id TEXT,
  tool_name TEXT NOT NULL,
  domain TEXT NOT NULL,
  origin TEXT NOT NULL,
  status TEXT NOT NULL,
  request_params TEXT NOT NULL DEFAULT '{}',
  result TEXT,
  error TEXT,
  execution_time_ms INTEGER NOT NULL DEFAULT 0,
  confirmed_by_human INTEGER NOT NULL DEFAULT 0,
  screenshot_base64 TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  execution_id TEXT REFERENCES tool_executions(id) ON DELETE CASCADE,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  step_index INTEGER,
  data TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_saved_tools_domain ON saved_tools(domain);
CREATE INDEX IF NOT EXISTS idx_saved_tools_status ON saved_tools(status);
CREATE INDEX IF NOT EXISTS idx_tool_executions_domain ON tool_executions(domain);
CREATE INDEX IF NOT EXISTS idx_tool_executions_created_at ON tool_executions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
