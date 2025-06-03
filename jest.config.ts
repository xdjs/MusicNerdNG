/**
 * For a detailed explanation regarding each configuration property, visit:
 * https://jestjs.io/docs/configuration
 */

import type { Config } from 'jest';
import nextJest from 'next/jest';

const createJestConfig = nextJest({
    dir: './',
});

const customJestConfig: Config = {
    setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
    },
    testEnvironment: 'jest-environment-jsdom',
    transformIgnorePatterns: [
        'node_modules/(?!(jose|openid-client|oidc-token-hash|next-auth|@panva|uuid|jose/dist/browser)/)'
    ],
    transform: {
        '^.+\\.(t|j)sx?$': ['@swc/jest', {
            jsc: {
                target: 'es2021',
                transform: {
                    react: {
                        runtime: 'automatic'
                    }
                }
            }
        }]
    },
    moduleDirectories: ['node_modules', '<rootDir>'],
    testPathIgnorePatterns: [
        '/node_modules/',
        '/.next/',
        '/src/server/utils/__tests__/__utils__/',
        '/src/server/utils/__tests__/__mocks__/',
        '/__tests__/utils.test.ts',
        'queriesTS.test.ts'
    ],
    extensionsToTreatAsEsm: ['.ts', '.tsx'],
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node']
};

export default createJestConfig(customJestConfig);
