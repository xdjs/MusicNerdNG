/**
 * For a detailed explanation regarding each configuration property, visit:
 * https://jestjs.io/docs/configuration
 */

import type { Config } from 'jest';
import nextJest from 'next/jest';

const createJestConfig = nextJest({
    // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
    dir: './',
});

// Add any custom config to be passed to Jest
const customJestConfig: Config = {
    setupFilesAfterEnv: [
        '<rootDir>/jest.setup.ts'
    ],
    testEnvironment: 'jest-environment-jsdom',
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
        // Handle module aliases
        '^@components/(.*)$': '<rootDir>/src/components/$1',
        '^@lib/(.*)$': '<rootDir>/src/lib/$1',
        '^@utils/(.*)$': '<rootDir>/src/utils/$1',
        '^jose/(.*)$': '<rootDir>/node_modules/jose/dist/node/cjs/$1',
    },
    transformIgnorePatterns: [
        'node_modules/(?!(jose|@rainbow-me|@radix-ui|next-auth|openid-client|@auth/core|@panva)/)'
    ],
    transform: {
        '^.+\\.(js|jsx|ts|tsx|mjs)$': ['@swc/jest', {
            jsc: {
                transform: {
                    react: {
                        runtime: 'automatic'
                    }
                }
            }
        }]
    },
    moduleFileExtensions: ['js', 'jsx', 'ts', 'tsx', 'json', 'node', 'mjs'],
    coverageDirectory: 'coverage',
    collectCoverageFrom: [
        'src/**/*.{js,jsx,ts,tsx}',
        '!src/**/*.d.ts',
        '!src/**/*.stories.{js,jsx,ts,tsx}',
        '!src/**/*.test.{js,jsx,ts,tsx}',
        '!src/**/index.{js,jsx,ts,tsx}',
        '!src/pages/_app.tsx',
        '!src/pages/_document.tsx',
        '!src/types/**/*',
        '!src/styles/**/*',
        '!**/node_modules/**',
        '!**/.next/**',
    ],
    coverageThreshold: {
        global: {
            branches: 70,
            functions: 70,
            lines: 70,
            statements: 70,
        },
    },
    coverageReporters: ['json', 'lcov', 'text', 'clover', 'html'],
    testMatch: [
        '**/__tests__/**/*.[jt]s?(x)',
        '**/?(*.)+(spec|test).[jt]s?(x)'
    ],
    testPathIgnorePatterns: [
        '<rootDir>/.next/',
        '<rootDir>/node_modules/'
    ],
};

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
export default createJestConfig(customJestConfig);
