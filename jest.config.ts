import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'jsdom',
  testRegex: '.*\\.spec\\.(ts|tsx|js|jsx)$',
  moduleNameMapper: {
    '\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$':
      '<rootDir>/__mocks__/fileMock.ts',
    '\\.css$': '<rootDir>/__mocks__/styleMock.ts',
  },
  transform: {
    '^.+\\.[jt]sx?$': [
      '@swc/jest',
      {
        jsc: {
          parser: { syntax: 'typescript', tsx: true },
          transform: { react: { runtime: 'automatic' } },
        },
        module: {
          type: 'commonjs',
          noInterop: true,
        },
        minify: false,
      },
    ],
  },
  setupFilesAfterEnv: ['./setup-tests.ts'],
  // .claude/worktrees holds full checkouts of this repo, so without this jest collects every spec
  // twice — inflating the reported test count — and warns that each manual mock is duplicated.
  // modulePathIgnorePatterns is what keeps them out of the haste map; testPathIgnorePatterns alone
  // would stop the specs running but not the duplicate-mock warnings.
  modulePathIgnorePatterns: ['<rootDir>/.claude/'],
  testPathIgnorePatterns: ['integration-tests', '<rootDir>/.claude/'],
};

export default config;
