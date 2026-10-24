/**
 * WeChat packaging snapshot contract: async prepare evaluates config once,
 * the sync native pack consumes the prepared `dist/_vmz/wechat-packaging.json`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    WECHAT_PACKAGING_REL,
    materializeWechatPackaging,
    prepareWechatPackaging,
    wechatPackagingFromDelivery,
} from 'vmz';

function fixture(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-wechat-snapshot-'));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(
        path.join(dir, 'src', 'Application.vmz'),
        '<template><p>hi</p></template>\n<script client>\nexport default class Application {}\n</script>\n',
    );
    return dir;
}

function writeConfig(dir: string, appId: string): void {
    fs.writeFileSync(
        path.join(dir, 'vmz.config.ts'),
        `export default { delivery: { packaging: { wechat: { appId: '${appId}', projectName: 'snapshot-app' } } } };\n`,
    );
}

test('materializeWechatPackaging writes pure delivery data', (t) => {
    const dir = fixture();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const spec = materializeWechatPackaging(dir, { packaging: { wechat: { appId: 'wx-explicit', title: 'T' } } });
    assert.equal(spec.appId, 'wx-explicit');
    const written = JSON.parse(fs.readFileSync(path.join(dir, WECHAT_PACKAGING_REL), 'utf8'));
    assert.deepEqual(written, spec);
    assert.equal(wechatPackagingFromDelivery(null).appId, 'touristappid');
});

test('prepare evaluates config once and leaves a stable snapshot for the sync pack', async (t) => {
    const dir = fixture();
    writeConfig(dir, 'wx-from-config');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const prepared = await prepareWechatPackaging(dir);
    assert.equal(prepared.appId, 'wx-from-config');
    assert.equal(
        JSON.parse(fs.readFileSync(path.join(dir, WECHAT_PACKAGING_REL), 'utf8')).appId,
        'wx-from-config',
    );

    // Mutating the config must not rewrite the snapshot: only an explicit prepare refreshes it.
    writeConfig(dir, 'wx-mutated-after-prepare');
    assert.equal(
        JSON.parse(fs.readFileSync(path.join(dir, WECHAT_PACKAGING_REL), 'utf8')).appId,
        'wx-from-config',
    );
    // Node ESM caches evaluated config modules; re-evaluation requires a fresh process
    // (the dev session restarts its config build process instead of adding URL timestamps).
    assert.equal((await prepareWechatPackaging(dir)).appId, 'wx-from-config');
});
