-- ==========================================================
-- AlphaX Supabase Database Schema
-- Universal Agent Mediation Layer (WebMCP)
-- ==========================================================

-- 1. Domains Table
CREATE TABLE IF NOT EXISTS public.domains (
    id TEXT PRIMARY KEY,
    domain TEXT UNIQUE NOT NULL,
    title TEXT,
    favicon_url TEXT,
    last_analyzed_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Saved Tools Table (with versioning and rich metadata)
CREATE TABLE IF NOT EXISTS public.saved_tools (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    domain TEXT NOT NULL REFERENCES public.domains(domain) ON UPDATE CASCADE ON DELETE CASCADE,
    description TEXT NOT NULL,
    input_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
    annotations JSONB NOT NULL DEFAULT '{}'::jsonb,
    action_recipe JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('proposed', 'approved', 'rejected', 'disabled')),
    version INTEGER NOT NULL DEFAULT 1,
    human_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Tool Executions Table
CREATE TABLE IF NOT EXISTS public.tool_executions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    tool_id TEXT,
    tool_name TEXT NOT NULL,
    domain TEXT NOT NULL,
    origin TEXT NOT NULL DEFAULT 'playground' CHECK (origin IN ('webmcp-agent', 'playground', 'human-tester')),
    status TEXT NOT NULL CHECK (status IN ('success', 'error', 'rejected', 'cancelled')),
    request_params JSONB NOT NULL DEFAULT '{}'::jsonb,
    result JSONB,
    error TEXT,
    execution_time_ms INTEGER NOT NULL DEFAULT 0,
    confirmed_by_human BOOLEAN NOT NULL DEFAULT false,
    screenshot_base64 TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Audit Logs Table (granular step-by-step telemetry)
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    execution_id TEXT REFERENCES public.tool_executions(id) ON DELETE CASCADE,
    level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error', 'success', 'security')),
    message TEXT NOT NULL,
    step_index INTEGER,
    data JSONB,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Indexes for lightning fast queries
CREATE INDEX IF NOT EXISTS idx_saved_tools_domain ON public.saved_tools(domain);
CREATE INDEX IF NOT EXISTS idx_saved_tools_status ON public.saved_tools(status);
CREATE INDEX IF NOT EXISTS idx_tool_executions_domain ON public.tool_executions(domain);
CREATE INDEX IF NOT EXISTS idx_tool_executions_session ON public.tool_executions(session_id);
CREATE INDEX IF NOT EXISTS idx_tool_executions_created_at ON public.tool_executions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_execution_id ON public.audit_logs(execution_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE public.domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Allow public read/write policies for web mediator client
CREATE POLICY "Allow public read domains" ON public.domains FOR SELECT USING (true);
CREATE POLICY "Allow public insert/update domains" ON public.domains FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow public read saved_tools" ON public.saved_tools FOR SELECT USING (true);
CREATE POLICY "Allow public insert/update saved_tools" ON public.saved_tools FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow public read tool_executions" ON public.tool_executions FOR SELECT USING (true);
CREATE POLICY "Allow public insert tool_executions" ON public.tool_executions FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow public read audit_logs" ON public.audit_logs FOR SELECT USING (true);
CREATE POLICY "Allow public insert audit_logs" ON public.audit_logs FOR ALL USING (true) WITH CHECK (true);
