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
    '本提示词 ≠ 已通过 vmz check / vmz build。把它交给编码 agent 落地配置与脚手架；可行性以 check/build 为准。git-ci = 只配流水线 + 手动 push；direct-upload = 本机直传。永不要求人手抄 JSON；产物中永不含密钥值。';

const DOC_LOCALE = 'zh-hans';
const DEPLOY_GUIDE = `/d/${DOC_LOCALE}/guide/deploy`;
const STATIC_HOSTS_DOC = `${DEPLOY_GUIDE}/static-hosts`;

/** Heading ids must match document renderer slugify (see dist recipes.html). */
const RECIPE_DOCS: Record<string, string> = {
    'web-static': `${DEPLOY_GUIDE}/recipes#web-static-只有-cdn-对象存储`,
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
        cautions.push('发布方式 git-ci：vmz deploy 只配 CI；真发布靠手动 git push。');
        cautions.push(
            'advice：管理 key 默认可读 .env.secrets*；配 CI 更建议 --secret NAME=VALUE 一次性传入（不写盘、不进 report）。',
        );
    } else {
        cautions.push(
            '发布方式 direct-upload：本机直传——适合私有仓或托管方无/不用 Git 集成；token 默认可读 .env.secrets*，也可用 --secret 一次性。',
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
    return `Publish / Output directory：以 StaticDeliveryManifest 为准（常见 dist；profile=${profileId}）`;
}

function buildCmd(profileId: string): string {
    return `构建命令：vmz build --release --profile ${profileId}`;
}

function pickRecipe(answers: PlannerAnswers, cautions: string[]): RecipePick {
    const { secrets, html, assets, server, update, vendors } = answers;

    if (update === 'release-fallback' || assets === 'embedded-binary') {
        if (secrets === 'yes' && assets === 'embedded-binary') {
            cautions.push('嵌入二进制仍需要可信宿主进程持有密钥；密钥只通过 env 名绑定，不得写进嵌入产物。');
        }
        if (html === 'browser-only') {
            cautions.push('已选嵌入/整包更新：仍按 rust-embedded 配方；纯浏览器拓扑被覆盖。');
        }
        return {
            recipeId: 'panel-embedded',
            profileId: 'panel-embedded',
            assembly: 'rust-embedded',
        };
    }

    if (secrets === 'yes') {
        if (html === 'cdn-prebuild' || html === 'browser-only' || server === 'none') {
            cautions.push('T.secrets=yes：不得推荐纯 static-cdn / local-static 作为生产配方，已改选含可信 server 的配方。');
        }
        if (hasStaticVendor(vendors)) {
            cautions.push('已选静态托管平台，但 secrets=yes：静态面只能挂公开壳；密钥须另有可信 server（hybrid）或改掉 secrets。');
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
            cautions.push('已选纯静态托管：推荐 web-static。源码可有 <script server>，该 profile 只交付可静态证明的面。');
        } else {
            cautions.push('纯静态托管：web-static。源码可有 <script server>；依赖运行时 server / secret() 的 route 以 check/build 为准。');
        }
        return {
            recipeId: 'web-static',
            profileId: 'web-static',
            assembly: 'static-cdn',
        };
    }

    if (hasStaticVendor(vendors) && html === 'request-ssr') {
        cautions.push('静态托管 + 请求时 SSR：平台只能挂静态壳；完整 SSR 请改 hybrid/server，或 HTML 改「CDN 预生成」。');
    }

    if (html === 'request-ssr') {
        const runtime = forceServer(server);
        if (server === 'none') {
            cautions.push('请求时 SSR 需要服务端进程：已默认 serverRuntime=node。');
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
            cautions.push('纯浏览器拓扑下服务端进程不进入 local-static；需要 API/SSR 请改选「请求时 SSR」或开启密钥边界。');
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
        cautions.push('已选服务端进程且 HTML 预生成：按 server-host 组装；分机请把资源选为 CDN。');
        return {
            recipeId: 'web-ssr',
            profileId: 'web-ssr',
            assembly: 'server-host',
            serverRuntime: mapServerRuntime(server),
        };
    }
    return {
        recipeId: 'web-static',
        profileId: 'web-static',
        assembly: 'static-cdn',
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
            '        // sources: defineSite({ ... }) — 见 recipes#rust-embedded',
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
    } else {
        lines.push(`      '${pick.profileId}': { host: 'browser', assembly: '${pick.assembly}' },`);
    }

    lines.push(
        '    },',
        '    // 可选机器面：agent 可写出 deploy.plan.json 供 vmz deploy --plan；人手勿手抄 JSON',
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
    const shipNote = answers.ship === 'git-ci' ? 'ship=git-ci：deploy 配 CI，push 才发布' : 'ship=direct-upload：deploy 本机直传';

    for (const v of answers.vendors) {
        if (v === 'cloudflare-pages') {
            adapters.push({ kind: 'cloudflare-pages', note: `${shipNote}；勿 SPA fallback` });
        } else if (v === 'github-pages') {
            adapters.push({ kind: 'github-pages', note: shipNote });
        } else if (v === 'vercel') {
            adapters.push({ kind: 'vercel', note: shipNote });
        } else if (v === 'netlify') {
            adapters.push({ kind: 'netlify', note: shipNote });
        } else if (v === 'tencent-edgeone') {
            adapters.push({ kind: 'tencent-edgeone', note: `${shipNote}；CLI 以腾讯文档为准` });
        } else if (v === 'cloudflare-workers') {
            adapters.push({ kind: 'cloudflare-workers', note: 'bindings 仅名' });
        } else if (v === 's3-cloudfront') {
            adapters.push({ kind: 's3-cloudfront', note: '默认可按 direct-upload 理解' });
        } else if (v === 'node-vps') {
            adapters.push({ kind: 'node-vps', note: 'filesystem-release / CURRENT' });
        } else if (v === 'rust-bin') {
            adapters.push({ kind: 'rust-bin', note: '嵌入基线 + 远程整包' });
        }
    }

    if (adapters.length === 0) {
        if (pick.assembly === 'server-host' || pick.assembly === 'rust-embedded') {
            adapters.push({ kind: 'filesystem-release', note: '本地 release 指针' });
        } else {
            adapters.push({ kind: 'filesystem-release', note: '无外部平台时默认本地 release' });
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
            ? `凭证/标识 env 名（无值）：${requiredEnv.join(', ')}`
            : '公开 env：如 VMZ_SITE_ORIGIN；禁止把 secret 写入静态产物';
    const cmd = buildCmd(pick.profileId);
    const pub = publishDirNote(pick.profileId);
    const ship = answers.ship;
    const naCi = '当前 ship=direct-upload：不配 Git CI；若要流水线请改选「Git CI」。';
    const naUp = '当前 ship=git-ci：不在本机上传；若要直传请改选「本机直传」。';

    for (const v of answers.vendors) {
        if (v === 'cloudflare-pages') {
            steps.push(
                axisStep(
                    v,
                    'Cloudflare Pages',
                    'cloudflare-pages',
                    ['项目名；域名 / HTTPS', ship === 'git-ci' ? '生产分支（push 触发）' : '可不绑 Git', cmd, pub],
                    ship === 'git-ci'
                        ? [
                              'vmz deploy：写 Actions + 登记 CF_* secrets 名',
                              '管理 key：默认 .env.secrets*；advice 建议 --secret NAME=VALUE 一次性',
                              'workflow 内 wrangler pages deploy',
                              '然后手动 git push',
                              envList,
                          ]
                        : [naCi],
                    ship === 'direct-upload'
                        ? ['vmz deploy：本机 check/build + wrangler/API 直传', 'token：默认 .env.secrets* 或 --secret', envList]
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
                        ship === 'git-ci' ? 'Pages source = Actions' : 'Pages 接受 artifact / gh-pages',
                        '自定义域名；base path 对齐 VMZ_SITE_ORIGIN',
                        cmd,
                        pub,
                    ],
                    ship === 'git-ci'
                        ? ['vmz deploy：写 workflow（OIDC）', '管理 key：默认 .env.secrets*；advice 建议 --secret 一次性', '然后手动 git push']
                        : [naCi],
                    ship === 'direct-upload' ? ['vmz deploy：本机上传（GH_TOKEN）；默认 secrets 文件或 --secret', envList] : [naUp],
                ),
            );
        }
        if (v === 'vercel') {
            steps.push(
                axisStep(
                    v,
                    'Vercel',
                    'vercel',
                    ['Framework=Other；Output Directory；域名', cmd, pub],
                    ship === 'git-ci'
                        ? [
                              'vmz deploy：写 workflow + 登记 VERCEL_*',
                              '管理 key：默认 .env.secrets*；advice 建议 --secret 一次性',
                              '然后手动 git push',
                              envList,
                          ]
                        : [naCi],
                    ship === 'direct-upload'
                        ? ['vmz deploy：vercel deploy --prebuilt --prod', 'token：默认 .env.secrets* 或 --secret', envList]
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
                    ['Publish directory；域名', cmd, pub],
                    ship === 'git-ci'
                        ? [
                              'vmz deploy：登记 NETLIFY_*',
                              '管理 key：默认 .env.secrets*；advice 建议 --secret 一次性',
                              '然后手动 git push',
                              envList,
                          ]
                        : [naCi],
                    ship === 'direct-upload'
                        ? ['vmz deploy：netlify deploy --prod --dir=<publish>', 'token：默认 .env.secrets* 或 --secret', envList]
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
                    ['站点 / 加速域名；证书', cmd, pub],
                    ship === 'git-ci'
                        ? [
                              'vmz deploy：登记 TENCENTCLOUD_* + EDGEONE_*',
                              '管理 key：默认 .env.secrets*；advice 建议 --secret 一次性',
                              '然后手动 git push',
                              'CLI 以腾讯文档为准',
                              envList,
                          ]
                        : [naCi],
                    ship === 'direct-upload'
                        ? ['vmz deploy：本机直传；CLI 以腾讯文档为准', 'token：默认 .env.secrets* 或 --secret', envList]
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
                        '脚本名 / 入口；Bindings 仅名',
                        answers.vendors.includes('cloudflare-pages') ? '与 Pages：静态壳 vs SSR/RPC' : '若仅 Worker：确认 HTML 来源',
                    ],
                    [envList],
                    ['本地 wrangler / vmz deploy', envList],
                ),
            );
        }
        if (v === 's3-cloudfront') {
            steps.push(
                axisStep(v, 'S3 + CloudFront', 's3-cloudfront', ['Bucket、区域、Distribution ID', pub], ['CI runner 亦可 sync'], [envList]),
            );
        }
        if (v === 'node-vps') {
            steps.push(
                axisStep(
                    v,
                    'Node VPS',
                    'node-vps',
                    ['发布目录 / CURRENT；PORT', '反向代理仅转发'],
                    ['可选自建 runner'],
                    [envList, 'filesystem-release'],
                ),
            );
        }
        if (v === 'rust-bin') {
            steps.push(axisStep(v, 'Rust binary', 'rust-bin', ['嵌入 artifact；UPDATE_BASE_URL 仅名'], ['可选 CI 打 release'], [envList]));
        }
    }

    if (steps.length === 0) {
        steps.push(
            axisStep('local', 'local', 'filesystem-release', [cmd, '无外部平台'], ship === 'git-ci' ? ['可先选平台再配 CI'] : ['无'], [
                'vmz deploy（filesystem-release）',
                '工作区根 .env.secrets* 仅本地',
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
            : '（未选外部平台 → filesystem-release / 本地）';

    const envLine = requiredEnv.length > 0 ? requiredEnv.join(', ') : '（无额外发布 token 名；公开 env 如 VMZ_SITE_ORIGIN 按需）';

    const shipBlock =
        ship === 'git-ci'
            ? [
                  '发布方式 **git-ci**：',
                  '- 只配 CI 工作流 + 登记 secrets **名**；**禁止**在作者机上 publish 并宣称已上线',
                  '- 作者随后 **手动 `git push`**，由 CI 执行 check/build/publish',
                  '- 管理 key：默认可读 `.env.secrets*`；更建议 `vmz deploy --secret NAME=VALUE` 一次性（不写盘、不进 report）',
              ].join('\n')
            : [
                  '发布方式 **direct-upload**：',
                  '- 本机 `vmz check` → `vmz build` → adapter 直传',
                  '- token 默认可读 `.env.secrets*`，也可用 `--secret NAME=VALUE` 一次性',
              ].join('\n');

    const cautionBlock = cautions.length > 0 ? ['## 选型警告（不是 check 诊断）', '', bullet(cautions)].join('\n') : '## 选型警告\n\n- （无）';

    const stepsBlock = externalSteps.map(formatStepBlock).join('\n\n');

    const linksBlock = bullet(deepLinks.map((l) => `${l.label}：${l.href}`));

    return [
        '# VMZ 部署落地任务（由 /deploy-planner 生成）',
        '',
        disclaimer,
        '',
        '你是本仓库的编码助手。根据下列合同**改配置、写脚手架、准备发布**；完成后跑验证命令。不要发明第二套路由/MIME/SPA fallback 语义；厂商 `_headers` / `vercel.json` rewrites 等不是 VMZ 真相源。',
        '',
        '## 拓扑结论',
        '',
        bullet([
            `recipe：${pick.recipeId}`,
            `profile：${pick.profileId}`,
            `assembly：${pick.assembly}`,
            ...(pick.serverRuntime ? [`serverRuntime：${pick.serverRuntime}`] : []),
            `ship：${ship}`,
            `平台 adapters：${platformLine}`,
            `requiredEnv（仅名）：${envLine}`,
        ]),
        '',
        '## 硬约束',
        '',
        shipBlock,
        '',
        bullet([
            '密钥值永不写入 `vmz.config.ts`、Web 产物、Resume、日志、workflow、DeployPlan 正文',
            '可行性只认 `vmz check` / `vmz build`；本提示词不是上线证明',
            '若需要机器可读 DeployPlan 供 `vmz deploy --plan`，由你生成文件——**不要**让用户手抄 JSON',
            '未安装对应 `@vmz/plugin-deploy-*` 时失败并提示安装，不得静默跳过',
        ]),
        '',
        '## 请你完成',
        '',
        '1. 合并/写入 `vmz.config.ts` 的 `delivery`（意图如下；按仓库既有 `defineConfig` 风格改，勿平行 `vmz.site.ts`）。',
        '2. 按 `ship` 准备 `vmz deploy`：git-ci → 脚手架 CI + 登记 secrets 名；direct-upload → 本机直传路径。',
        '3. 按下方「外部填写清单」核对控制台字段（只填名与路径类信息）。',
        '4. 运行建议命令；缺绑定只报名、不回显值；git-ci 结束后明确「请手动 git push」。',
        '',
        '### delivery 意图（参考形状）',
        '',
        '```ts',
        vmzConfigSnippet.trimEnd(),
        '```',
        '',
        '### 建议命令',
        '',
        bullet(commandsSuggested),
        '',
        '## 外部填写清单',
        '',
        stepsBlock,
        '',
        cautionBlock,
        '',
        '## 深链',
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
            `vmz deploy [--secret NAME=VALUE]…   # git-ci：默认读 .env.secrets*；管理 key 建议一次性 --secret；不本机发布`,
            `git push   # 之后由 CI check/build/publish`,
        );
    } else {
        commandsSuggested.push(`vmz deploy [--secret NAME=VALUE]…   # direct-upload：默认读 .env.secrets*；也可一次性传参`);
    }

  const deepHref = RECIPE_DOCS[pick.recipeId] ?? `${DEPLOY_GUIDE}/recipes`;
  const deepLinks = [
    { label: '部署指南', href: `${DEPLOY_GUIDE}/` },
    { label: `配方 ${pick.recipeId}`, href: deepHref },
    { label: '密钥与环境变量', href: `${DEPLOY_GUIDE}/secrets-env` },
    { label: 'vmz deploy', href: `${DEPLOY_GUIDE}/cli` },
  ];
  if (hasStaticVendor(answers.vendors) || pick.assembly === 'static-cdn') {
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
