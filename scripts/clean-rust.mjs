#!/usr/bin/env node

/**
 * 删除 Rust 编译器相关文件
 *
 * 此脚本用于删除 CVO 框架中与 Rust 编译器相关的文件和目录。
 */

import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const projectRoot = 'E:\\cvo 全栈开发\\cvo-framework.ts';

const filesToDelete = [join(projectRoot, 'compilers'), join(projectRoot, 'Cargo.toml'), join(projectRoot, 'Cargo.lock')];

console.log('开始删除 Rust 编译器相关文件...');

for (const filePath of filesToDelete) {
    if (existsSync(filePath)) {
        try {
            rmSync(filePath, { recursive: true, force: true });
            console.log(`✓ 删除成功: ${filePath}`);
        } catch (error) {
            console.error(`✗ 删除失败: ${filePath}`);
            console.error(`  错误: ${error.message}`);
        }
    } else {
        console.log(`⚠️  文件不存在: ${filePath}`);
    }
}

console.log('\n删除完成！');
