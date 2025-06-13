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
        // Handle CSS imports
        '\\.(css|less|sass|scss)$': 'identity-obj-proxy',
        // Handle image imports
        '\\.(gif|ttf|eot|svg|png|jpg|jpeg)$': '<rootDir>/__mocks__/fileMock.js',
    },
    transformIgnorePatterns: [
        'node_modules/(?!(jose|@rainbow-me|@radix-ui|next-auth|openid-client|@auth/core|@panva|@tanstack|wagmi|viem|@wagmi|@viem|@tanstack/react-query|@tanstack/query-core)/)'
    ],
    testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/.next/'],
    moduleDirectories: ['node_modules', '<rootDir>/'],
    testMatch: [
        '**/__tests__/**/*.[jt]s?(x)',
        '**/?(*.)+(spec|test).[jt]s?(x)'
    ],
    testTimeout: 20000,
    globals: {
        'ts-jest': {
            tsconfig: '<rootDir>/tsconfig.json'
        }
    },
};

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
export default createJestConfig(customJestConfig);
