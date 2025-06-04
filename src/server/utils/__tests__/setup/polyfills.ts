// Polyfill for clearImmediate in Node.js test environment
if (typeof clearImmediate === 'undefined') {
    (global as any).clearImmediate = function(immediateId: any) {
        clearTimeout(immediateId);
    };
}

if (typeof setImmediate === 'undefined') {
    (global as any).setImmediate = function(callback: Function) {
        return setTimeout(callback, 0);
    };
} 