module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  // admin-dashboard is a Vite/vitest ESM workspace with its own runner (`npm test -w
  // admin-dashboard`). Its `.ts` tests import from 'vitest' and would fail under ts-jest's CJS
  // transform — the same reason it's already excluded from the root tsconfig.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/admin-dashboard/'],
  collectCoverageFrom: [
    '**/*.ts',
    '!**/*.test.ts',
    '!**/node_modules/**',
    '!admin-dashboard/**',
  ],
};
