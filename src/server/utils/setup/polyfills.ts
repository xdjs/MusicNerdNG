/**
 * Test environment polyfills
 * This file provides polyfills for Node.js test environment to ensure compatibility
 * with browser APIs that might be used in the codebase.
 */

// Polyfill for clearImmediate in Node.js test environment
if (typeof clearImmediate === 'undefined') {
    (global as any).clearImmediate = function(immediateId: any) {
        clearTimeout(immediateId);
    };
}

// Polyfill for setImmediate in Node.js test environment
if (typeof setImmediate === 'undefined') {
    (global as any).setImmediate = function(callback: (...args: unknown[]) => unknown) {
        return setTimeout(callback, 0);
    };
} 