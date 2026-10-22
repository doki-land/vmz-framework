/** Homepage Deploy Planner — T.* → agent prompt (04 contract).
 *
 * Primary deliverable: copy-paste agentPrompt for Cursor/Codex/etc.
 * Structured fields are a glanceable summary; not a hand-copied JSON plan.
 *
 * Axes: T.vendor = where · T.ship = how (git-ci | direct-upload)
 */

export type SecretsAnswer = 'none' | 'yes';
export type HtmlAnswer = 'cdn-prebuild' | 'request-ssr' | 'browser-only';
export type AssetsAnswer = 'same-host' | 'cdn' | 'embedded-binary';
export type ServerAnswer = 'none' | 'node' | 'worker' | 'rust-host';
export type UpdateAnswer = 'no' | 'release-fallback';

/** Where to host (platform). */
export type VendorId =
    | 'cloudflare-pages'
    | 'github-pages'
    | 'vercel'
    | 'netlify'
    | 'tencent-edgeone'
    | 'cloudflare-workers'
    | 's3-cloudfront'
    | 'node-vps'
    | 'rust-bin';

/**
 * How to ship (orthogonal to vendor).
 * - git-ci: vmz deploy scaffolds CI; author pushes to publish
 * - direct-upload: vmz deploy uploads from the laptop (private repo / no Git integration)
 */
export type ShipMode = 'git-ci' | 'direct-upload';

export type PlannerAnswers = {
    secrets: SecretsAnswer;
    html: HtmlAnswer;
    assets: AssetsAnswer;
    server: ServerAnswer;
    update: UpdateAnswer;
    ship: ShipMode;
    vendors: VendorId[];
};

export type ExternalStep = {
    id: string;
    vendor: string;
    title: string;
    console: string[];
    /** Populated when ship=git-ci (else a short “不适用” note). */
    ci: string[];
    /** Populated when ship=direct-upload (else a short “不适用” note). */
    localPush: string[];
};

export type DeployPlanView = {
    schema: 'vmz.deploy.plan.v0';
    recipeId: string;
    profileId: string;
    assembly: string;
    serverRuntime?: string;
    ship: ShipMode;
    requiredEnv: string[];
    adapters: { kind: string; note?: string }[];
    /** Primary UX: paste into a coding agent. */
    agentPrompt: string;
    /** Glanceable; also embedded inside agentPrompt — not the copy target. */
    vmzConfigSnippet: string;
    commandsSuggested: string[];
    externalSteps: ExternalStep[];
    cautions: string[];
    deepLinks: { label: string; href: string }[];
    disclaimer: string;
};

const DISCLAIMER =
    '这份提示词只描述配置怎么落地，不代表项目已经通过 vmz check 或 vmz build。请把它交给编码助手完成脚手架与配置；能否上线以两条命令的实际结果为准。提示词里只有环境变量名，不含任何密钥值。';

const DOC_LOCALE = 'zh-hans';
const DEPLOY_GUIDE = `/d/${DOC_LOCALE}/guide/deploy`;
const STATIC_HOSTS_DOC = `${DEPLOY_GUIDE}/static-hosts`;

/** Heading ids must match document renderer slugify (see dist recipes.html). */
const RECIPE_DOCS: Record<string, string> = {
    static: `${DEPLOY_GUIDE}/recipes#static-只有-cdn-对象存储`,
    'web-ssr': `${DEPLOY_GUIDE}/recipes#web-ssr-单机全栈默认`,
    'web-hybrid': `${DEPLOY_GUIDE}/recipes#web-hybrid-cdn-独立服务端`,
    'web-client': `${DEPLOY_GUIDE}/recipes#web-client-纯前端-本地盘`,
    'panel-embedded': `${DEPLOY_GUIDE}/recipes#rust-embedded-嵌入基线-整包回退`,
};

const STATIC_VENDORS: VendorId[] = ['cloudflare-pages', 'github-pages', 'vercel', 'netlify', 'tencent-edgeone'];

type RecipePick = {
    recipeId: string;
    profileId: string;
    assembly: string;
    serverRuntime?: string;
};

function mapServerRuntime(server: ServerAnswer): string | undefined {
    if (server === 'none') return undefined;
    return server;
}

function pushShipCautions(ship: ShipMode, cautions: string[]) {
    if (ship === 'git-ci') {
        cautions.push('发布方式为 Git CI：vmz deploy 只生成流水线与密钥名，真正上线由你手动 git push 触发。');
        cautions.push('管理密钥默认可从 .env.secrets* 读取；接入 CI 时建议用 --secret NAME=VALUE 一次性传入，既不落盘也不写进报告。');
    } else {
        cautions.push(
            '发布方式为本机直传：适合私有仓库或托管方没有接入 Git 的场景；令牌默认可从 .env.secrets* 读取，也可用 --secret 一次性传入。',
        );
    }
}

function forceServer(server: ServerAnswer): ServerAnswer {
    return server === 'none' ? 'node' : server;
}

function hasStaticVendor(vendors: VendorId[]): boolean {
    return vendors.some((v) => STATIC_VENDORS.includes(v));
}

function publishDirNote(profileId: string): string {
    return `发布目录：以静态交付清单为准，通常是 dist（当前 profile 为 ${profileId}）`;
}

function buildCmd(profileId: string): string {
    return `构建命令：vmz build --release --profile ${profileId}`;
}

function pickRecipe(answers: PlannerAnswers, cautions: string[]): RecipePick {
    const { secrets, html, assets, server, update, vendors } = answers;

    if (update === 'release-fallback' || assets === 'embedded-binary') {
        if (secrets === 'yes' && assets === 'embedded-binary') {
            cautions.push('把资源嵌入二进制后，密钥仍必须由可信宿主进程持有：只按环境变量名绑定，不得写入嵌入产物。');
        }
        if (html === 'browser-only') {
            cautions.push('已选择嵌入或整包更新，按面板嵌入配方出包；纯浏览器拓扑不适用于这种交付方式。');
        }
        return {
            recipeId: 'panel-embedded',
            profileId: 'panel-embedded',
            assembly: 'rust-embedded',
        };
    }

    if (secrets === 'yes') {
        if (html === 'cdn-prebuild' || html === 'browser-only' || server === 'none') {
            cautions.push('既然密钥必须留在服务端，生产环境就不能只用纯静态托管；这里已改选带可信服务端的配方。');
        }
        if (hasStaticVendor(vendors)) {
            cautions.push('所选静态平台只能承载公开外壳；密钥相关请求需要另配可信服务端，或重新考虑密钥边界。');
        }
        const runtime = forceServer(server);
        if (assets === 'cdn' && runtime !== 'none') {
            return {
                recipeId: 'web-hybrid',
                profileId: 'web-hybrid',
                assembly: 'cdn+server',
                serverRuntime: mapServerRuntime(runtime),
            };
        }
        return {
            recipeId: 'web-ssr',
            profileId: 'web-ssr',
            assembly: 'server-host',
            serverRuntime: mapServerRuntime(runtime),
        };
    }

    if (hasStaticVendor(vendors) && html !== 'request-ssr') {
        if (server !== 'none') {
            cautions.push('已选择纯静态托管：源码里可以有服务端脚本，但这个 profile 只交付能静态证明的部分。');
        } else {
            cautions.push('已选择纯静态托管：源码里可以有服务端脚本，依赖运行时服务端或 secret() 的路由请以 check / build 结果为准。');
        }
        return {
            recipeId: 'static',
            profileId: 'static',
            assembly: 'web-static',
        };
    }

    if (hasStaticVendor(vendors) && html === 'request-ssr') {
        cautions.push('静态托管无法按请求生成 HTML：要么改用混合或服务端配方，要么把首屏改成 CDN 预生成。');
    }

    if (html === 'request-ssr') {
        const runtime = forceServer(server);
        if (server === 'none') {
            cautions.push('请求时 SSR 需要服务端进程，这里默认使用 Node 运行时。');
        }
        if (assets === 'cdn') {
            return {
                recipeId: 'web-hybrid',
                profileId: 'web-hybrid',
                assembly: 'cdn+server',
                serverRuntime: mapServerRuntime(runtime),
            };
        }
        return {
            recipeId: 'web-ssr',
            profileId: 'web-ssr',
            assembly: 'server-host',
            serverRuntime: mapServerRuntime(runtime),
        };
    }

    if (html === 'browser-only') {
        if (server !== 'none') {
            cautions.push('纯浏览器拓扑不包含服务端进程；需要接口或 SSR 时，请改选「请求时 SSR」并明确密钥边界。');
        }
        return {
            recipeId: 'web-client',
            profileId: 'web-client',
            assembly: 'local-static',
        };
    }

    if (server !== 'none' && assets === 'cdn') {
        return {
            recipeId: 'web-hybrid',
            profileId: 'web-hybrid',
            assembly: 'cdn+server',
            serverRuntime: mapServerRuntime(server),
        };
    }
    if (server !== 'none') {
        cautions.push('首屏预生成又有服务端进程时，按单机全栈组装；如果服务端部署在另一台机器，请把静态资源改选为 CDN。');
        return {
            recipeId: 'web-ssr',
            profileId: 'web-ssr',
            assembly: 'server-host',
            serverRuntime: mapServerRuntime(server),
        };
    }
    return {
        recipeId: 'static',
        profileId: 'static',
        assembly: 'web-static',
    };
}

function buildSnippet(pick: RecipePick): string {
    const lines: string[] = [
        "import { defineConfig } from 'vmz'",
        '',
        'export default defineConfig({',
        '  delivery: {',
        `    default: '${pick.profileId}',`,
        '    profiles: {',
    ];

    if (pick.assembly === 'rust-embedded') {
        lines.push(
            `      '${pick.profileId}': {`,
            "        host: 'browser',",
            "        assembly: 'rust-embedded',",
            '        // sources: defineSite({ ... }) — 详见 recipes#rust-embedded',
            '      },',
        );
    } else if (pick.serverRuntime) {
        lines.push(
            `      '${pick.profileId}': {`,
            "        host: 'browser',",
            `        assembly: '${pick.assembly}',`,
            `        serverRuntime: '${pick.serverRuntime}',`,
            '      },',
        );
    } else if (pick.assembly === 'web-static') {
        lines.push(`      '${pick.profileId}': { host: 'browser', assembly: 'web-static', name: 'cdn' },`);
    } else {
        lines.push(`      '${pick.profileId}': { host: 'browser', assembly: '${pick.assembly}' },`);
    }

    lines.push(
        '    },',
        '    // 可选机器可读配置：由编码助手生成 deploy.plan.json 供 vmz deploy --plan 使用，无需手工抄写',
        "    // deploy: { plan: './deploy.plan.json' },",
        '  },',
        '})',
    );
    return lines.join('\n');
}

function collectRequiredEnv(answers: PlannerAnswers, _pick: RecipePick): string[] {
    const names = new Set<string>();
    if (answers.secrets === 'yes') names.add('SESSION_SECRET');
    for (const v of answers.vendors) {
        if (v === 'cloudflare-pages' || v === 'cloudflare-workers') {
            names.add('CF_API_TOKEN');
            names.add('CF_ACCOUNT_ID');
        }
        if (v === 'cloudflare-pages') names.add('CF_PAGES_PROJECT_NAME');
        if (v === 'cloudflare-workers') names.add('CF_WORKERS_SCRIPT_NAME');
        if (v === 'github-pages' && answers.ship === 'direct-upload') {
            names.add('GH_TOKEN');
        }
        if (v === 'vercel') {
            names.add('VERCEL_TOKEN');
            names.add('VERCEL_ORG_ID');
            names.add('VERCEL_PROJECT_ID');
        }
        if (v === 'netlify') {
            names.add('NETLIFY_AUTH_TOKEN');
            names.add('NETLIFY_SITE_ID');
        }
        if (v === 'tencent-edgeone') {
            names.add('TENCENTCLOUD_SECRET_ID');
            names.add('TENCENTCLOUD_SECRET_KEY');
            names.add('EDGEONE_ZONE_ID');
            names.add('EDGEONE_SITE_ID');
        }
        if (v === 's3-cloudfront') {
            names.add('AWS_ACCESS_KEY_ID');
            names.add('AWS_SECRET_ACCESS_KEY');
            names.add('S3_BUCKET');
            names.add('CLOUDFRONT_DISTRIBUTION_ID');
        }
        if (v === 'node-vps') names.add('DEPLOY_HOST');
        if (v === 'rust-bin') names.add('UPDATE_BASE_URL');
    }
    return [...names].sort();
}

function buildAdapters(answers: PlannerAnswers, pick: RecipePick): { kind: string; note?: string }[] {
    const adapters: { kind: string; note?: string }[] = [];
    const shipNote =
        answers.ship === 'git-ci' ? '由 CI 发布，push 后自动执行' : '本机直接上传，不经过 CI';

    for (const v of answers.vendors) {
        if (v === 'cloudflare-pages') {
            adapters.push({ kind: 'cloudflare-pages', note: `${shipNote}；不要配置 SPA 回退` });
        } else if (v === 'github-pages') {
            adapters.push({ kind: 'github-pages', note: shipNote });
        } else if (v === 'vercel') {
            adapters.push({ kind: 'vercel', note: shipNote });
        } else if (v === 'netlify') {
            adapters.push({ kind: 'netlify', note: shipNote });
        } else if (v === 'tencent-edgeone') {
            adapters.push({ kind: 'tencent-edgeone', note: `${shipNote}；CLI 参数以腾讯云文档为准` });
        } else if (v === 'cloudflare-workers') {
            adapters.push({ kind: 'cloudflare-workers', note: '绑定只登记变量名，不写入值' });
        } else if (v === 's3-cloudfront') {
            adapters.push({ kind: 's3-cloudfront', note: '默认按本机直传处理' });
        } else if (v === 'node-vps') {
            adapters.push({ kind: 'node-vps', note: '发布目录配合 CURRENT 指针切换' });
        } else if (v === 'rust-bin') {
            adapters.push({ kind: 'rust-bin', note: '嵌入基线，配合远程整包更新' });
        }
    }

    if (adapters.length === 0) {
        if (pick.assembly === 'server-host' || pick.assembly === 'rust-embedded') {
            adapters.push({ kind: 'filesystem-release', note: '本机 release 目录切换' });
        } else {
            adapters.push({ kind: 'filesystem-release', note: '未选外部平台时默认使用本机 release 目录' });
        }
    }
    return adapters;
}

function axisStep(id: string, vendor: string, title: string, console: string[], ci: string[], localPush: string[]): ExternalStep {
    return { id, vendor, title, console, ci, localPush };
}

function buildExternalSteps(answers: PlannerAnswers, pick: RecipePick, requiredEnv: string[]): ExternalStep[] {
    const steps: ExternalStep[] = [];
    const envList =
        requiredEnv.length > 0
            ? `需要准备的环境变量名（只登记名称）：${requiredEnv.join('、')}`
            : '公开环境变量即可，例如 VMZ_SITE_ORIGIN；不要把密钥写进静态产物';
    const cmd = buildCmd(pick.profileId);
    const pub = publishDirNote(pick.profileId);
    const ship = answers.ship;
    const naCi = '当前选择本机直传，不生成 CI 流水线；需要流水线时改选「Git CI」。';
    const naUp = '当前选择 Git CI，不在本机上传；需要本机直传时改选「本机直传」。';

    for (const v of answers.vendors) {
        if (v === 'cloudflare-pages') {
            steps.push(
                axisStep(
                    v,
                    'Cloudflare Pages',
                    'cloudflare-pages',
                    ['项目名；绑定域名与 HTTPS', ship === 'git-ci' ? '生产分支，push 后触发构建' : '可以不绑定 Git 仓库', cmd, pub],
                    ship === 'git-ci'
                        ? [
                              '运行 vmz deploy 生成 Actions 工作流，并登记 CF_* 变量名',
                              '密钥默认可从 .env.secrets* 读取；CI 场景建议 --secret NAME=VALUE 一次性传入',
                              '工作流内执行 wrangler pages deploy',
                              '完成后手动 git push',
                              envList,
                          ]
                        : [naCi],
                    ship === 'direct-upload'
                        ? ['运行 vmz deploy：本机 check / build 后通过 wrangler 或 API 直传', '令牌默认可从 .env.secrets* 读取，或用 --secret 传入', envList]
                        : [naUp],
                ),
            );
        }
        if (v === 'github-pages') {
            steps.push(
                axisStep(
                    v,
                    'GitHub Pages',
                    'github-pages',
                    [
                        ship === 'git-ci' ? 'Pages 来源设为 Actions' : 'Pages 接受 artifact 或 gh-pages 分支',
                        '自定义域名；base path 与 VMZ_SITE_ORIGIN 保持一致',
                        cmd,
                        pub,
                    ],
                    ship === 'git-ci'
                        ? ['运行 vmz deploy 生成工作流（OIDC 授权）', '密钥默认可从 .env.secrets* 读取，或用 --secret 一次性传入', '完成后手动 git push']
                        : [naCi],
                    ship === 'direct-upload' ? ['运行 vmz deploy 从本机上传（GH_TOKEN）；令牌来自 secrets 文件或 --secret', envList] : [naUp],
                ),
            );
        }
        if (v === 'vercel') {
            steps.push(
                axisStep(
                    v,
                    'Vercel',
                    'vercel',
                    ['Framework 选 Other；确认 Output Directory 与域名', cmd, pub],
                    ship === 'git-ci'
                        ? [
                              '运行 vmz deploy 生成工作流，并登记 VERCEL_* 变量名',
                              '密钥默认可从 .env.secrets* 读取，或用 --secret 一次性传入',
                              '完成后手动 git push',
                              envList,
                          ]
                        : [naCi],
                    ship === 'direct-upload'
                        ? ['运行 vmz deploy：vercel deploy --prebuilt --prod', '令牌默认可从 .env.secrets* 读取，或用 --secret 传入', envList]
                        : [naUp],
                ),
            );
        }
        if (v === 'netlify') {
            steps.push(
                axisStep(
                    v,
                    'Netlify',
                    'netlify',
                    ['确认 Publish directory 与域名', cmd, pub],
                    ship === 'git-ci'
                        ? [
                              '运行 vmz deploy 登记 NETLIFY_* 变量名',
                              '密钥默认可从 .env.secrets* 读取，或用 --secret 一次性传入',
                              '完成后手动 git push',
                              envList,
                          ]
                        : [naCi],
                    ship === 'direct-upload'
                        ? ['运行 vmz deploy：netlify deploy --prod --dir=<publish>', '令牌默认可从 .env.secrets* 读取，或用 --secret 传入', envList]
                        : [naUp],
                ),
            );
        }
        if (v === 'tencent-edgeone') {
            steps.push(
                axisStep(
                    v,
                    'Tencent EdgeOne',
                    'tencent-edgeone',
                    ['站点与加速域名；上传证书', cmd, pub],
                    ship === 'git-ci'
                        ? [
                              '运行 vmz deploy 登记 TENCENTCLOUD_* 与 EDGEONE_* 变量名',
                              '密钥默认可从 .env.secrets* 读取，或用 --secret 一次性传入',
                              '完成后手动 git push',
                              'CLI 参数以腾讯云文档为准',
                              envList,
                          ]
                        : [naCi],
                    ship === 'direct-upload'
                        ? ['运行 vmz deploy 从本机直传；CLI 参数以腾讯云文档为准', '令牌默认可从 .env.secrets* 读取，或用 --secret 传入', envList]
                        : [naUp],
                ),
            );
        }
        if (v === 'cloudflare-workers') {
            steps.push(
                axisStep(
                    v,
                    'Cloudflare Workers',
                    'cloudflare-workers',
                    [
                        '脚本名与入口；绑定只登记变量名',
                        answers.vendors.includes('cloudflare-pages') ? '与 Pages 分工：静态外壳交给 Pages，接口交给 Worker' : '只用 Worker 时先确认首屏 HTML 来源',
                    ],
                    [envList],
                    ['本机 wrangler 或 vmz deploy 发布', envList],
                ),
            );
        }
        if (v === 's3-cloudfront') {
            steps.push(
                axisStep(v, 'S3 + CloudFront', 's3-cloudfront', ['Bucket、区域与 Distribution ID', pub], ['也可以在 CI runner 内同步'], [envList]),
            );
        }
        if (v === 'node-vps') {
            steps.push(
                axisStep(
                    v,
                    'Node VPS',
                    'node-vps',
                    ['发布目录与 CURRENT 指针；确认 PORT', '反向代理只做转发，不改写路由'],
                    ['可选：自建 runner'],
                    [envList, '本机 release 目录切换'],
                ),
            );
        }
        if (v === 'rust-bin') {
            steps.push(axisStep(v, 'Rust binary', 'rust-bin', ['嵌入构建产物；只登记 UPDATE_BASE_URL 变量名'], ['也可以在 CI 里打包 release'], [envList]));
        }
    }

    if (steps.length === 0) {
        steps.push(
            axisStep('local', 'local', 'filesystem-release', [cmd, '未选择外部平台'], ship === 'git-ci' ? ['可以先选平台，再配 CI'] : ['无需额外步骤'], [
                '运行 vmz deploy 走本机 release 目录',
                '项目根目录的 .env.secrets* 仅在本机使用',
            ]),
        );
    }

    return steps;
}

function bullet(lines: string[]): string {
    return lines.map((l) => `- ${l}`).join('\n');
}

function formatStepBlock(step: ExternalStep): string {
    return [
        `### ${step.title}（${step.vendor}）`,
        '',
        '控制台：',
        bullet(step.console),
        '',
        'Git CI：',
        bullet(step.ci),
        '',
        '本机直传：',
        bullet(step.localPush),
    ].join('\n');
}

function buildAgentPrompt(input: {
    pick: RecipePick;
    ship: ShipMode;
    requiredEnv: string[];
    adapters: { kind: string; note?: string }[];
    externalSteps: ExternalStep[];
    cautions: string[];
    commandsSuggested: string[];
    vmzConfigSnippet: string;
    deepLinks: { label: string; href: string }[];
    disclaimer: string;
}): string {
    const { pick, ship, requiredEnv, adapters, externalSteps, cautions, commandsSuggested, vmzConfigSnippet, deepLinks, disclaimer } = input;

    const platformLine =
        adapters.length > 0
            ? adapters.map((a) => (a.note ? `${a.kind}（${a.note}）` : a.kind)).join('、')
            : '未选择外部平台，使用本机 release 目录';

    const envLine =
        requiredEnv.length > 0 ? requiredEnv.join('、') : '无需额外发布变量；公开变量如 VMZ_SITE_ORIGIN 按需配置';

    const shipBlock =
        ship === 'git-ci'
            ? [
                  '发布方式为 **git-ci**：',
                  '- 只生成 CI 工作流并登记密钥名；不要在作者机器上直接发布并声称已上线',
                  '- 作者随后手动 `git push`，由 CI 完成 check、build 与发布',
                  '- 密钥默认可从 `.env.secrets*` 读取；更推荐用 `vmz deploy --secret NAME=VALUE` 一次性传入，既不落盘也不写进报告',
              ].join('\n')
            : [
                  '发布方式为 **direct-upload**：',
                  '- 本机依次执行 `vmz check`、`vmz build`，再由 adapter 直传',
                  '- 令牌默认可从 `.env.secrets*` 读取，也可以用 `--secret NAME=VALUE` 一次性传入',
              ].join('\n');

    const cautionBlock =
        cautions.length > 0
            ? ['## 选型提醒（与 check 诊断无关）', '', bullet(cautions)].join('\n')
            : '## 选型提醒\n\n- 无';

    const stepsBlock = externalSteps.map(formatStepBlock).join('\n\n');

    const linksBlock = bullet(deepLinks.map((l) => `${l.label}：${l.href}`));

    return [
        '# VMZ 部署落地任务（由 /deploy-planner 生成）',
        '',
        disclaimer,
        '',
        '你是这个仓库的编码助手。请按下面的结论修改配置、补齐脚手架并准备发布，最后运行验证命令。不要另造一套路由、MIME 或 SPA 回退规则；厂商侧的 `_headers`、`vercel.json` rewrites 都不是 VMZ 的事实来源。',
        '',
        '## 拓扑结论',
        '',
        bullet([
            `配方：${pick.recipeId}`,
            `profile：${pick.profileId}`,
            `组装方式：${pick.assembly}`,
            ...(pick.serverRuntime ? [`服务端运行时：${pick.serverRuntime}`] : []),
            `发布方式：${ship}`,
            `平台 adapter：${platformLine}`,
            `所需环境变量（只有名称）：${envLine}`,
        ]),
        '',
        '## 硬约束',
        '',
        shipBlock,
        '',
        bullet([
            '密钥值不得写进 `vmz.config.ts`、Web 产物、报告、日志、工作流或本计划正文',
            '能否上线只认 `vmz check` 与 `vmz build` 的结果；这份提示词不构成上线证明',
            '如果 `vmz deploy --plan` 需要机器可读的 DeployPlan，由你生成文件，不要让用户手抄 JSON',
            '缺少对应的 `@vmz/plugin-deploy-*` 时应当报错并提示安装，不得静默跳过',
        ]),
        '',
        '## 请你完成',
        '',
        '1. 合并或写入 `vmz.config.ts` 的 `delivery` 配置（形状见下）；沿用仓库已有的 `defineConfig` 风格，不要另建 `vmz.site.ts`。',
        '2. 按发布方式准备 `vmz deploy`：git-ci 生成 CI 工作流并登记密钥名；direct-upload 走本机直传路径。',
        '3. 对照下方「外部平台清单」核对控制台字段，只填名称与路径类信息。',
        '4. 运行建议命令；缺少绑定只报告变量名，不回显值；git-ci 结束后明确提示用户手动 git push。',
        '',
        '### delivery 配置（参考形状）',
        '',
        '```ts',
        vmzConfigSnippet.trimEnd(),
        '```',
        '',
        '### 建议命令',
        '',
        bullet(commandsSuggested),
        '',
        '## 外部平台清单',
        '',
        stepsBlock,
        '',
        cautionBlock,
        '',
        '## 相关文档',
        '',
        linksBlock,
        '',
    ].join('\n');
}

export function buildDeployPlan(answers: PlannerAnswers): DeployPlanView {
    const cautions: string[] = [];
    const pick = pickRecipe(answers, cautions);
    pushShipCautions(answers.ship, cautions);
    const requiredEnv = collectRequiredEnv(answers, pick);
    const adapters = buildAdapters(answers, pick);
    const externalSteps = buildExternalSteps(answers, pick, requiredEnv);
    const vmzConfigSnippet = buildSnippet(pick);
    const ship = answers.ship;

    const commandsSuggested: string[] = [`vmz check`, `vmz build --release --profile ${pick.profileId}`];
    if (ship === 'git-ci') {
        commandsSuggested.push(
            `vmz deploy [--secret NAME=VALUE]…   # git-ci：默认读 .env.secrets*；管理密钥建议一次性传入；不在本机发布`,
            `git push   # 之后由 CI 完成 check、build 与发布`,
        );
    } else {
        commandsSuggested.push(`vmz deploy [--secret NAME=VALUE]…   # direct-upload：默认读 .env.secrets*；也可以一次性传参`);
    }

    const deepHref = RECIPE_DOCS[pick.recipeId] ?? `${DEPLOY_GUIDE}/recipes`;
    const deepLinks = [
        { label: '部署指南', href: `${DEPLOY_GUIDE}/` },
        { label: `配方 ${pick.recipeId}`, href: deepHref },
        { label: '密钥与环境变量', href: `${DEPLOY_GUIDE}/secrets-env` },
        { label: 'vmz deploy', href: `${DEPLOY_GUIDE}/cli` },
    ];
    if (hasStaticVendor(answers.vendors) || pick.assembly === 'web-static') {
        deepLinks.splice(2, 0, { label: '纯静态平台填写清单', href: STATIC_HOSTS_DOC });
    }

    const disclaimer = DISCLAIMER;
    const agentPrompt = buildAgentPrompt({
        pick,
        ship,
        requiredEnv,
        adapters,
        externalSteps,
        cautions,
        commandsSuggested,
        vmzConfigSnippet,
        deepLinks,
        disclaimer,
    });

    return {
        schema: 'vmz.deploy.plan.v0',
        recipeId: pick.recipeId,
        profileId: pick.profileId,
        assembly: pick.assembly,
        serverRuntime: pick.serverRuntime,
        ship,
        requiredEnv,
        adapters,
        agentPrompt,
        vmzConfigSnippet,
        commandsSuggested,
        externalSteps,
        cautions,
        deepLinks,
        disclaimer,
    };
}

export const DEFAULT_ANSWERS: PlannerAnswers = {
    secrets: 'none',
    html: 'cdn-prebuild',
    assets: 'cdn',
    server: 'none',
    update: 'no',
    ship: 'git-ci',
    vendors: [],
};
