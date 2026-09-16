const transform = {
  '^.+\\.tsx?$': ['ts-jest', {
    useESM: true,
    tsconfig: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      jsx: 'react-jsx',
      esModuleInterop: true,
      isolatedModules: true,
      verbatimModuleSyntax: false,
    },
  }],
}

const shared = {
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  transform,
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
}

export default {
  projects: [
    {
      ...shared,
      displayName: 'functions',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/rayfin/functions/test/**/*.test.ts'],
    },
    {
      ...shared,
      displayName: 'frontend',
      testEnvironment: 'jsdom',
      setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
      testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.test.tsx'],
    },
  ],
}
