/**
 * Jest config for SMOKE / INTEGRATION tests (`*.smoke.test.ts`).
 *
 * Deliberately does NOT load `jest.setup.ts`, so the global mocks (fetch, db,
 * openai, server actions) are absent — smoke tests must hit REAL services
 * (Supabase Storage, a deployed URL) to catch integration/deploy regressions
 * that the mocked unit suite structurally cannot. Runs in the `node` environment.
 *
 * Run:  npm run test:smoke
 *   Storage integration reads creds from `.env.local` (skips if absent).
 *   Post-deploy health smoke needs SMOKE_BASE_URL=https://staging.musicnerd.xyz
 */
import type { Config } from "jest";
import nextJest from "next/jest.js";

const createJestConfig = nextJest({ dir: "./" });

const config: Config = {
    // No setupFilesAfterEnv → no global mocks. This is the whole point.
    setupFilesAfterEnv: [],
    testEnvironment: "node",
    extensionsToTreatAsEsm: [".ts", ".tsx"],
    moduleNameMapper: {
        "^@/(.*)$": "<rootDir>/src/$1",
    },
    transformIgnorePatterns: [
        "node_modules/(?!(jose|@radix-ui|@panva|@tanstack|@tanstack/react-query|@tanstack/query-core|p-limit|yocto-queue)/)",
    ],
    testPathIgnorePatterns: ["<rootDir>/node_modules/", "<rootDir>/.next/"],
    testMatch: ["**/*.smoke.test.ts"],
    testTimeout: 30000,
};

export default createJestConfig(config);
