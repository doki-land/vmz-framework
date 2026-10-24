/**
 * Materialize `defineConfig({ delivery: { packaging: { wechat } } })` for wechat_pack.
 * Pure data only. Writes `dist/_vmz/wechat-packaging.json` (not a second config entry).
 */

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { pickDeliveryPackaging, type WechatPackagingData } from '../delivery/delivery-profile.js';
import { writePrettyJsonFile } from './pretty-json.js';
import { loadVmzConfig } from './plugin-host.js';

export const WECHAT_PACKAGING_SCHEMA = 'vmz.target.wechat_packaging.v0';
export const WECHAT_PACKAGING_REL = 'dist/_vmz/wechat-packaging.json';

/**
 * @param {unknown} delivery
 * @returns {{ schema: string, appId: string, projectName?: string, title?: string }}
 */
interface WechatPackagingSpec {
    schema: string;
    appId: string;
    projectName?: string;
    title?: string;
}

export function wechatPackagingFromDelivery(delivery: unknown): WechatPackagingSpec {
    const diagnostics: Array<{ code: string; message: string }> = [];
    const packaging = pickDeliveryPackaging(delivery && typeof delivery === 'object' ? delivery : {}, diagnostics);
    const wechat: WechatPackagingData = packaging && packaging.wechat ? packaging.wechat : {};
    const out: WechatPackagingSpec = {
        schema: WECHAT_PACKAGING_SCHEMA,
        appId: typeof wechat.appId === 'string' && wechat.appId.trim() ? wechat.appId.trim() : 'touristappid',
    };
    if (typeof wechat.projectName === 'string' && wechat.projectName.trim()) {
        out.projectName = wechat.projectName.trim();
    }
    if (typeof wechat.title === 'string' && wechat.title.trim()) {
        out.title = wechat.title.trim();
    }
    return out;
}

/**
 * Write the WeChat packaging contract from an already-evaluated delivery snapshot.
 * Sync by contract: the native packer must consume prepared data, never read a config.
 * @param {string} project
 * @param {unknown} delivery
 */
export function materializeWechatPackaging(project: string, delivery: unknown) {
    const spec = wechatPackagingFromDelivery(delivery);
    const abs = path.join(project, WECHAT_PACKAGING_REL);
    mkdirSync(path.dirname(abs), { recursive: true });
    writePrettyJsonFile(abs, spec);
    return spec;
}

/**
 * Async host entry: evaluate `vmz.config.*` once, then prepare the packaging snapshot.
 * @param {string} project
 */
export async function prepareWechatPackaging(project: string) {
    const cfg = await loadVmzConfig(project);
    return materializeWechatPackaging(project, cfg.delivery);
}
