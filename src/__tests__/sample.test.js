import { describe, it, expect } from '@jest/globals';

describe('Sample Test', () => {
  it('should pass basic test', () => {
    expect(1 + 1).toBe(2);
  });

  it('should work with strings', () => {
    expect('hello').toBe('hello');
  });
});