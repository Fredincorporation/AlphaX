import assert from 'node:assert/strict';
import test from 'node:test';
import { isAllowedHost, validateNavigationTarget } from '../server/navigationPolicy';

test('allows valid same-domain absolute and relative URLs', () => {
  assert.equal(
    validateNavigationTarget('https://github.com/search?q=webmcp', 'https://github.com', 'github.com'),
    'https://github.com/search?q=webmcp'
  );
  assert.equal(
    validateNavigationTarget('/search?q=webmcp', 'https://github.com/', 'github.com'),
    'https://github.com/search?q=webmcp'
  );
});

test('rejects cross-domain and unsafe navigation', () => {
  assert.throws(() => validateNavigationTarget('https://evil.example', 'https://github.com', 'github.com'), /outside the approved domain/);
  assert.throws(() => validateNavigationTarget('javascript:alert(1)', 'https://github.com', 'github.com'), /protocol/);
  assert.throws(() => validateNavigationTarget('WebMCP Agent', 'https://github.com', 'github.com'), /valid HTTP/);
});

test('allows approved subdomains but not lookalike hosts', () => {
  assert.equal(isAllowedHost('www.github.com', 'github.com'), true);
  assert.equal(isAllowedHost('github.com.evil.example', 'github.com'), false);
});
