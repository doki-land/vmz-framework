/**
 * 工具链唯一来源：仓根 `rust-toolchain.toml` 的 `channel`。
 *
 * CI、Vue 回归与发布工作流都经本脚本解析 channel 再安装 Rust，禁止在工作流里
 * 直接写 `nightly` / `stable` 浮动引用：浮动 channel 让同一份源码与同一个锁文件
 * 在不同日期编译出不同二进制，本地绿与 CI 绿就不再是同一构建合同。
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 精确 pin：带日期的 nightly / beta，或具体版本号。 */
export const EXACT_PIN = /^(?:(?:nightly|beta)-\d{4}-\d{2}-\d{2}|\d+\.\d+\.\d+)$/;

/**
 * 解析并校验工具链 pin。
 *
 * @param {string} [root] 仓库根目录
 * @returns {Promise<string>} 精确 channel 名
 */
export async function resolveToolchainChannel(root = REPO_ROOT) {
    const manifest = path.join(root, 'rust-toolchain.toml');
    const source = await readFile(manifest, 'utf8');
    const match = /^[ \t]*channel[ \t]*=[ \t]*["']([^"']+)["'][ \t]*$/m.exec(source);
    if (!match) {
        throw new Error(`\`${manifest}\` 缺少 \`[toolchain] channel\``);
    }
    const channel = match[1];
    if (!EXACT_PIN.test(channel)) {
        throw new Error(
            `\`${manifest}\` 的 channel \`${channel}\` 不是精确 pin：只允许带日期的 nightly / beta 或具体版本号`,
        );
    }
    return channel;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.stdout.write(await resolveToolchainChannel());
}
