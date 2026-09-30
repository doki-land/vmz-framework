import { describe, expect, it } from 'vitest';
import { parseCliLogStyle, setCliLogStyle, getCliLogStyle } from '../../src/workspace/log-style.js';

describe('cli log style', () => {
    it('parses pretty and compact', () => {
        expect(parseCliLogStyle('pretty')).toBe('pretty');
        expect(parseCliLogStyle('compact')).toBe('compact');
        expect(parseCliLogStyle('nope')).toBeNull();
    });

    it('setCliLogStyle updates default', () => {
        setCliLogStyle('compact');
        expect(getCliLogStyle()).toBe('compact');
        setCliLogStyle('pretty');
        expect(getCliLogStyle()).toBe('pretty');
    });
});
