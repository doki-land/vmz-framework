#!/usr/bin/env node
/**
 * VMZ runtime package reshape driver (Host and Package Contract 0.2.4).
 *
 *   node scripts/refactor/reshape-runtime.mjs --check
 *   node scripts/refactor/reshape-runtime.mjs --report
 *   node scripts/refactor/reshape-runtime.mjs --apply --phase ensure-dirs
 *   node scripts/refactor/reshape-runtime.mjs --apply --phase split-modules --source src/browser/client-nav.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyManifest, loadManifest, validateManifest } from './lib/runtime-reshape-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);

function usage() {
    console.log(`Usage:
  node scripts/refactor/reshape-runtime.mjs --check [--manifest <rel>]
  node scripts/refactor/reshape-runtime.mjs --report [--json <out>]
  node scripts/refactor/reshape-runtime.mjs --apply --phase <name>[,<name>...] [--source <packageRel>] [--dry-run]
Phases: ensure-dirs, whole-file-moves, split-modules, rewrite-refs`);
}

function parseArgs(argv) {
    /** @type {{ mode: 'check' | 'report' | 'apply' | null, manifest?: string, phases: string[], source?: string, dryRun: boolean, jsonOut?: string }} */
    const out = { mode: null, phases: [], dryRun: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--check') out.mode = 'check';
        else if (a === '--report') out.mode = 'report';
        else if (a === '--apply') out.mode = 'apply';
        else if (a === '--dry-run') out.dryRun = true;
        else if (a === '--manifest') out.manifest = argv[++i];
        else if (a === '--phase') out.phases.push(...argv[++i].split(',').map((s) => s.trim()).filter(Boolean));
        else if (a === '--source') out.source = argv[++i];
        else if (a === '--json') out.jsonOut = argv[++i];
        else if (a === '--help' || a === '-h') {
            usage();
            process.exit(0);
        } else {
            throw new Error(`unknown arg ${a}`);
        }
    }
    return out;
}

const opts = parseArgs(args);
if (!opts.mode) {
    usage();
    process.exit(1);
}

const { manifest } = loadManifest(root, opts.manifest);
const validation = validateManifest(root, manifest);

if (opts.mode === 'check') {
    if (validation.warnings.length) {
        for (const w of validation.warnings) console.warn(`WARN ${w}`);
    }
    if (validation.errors.length) {
        for (const e of validation.errors) console.error(`FAIL ${e}`);
        process.exit(1);
    }
    console.log('reshape-runtime --check PASS');
    process.exit(0);
}

if (opts.mode === 'report') {
    const payload = {
        ok: validation.errors.length === 0,
        errors: validation.errors,
        warnings: validation.warnings,
        report: validation.report,
    };
    const text = `${JSON.stringify(payload, null, 2)}\n`;
    if (opts.jsonOut) {
        fs.writeFileSync(path.join(root, opts.jsonOut), text, 'utf8');
        console.log(`wrote ${opts.jsonOut}`);
    } else {
        process.stdout.write(text);
    }
    process.exit(payload.ok ? 0 : 1);
}

if (opts.mode === 'apply') {
    if (!opts.phases.length) {
        console.error('--apply requires --phase');
        process.exit(1);
    }
    const blocking = validation.errors.filter((e) => !e.includes('sha256 mismatch'));
    if (blocking.length) {
        for (const e of blocking) console.error(`FAIL ${e}`);
        console.error('refusing --apply while --check fails');
        process.exit(1);
    }
    for (const w of validation.errors.filter((e) => e.includes('sha256 mismatch'))) {
        console.warn(`WARN ${w}`);
    }
    const actions = applyManifest(root, manifest, {
        phases: opts.phases,
        source: opts.source,
        dryRun: opts.dryRun,
    });
    for (const line of actions) console.log(opts.dryRun ? `DRY ${line}` : line);
    console.log(`reshape-runtime --apply done (${actions.length} actions)`);
}
