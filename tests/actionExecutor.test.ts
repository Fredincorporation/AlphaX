import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveVisibleTarget } from '../server/actionExecutor';
import { findSearchInput } from '../server/llmToolGenerator';

class FakeCandidate {
  constructor(private readonly visible: boolean, readonly index: number) {}

  async isVisible(): Promise<boolean> {
    return this.visible;
  }
}

class FakeLocator {
  constructor(private readonly candidates: FakeCandidate[]) {}

  async count(): Promise<number> {
    return this.candidates.length;
  }

  nth(index: number): FakeCandidate {
    return this.candidates[index];
  }
}

test('resolves the first visible match when a selector has hidden duplicates', async () => {
  const hiddenButton = new FakeCandidate(false, 0);
  const visibleButton = new FakeCandidate(true, 1);
  const page = {
    locator: () => new FakeLocator([hiddenButton, visibleButton]),
    waitForTimeout: async () => undefined,
  };

  const target = await resolveVisibleTarget(page as never, 'input[name="btnK"]', 100);

  assert.equal(target, visibleButton);
});

test('does not mistake a submit button for a search input', () => {
  const searchInput = findSearchInput([
    {
      tagName: 'input', type: 'submit', name: 'btnK', selector: 'input[name="btnK"]',
      isVisible: true, isEnabled: true,
    },
    {
      tagName: 'input', type: 'text', name: 'q', selector: 'input[name="q"]',
      isVisible: true, isEnabled: true,
    },
  ] as any);

  assert.equal(searchInput?.selector, 'input[name="q"]');
});
