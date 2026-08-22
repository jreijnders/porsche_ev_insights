import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node environment: the mandatory-test surface (#9) is the merge rule,
    // reconciliation, place matching and the monthly figure — all pure logic.
    environment: 'node',
    include: ['server/**/*.test.ts', 'db/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
  },
});
