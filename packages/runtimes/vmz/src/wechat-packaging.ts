/**
 * Materialize `defineConfig({ delivery: { packaging: { wechat } } })` for wechat_pack.
 * Pure data only. Writes `dist/_vmz/wechat-packaging.json` (not a second config entry).
 */

import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createJiti } from 'jiti';
import { pickDeliveryPackaging, type WechatPackagingData } from './delivery-profile.js';
import { writePrettyJsonFile } from './pretty-json.js';

export const WECHAT_PACKAGING_SCHEMA = 'vmz.target.wechat_packaging.v0';
export const WECHAT_PACKAGING_REL = 'dist/_vmz/wechat-packaging.json';

const CONFIG_NAMES = ['vmz.config.ts', 'vmz.config.mts', 'vmz.config.mjs', 'vmz.config.js'];

function loadConfigSync(project) {
    for (const name of CONFIG_NAMES) {
        const full = path.join(project, name);
        if (!existsSync(full)) continue;
        const jiti = createJiti(import.meta.url, {
            interopDefault: true,
            moduleCache: false,
        });
        return jiti(full);
    }
    return null;
}

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
 * Load `vmz.config.*` and write the WeChat packaging contract for the Rust packer.
 * @param {string} project
 */
export function materializeWechatPackaging(project) {
    const cfg = loadConfigSync(project);
    const spec = wechatPackagingFromDelivery(cfg?.delivery);
    const abs = path.join(project, WECHAT_PACKAGING_REL);
    mkdirSync(path.dirname(abs), { recursive: true });
    writePrettyJsonFile(abs, spec);
    return spec;
}
