import { describe, expect, it } from 'vitest';
import {
    diagnosticVisible,
    parseCliLogLevel,
    progressVisible,
    resolveCliLogLevel,
    setCliLogLevel,
    warnVisible,
} from '../../src/workspace/log-level.js';

describe('cli log level', () => {
    it('parses level aliases', () => {
        expect(parseCliLogLevel('error')).toBe('error');
        expect(parseCliLogLevel('warn')).toBe('warn');
        expect(parseCliLogLevel('warning')).toBe('warn');
        expect(parseCliLogLevel('info')).toBe('info');
        expect(parseCliLogLevel('advice')).toBe('info');
        expect(parseCliLogLevel('nope')).toBeNull();
    });

    it('resolves --info over --level', () => {
        expect(resolveCliLogLevel({ level: 'error', info: true })).toBe('info');
        expect(resolveCliLogLevel({ level: 'warn' })).toBe('warn');
    });

    it('filters diagnostics by level', () => {
        expect(diagnosticVisible('error', 'error')).toBe(true);
        expect(diagnosticVisible('warning', 'error')).toBe(false);
        expect(diagnosticVisible('advice', 'warn')).toBe(false);
        expect(diagnosticVisible('advice', 'info')).toBe(true);
        expect(diagnosticVisible('warning', 'warn')).toBe(true);
    });

    it('gates progress and warn lines', () => {
        expect(progressVisible('warn')).toBe(false);
        expect(progressVisible('info')).toBe(true);
        expect(warnVisible('error')).toBe(false);
        expect(warnVisible('warn')).toBe(true);
    });

    it('setCliLogLevel updates default', () => {
        setCliLogLevel('info');
        expect(progressVisible('info')).toBe(true);
        setCliLogLevel('warn');
    });
});
