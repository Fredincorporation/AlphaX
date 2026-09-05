import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyAnnotations } from '../worker/annotationVerifier';
import type { WebMCPToolDefinition, ActionStep } from '../shared/types';

const step = (over: Partial<ActionStep>): ActionStep => ({ id: 's', type: 'click', ...over } as ActionStep);

const tool = (steps: ActionStep[], annotations: any = {}, sourceUrl = 'https://example.com'): WebMCPToolDefinition =>
  ({
    id: 't1',
    name: 't',
    description: '',
    inputSchema: { type: 'object', properties: {} },
    annotations: { sourceUrl, ...annotations },
    actionRecipe: steps,
    status: 'approved',
    createdAt: '',
    updatedAt: '',
    domain: 'example.com',
  }) as unknown as WebMCPToolDefinition;

test('extract-only recipes are read-only regardless of LLM claims', () => {
  const t = tool([step({ type: 'extract_text', selector: 'h1' }), step({ type: 'screenshot' })], { readOnly: true });
  const v = verifyAnnotations(t);
  assert.equal(v.readOnly, true);
  assert.equal(v.destructive, false);
  assert.equal(v.requiresConfirmation, false);
});

test('click on a submit selector forces destructive even if LLM claimed read-only', () => {
  const t = tool([step({ selector: 'button[type=submit]' })], { readOnly: true, destructive: false });
  const v = verifyAnnotations(t);
  assert.equal(v.destructive, true);
  assert.equal(v.readOnly, false);
  assert.equal(v.requiresConfirmation, true);
});

test('click on a non-submit element stays read-only', () => {
  const v = verifyAnnotations(tool([step({ selector: 'nav > a.home' })]));
  assert.equal(v.readOnly, true);
});

test('fill outside a search context is a write', () => {
  const v = verifyAnnotations(tool([step({ type: 'fill', selector: '#newsletter-email' })], { readOnly: true }));
  assert.equal(v.readOnly, false);
  assert.equal(v.requiresConfirmation, true);
});

test('fill inside a search context stays read-only', () => {
  const v = verifyAnnotations(tool([step({ type: 'fill', selector: 'input[name=q]' }), step({ type: 'press', key: 'Enter', selector: 'input[name=q]' })]));
  assert.equal(v.readOnly, true);
});

test('evaluate_js is always destructive', () => {
  const v = verifyAnnotations(tool([step({ type: 'evaluate_js' })], { readOnly: true }));
  assert.equal(v.destructive, true);
});

test('cross-origin navigation is flagged', () => {
  const v = verifyAnnotations(tool([step({ type: 'navigate', url: 'https://evil.example' })], { readOnly: true }), );
  assert.equal(v.readOnly, false);
});
