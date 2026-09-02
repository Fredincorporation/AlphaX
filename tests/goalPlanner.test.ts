import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGoalFromArgument, parseGoal } from '../src/lib/goalPlanner';

const tool = (name: string, description: string, domain: string) => ({ name, description, domain } as any);

test('parses top-N lifestyle query without ranking words', () => {
  assert.deepEqual(parseGoal('Find the top 5 scored lifestyle stories'), {
    query: 'lifestyle',
    topN: 5,
    wantsRanking: true,
    wantsRecent: false,
    intent: 'search',
  });
});

test('builds an ecommerce goal instead of a story goal', () => {
  assert.equal(
    buildGoalFromArgument('dresses', tool('search_site', 'Search products and prices', 'www.amazon.com'), 'www.amazon.com'),
    'Find the top 5 relevant dresses products'
  );
});

test('caps unreasonable top-N values', () => {
  assert.equal(parseGoal('Show top 100 results for books').topN, 20);
});
