import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function isArtifact(fileName: string): boolean {
    if (fileName.endsWith('.json')) return false;

    return (
        fileName.endsWith('.vmz-runtime') ||
        fileName.endsWith('.vmz-runtime.map') ||
        fileName.endsWith('.d.ts') ||
        fileName.endsWith('.d.ts.map')
    );
}

function processDirectory(currentDir: string, inPackage: boolean = false) {
    if (!fs.existsSync(currentDir)) return;

    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
                continue;
            }

            // 如果我们在 packages 目录下，或者已经在某个 package 中，则标记 inPackage 为 true
            const isPackageDir = currentDir.endsWith('packages');
            processDirectory(fullPath, inPackage || isPackageDir);
        } else if (entry.isFile()) {
            const isArtifactFile = isArtifact(entry.name);

            if (isArtifactFile) {
                const baseName = entry.name.replace(/\.(d\.ts|js|js\.map|d\.ts\.map)$/, '');

                // 如果同名 .ts 或 .tsx 存在，则认为该文件是产物
                const hasSource =
                    fs.existsSync(path.join(currentDir, baseName + '.ts')) || fs.existsSync(path.join(currentDir, baseName + '.tsx'));

                if (hasSource) {
                    try {
                        fs.unlinkSync(fullPath);
                        console.log(`[CLEAN] 已删除: ${fullPath}`);
                    } catch (err) {
                        console.error(`[ERROR] 无法删除 ${fullPath}:`, err);
                    }
                }
            }
        }
    }
}

console.log(`正在从 ${rootDir} 中清理编译产物...`);
processDirectory(rootDir);
console.log('清理完成。');
