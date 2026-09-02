import assert from 'node:assert/strict';
import test from 'node:test';
import { requiresConfirmation } from '../server/supervisionPolicy';

const tool = (annotations: any) => ({ annotations } as any);

test('strict mode gates every tool', () => {
  assert.equal(requiresConfirmation(tool({ readOnly: true }), 'strict'), true);
  assert.equal(requiresConfirmation(tool({ readOnly: false }), 'strict'), true);
});

test('supervised mode gates writes but not read-only tools', () => {
  assert.equal(requiresConfirmation(tool({ readOnly: true, destructive: false, requiresConfirmation: false }), 'supervised'), false);
  assert.equal(requiresConfirmation(tool({ readOnly: false }), 'supervised'), true);
  assert.equal(requiresConfirmation(tool({ readOnly: true, destructive: true }), 'supervised'), true);
});

test('autonomous mode never gates', () => {
  assert.equal(requiresConfirmation(tool({ readOnly: false, destructive: true }), 'autonomous'), false);
});
