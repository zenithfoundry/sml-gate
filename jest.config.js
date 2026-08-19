export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        diagnostics: {
          ignoreCodes: [1343, 151002]
        },
        tsconfig: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          target: 'ES2022'
        }
      },
    ],
  },
};
