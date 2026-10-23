/** Deploy planner copy: decision-table cautions, external checklists, agent prompt.
 *
 * Chinese values mirror the original contract. English values are the same
 * meaning, written for the author reading the page in en-US.
 *
 * `{{name}}` placeholders are filled by `planner.ts` ({{cmd}}, {{publishDir}},
 * {{env}}, {{branch}}, {{githubSource}}, {{pagesSplit}}, {{profile}}, {{id}}).
 */

export type PlannerLocale = 'zh-hans' | 'en-us';

export type PlannerCautionId =
    | 'embeddedSecrets'
    | 'embeddedBrowserOnly'
    | 'secretsNeedServer'
    | 'secretsStaticVendor'
    | 'staticServerScripts'
    | 'staticServerScriptsStrict'
    | 'staticCannotSsr'
    | 'ssrNeedsServer'
    | 'browserOnlyNoServer'
    | 'prebuildWithServer';

export type PlannerAdapterNoteId =
    | 'pagesNoSpa'
    | 'edgeoneCli'
    | 'workerBindings'
    | 's3Local'
    | 'nodeCurrent'
    | 'rustEmbedded'
    | 'filesystemSwitch'
    | 'filesystemDefault';

export type VendorStepCopy = {
    title: string;
    console: string[];
    ci: string[];
    upload: string[];
};

export type PlannerCopy = {
    /** Separator for inline name lists (env vars, adapters). */
    listSeparator: string;
    /** Label colon for doc links, e.g. `Deploy guide: /d/en-us/...`. */
    labelColon: string;
    /** Adapter line, `{{id}}` + optional `{{note}}`. */
    adapterLine: string;
    adapterLineWithNote: string;
    disclaimer: string;
    shipCautions: { gitCi: [string, string]; directUpload: string };
    publishDir: string;
    buildCmd: string;
    cautions: Record<PlannerCautionId, string>;
    snippet: { sources: string; plan: string };
    shipNotes: { gitCi: string; directUpload: string };
    adapterNotes: Record<PlannerAdapterNoteId, string>;
    steps: {
        envList: string;
        envEmpty: string;
        naCi: string;
        naUp: string;
        heading: string;
        axes: { console: string; ci: string; local: string };
        tokens: {
            consoleBranchCi: string;
            consoleBranchUpload: string;
            githubSourceCi: string;
            githubSourceUpload: string;
            pagesSplit: string;
            pagesAlone: string;
        };
        vendors: Record<string, VendorStepCopy>;
        local: VendorStepCopy;
    };
    prompt: {
        title: string;
        intro: string;
        platformEmpty: string;
        envEmpty: string;
        shipGitCi: string;
        shipUpload: string;
        headings: {
            topology: string;
            constraints: string;
            tasks: string;
            delivery: string;
            commands: string;
            external: string;
            cautions: string;
            docs: string;
        };
        topologyLabels: {
            recipe: string;
            profile: string;
            assembly: string;
            serverRuntime: string;
            ship: string;
            adapters: string;
            env: string;
        };
        constraints: string[];
        tasks: string[];
        cautionsNone: string;
    };
    commands: { ci: string; ciPush: string; upload: string };
    links: {
        guide: string;
        recipe: string;
        secrets: string;
        cli: string;
        staticHosts: string;
        recipeAnchors: Record<string, string>;
    };
    labels: {
        profiles: Record<string, string>;
        assemblies: Record<string, string>;
        runtimes: Record<string, string>;
        customProfile: string;
        customAssembly: string;
        customRuntime: string;
        none: string;
        shipGitCi: string;
        shipUpload: string;
    };
};

const ZH: PlannerCopy = {
    listSeparator: '、',
    labelColon: '：',
    adapterLine: '{{id}}',
    adapterLineWithNote: '{{id}}（{{note}}）',
    disclaimer:
        '这份提示词只描述配置怎么落地，不代表项目已经通过 vmz check 或 vmz build。请把它交给编码助手完成脚手架与配置；能否上线以两条命令的实际结果为准。提示词里只有环境变量名，不含任何密钥值。',
    shipCautions: {
        gitCi: [
            '发布方式为 Git CI：vmz deploy 只生成流水线与密钥名，真正上线由你手动 git push 触发。',
            '管理密钥默认可从 .env.secrets* 读取；接入 CI 时建议用 --secret NAME=VALUE 一次性传入，既不落盘也不写进报告。',
        ],
        directUpload:
            '发布方式为本机直传：适合私有仓库或托管方没有接入 Git 的场景；令牌默认可从 .env.secrets* 读取，也可用 --secret 一次性传入。',
    },
    publishDir: '发布目录：以静态交付清单为准，通常是 dist（当前 profile 为 {{profile}}）',
    buildCmd: '构建命令：vmz build --release --profile {{profile}}',
    cautions: {
        embeddedSecrets: '把资源嵌入二进制后，密钥仍必须由可信宿主进程持有：只按环境变量名绑定，不得写入嵌入产物。',
        embeddedBrowserOnly: '已选择嵌入或整包更新，按面板嵌入配方出包；纯浏览器拓扑不适用于这种交付方式。',
        secretsNeedServer: '既然密钥必须留在服务端，生产环境就不能只用纯静态托管；这里已改选带可信服务端的配方。',
        secretsStaticVendor: '所选静态平台只能承载公开外壳；密钥相关请求需要另配可信服务端，或重新考虑密钥边界。',
        staticServerScripts: '已选择纯静态托管：源码里可以有服务端脚本，但这个 profile 只交付能静态证明的部分。',
        staticServerScriptsStrict:
            '已选择纯静态托管：源码里可以有服务端脚本，依赖运行时服务端或 secret() 的路由请以 check / build 结果为准。',
        staticCannotSsr: '静态托管无法按请求生成 HTML：要么改用混合或服务端配方，要么把首屏改成 CDN 预生成。',
        ssrNeedsServer: '请求时 SSR 需要服务端进程，这里默认使用 Node 运行时。',
        browserOnlyNoServer: '纯浏览器拓扑不包含服务端进程；需要接口或 SSR 时，请改选「请求时 SSR」并明确密钥边界。',
        prebuildWithServer:
            '首屏预生成又有服务端进程时，按单机全栈组装；如果服务端部署在另一台机器，请把静态资源改选为 CDN。',
    },
    snippet: {
        sources: '        // sources: defineSite({ ... }) — 详见 recipes#rust-embedded',
        plan: '    // 可选机器可读配置：由编码助手生成 deploy.plan.json 供 vmz deploy --plan 使用，无需手工抄写',
    },
    shipNotes: {
        gitCi: '由 CI 发布，push 后自动执行',
        directUpload: '本机直接上传，不经过 CI',
    },
    adapterNotes: {
        pagesNoSpa: '；不要配置 SPA 回退',
        edgeoneCli: '；CLI 参数以腾讯云文档为准',
        workerBindings: '绑定只登记变量名，不写入值',
        s3Local: '默认按本机直传处理',
        nodeCurrent: '发布目录配合 CURRENT 指针切换',
        rustEmbedded: '嵌入基线，配合远程整包更新',
        filesystemSwitch: '本机 release 目录切换',
        filesystemDefault: '未选外部平台时默认使用本机 release 目录',
    },
    steps: {
        envList: '需要准备的环境变量名（只登记名称）：{{names}}',
        envEmpty: '公开环境变量即可，例如 VMZ_SITE_ORIGIN；不要把密钥写进静态产物',
        naCi: '当前选择本机直传，不生成 CI 流水线；需要流水线时改选「Git CI」。',
        naUp: '当前选择 Git CI，不在本机上传；需要本机直传时改选「本机直传」。',
        heading: '### {{title}}（{{vendor}}）',
        axes: { console: '控制台：', ci: 'Git CI：', local: '本机直传：' },
        tokens: {
            consoleBranchCi: '生产分支，push 后触发构建',
            consoleBranchUpload: '可以不绑定 Git 仓库',
            githubSourceCi: 'Pages 来源设为 Actions',
            githubSourceUpload: 'Pages 接受 artifact 或 gh-pages 分支',
            pagesSplit: '与 Pages 分工：静态外壳交给 Pages，接口交给 Worker',
            pagesAlone: '只用 Worker 时先确认首屏 HTML 来源',
        },
        vendors: {
            'cloudflare-pages': {
                title: 'Cloudflare Pages',
                console: ['项目名；绑定域名与 HTTPS', '{{branch}}', '{{cmd}}', '{{publishDir}}'],
                ci: [
                    '运行 vmz deploy 生成 Actions 工作流，并登记 CF_* 变量名',
                    '密钥默认可从 .env.secrets* 读取；CI 场景建议 --secret NAME=VALUE 一次性传入',
                    '工作流内执行 wrangler pages deploy',
                    '完成后手动 git push',
                    '{{env}}',
                ],
                upload: [
                    '运行 vmz deploy：本机 check / build 后通过 wrangler 或 API 直传',
                    '令牌默认可从 .env.secrets* 读取，或用 --secret 传入',
                    '{{env}}',
                ],
            },
            'github-pages': {
                title: 'GitHub Pages',
                console: ['{{githubSource}}', '自定义域名；base path 与 VMZ_SITE_ORIGIN 保持一致', '{{cmd}}', '{{publishDir}}'],
                ci: [
                    '运行 vmz deploy 生成工作流（OIDC 授权）',
                    '密钥默认可从 .env.secrets* 读取，或用 --secret 一次性传入',
                    '完成后手动 git push',
                ],
                upload: ['运行 vmz deploy 从本机上传（GH_TOKEN）；令牌来自 secrets 文件或 --secret', '{{env}}'],
            },
            vercel: {
                title: 'Vercel',
                console: ['Framework 选 Other；确认 Output Directory 与域名', '{{cmd}}', '{{publishDir}}'],
                ci: [
                    '运行 vmz deploy 生成工作流，并登记 VERCEL_* 变量名',
                    '密钥默认可从 .env.secrets* 读取，或用 --secret 一次性传入',
                    '完成后手动 git push',
                    '{{env}}',
                ],
                upload: ['运行 vmz deploy：vercel deploy --prebuilt --prod', '令牌默认可从 .env.secrets* 读取，或用 --secret 传入', '{{env}}'],
            },
            netlify: {
                title: 'Netlify',
                console: ['确认 Publish directory 与域名', '{{cmd}}', '{{publishDir}}'],
                ci: [
                    '运行 vmz deploy 登记 NETLIFY_* 变量名',
                    '密钥默认可从 .env.secrets* 读取，或用 --secret 一次性传入',
                    '完成后手动 git push',
                    '{{env}}',
                ],
                upload: ['运行 vmz deploy：netlify deploy --prod --dir=<publish>', '令牌默认可从 .env.secrets* 读取，或用 --secret 传入', '{{env}}'],
            },
            'tencent-edgeone': {
                title: '腾讯 EdgeOne',
                console: ['站点与加速域名；上传证书', '{{cmd}}', '{{publishDir}}'],
                ci: [
                    '运行 vmz deploy 登记 TENCENTCLOUD_* 与 EDGEONE_* 变量名',
                    '密钥默认可从 .env.secrets* 读取，或用 --secret 一次性传入',
                    '完成后手动 git push',
                    'CLI 参数以腾讯云文档为准',
                    '{{env}}',
                ],
                upload: ['运行 vmz deploy 从本机直传；CLI 参数以腾讯云文档为准', '令牌默认可从 .env.secrets* 读取，或用 --secret 传入', '{{env}}'],
            },
            'cloudflare-workers': {
                title: 'Cloudflare Workers',
                console: ['脚本名与入口；绑定只登记变量名', '{{pagesSplit}}'],
                ci: ['{{env}}'],
                upload: ['本机 wrangler 或 vmz deploy 发布', '{{env}}'],
            },
            's3-cloudfront': {
                title: 'S3 + CloudFront',
                console: ['Bucket、区域与 Distribution ID', '{{publishDir}}'],
                ci: ['也可以在 CI runner 内同步'],
                upload: ['{{env}}'],
            },
            'node-vps': {
                title: 'Node VPS',
                console: ['发布目录与 CURRENT 指针；确认 PORT', '反向代理只做转发，不改写路由'],
                ci: ['可选：自建 runner'],
                upload: ['{{env}}', '本机 release 目录切换'],
            },
            'rust-bin': {
                title: 'Rust binary',
                console: ['嵌入构建产物；只登记 UPDATE_BASE_URL 变量名'],
                ci: ['也可以在 CI 里打包 release'],
                upload: ['{{env}}'],
            },
        },
        local: {
            title: 'filesystem-release',
            console: ['{{cmd}}', '未选择外部平台'],
            ci: ['可以先选平台，再配 CI'],
            upload: ['运行 vmz deploy 走本机 release 目录', '项目根目录的 .env.secrets* 仅在本机使用'],
        },
    },
    prompt: {
        title: '# VMZ 部署落地任务（由 /deploy-planner 生成）',
        intro: '你是这个仓库的编码助手。请按下面的结论修改配置、补齐脚手架并准备发布，最后运行验证命令。不要另造一套路由、MIME 或 SPA 回退规则；厂商侧的 `_headers`、`vercel.json` rewrites 都不是 VMZ 的事实来源。',
        platformEmpty: '未选择外部平台，使用本机 release 目录',
        envEmpty: '无需额外发布变量；公开变量如 VMZ_SITE_ORIGIN 按需配置',
        shipGitCi: [
            '发布方式为 **git-ci**：',
            '- 只生成 CI 工作流并登记密钥名；不要在作者机器上直接发布并声称已上线',
            '- 作者随后手动 `git push`，由 CI 完成 check、build 与发布',
            '- 密钥默认可从 `.env.secrets*` 读取；更推荐用 `vmz deploy --secret NAME=VALUE` 一次性传入，既不落盘也不写进报告',
        ].join('\n'),
        shipUpload: [
            '发布方式为 **direct-upload**：',
            '- 本机依次执行 `vmz check`、`vmz build`，再由 adapter 直传',
            '- 令牌默认可从 `.env.secrets*` 读取，也可以用 `--secret NAME=VALUE` 一次性传入',
        ].join('\n'),
        headings: {
            topology: '## 拓扑结论',
            constraints: '## 硬约束',
            tasks: '## 请你完成',
            delivery: '### delivery 配置（参考形状）',
            commands: '### 建议命令',
            external: '## 外部平台清单',
            cautions: '## 选型提醒（与 check 诊断无关）',
            docs: '## 相关文档',
        },
        topologyLabels: {
            recipe: '配方',
            profile: 'profile',
            assembly: '组装方式',
            serverRuntime: '服务端运行时',
            ship: '发布方式',
            adapters: '平台 adapter',
            env: '所需环境变量（只有名称）',
        },
        constraints: [
            '密钥值不得写进 `vmz.config.ts`、Web 产物、报告、日志、工作流或本计划正文',
            '能否上线只认 `vmz check` 与 `vmz build` 的结果；这份提示词不构成上线证明',
            '如果 `vmz deploy --plan` 需要机器可读的 DeployPlan，由你生成文件，不要让用户手抄 JSON',
            '缺少对应的 `@vmz/plugin-deploy-*` 时应当报错并提示安装，不得静默跳过',
        ],
        tasks: [
            '1. 合并或写入 `vmz.config.ts` 的 `delivery` 配置（形状见下）；沿用仓库已有的 `defineConfig` 风格，不要另建 `vmz.site.ts`。',
            '2. 按发布方式准备 `vmz deploy`：git-ci 生成 CI 工作流并登记密钥名；direct-upload 走本机直传路径。',
            '3. 对照下方「外部平台清单」核对控制台字段，只填名称与路径类信息。',
            '4. 运行建议命令；缺少绑定只报告变量名，不回显值；git-ci 结束后明确提示用户手动 git push。',
        ],
        cautionsNone: '无',
    },
    commands: {
        ci: '   # git-ci：默认读 .env.secrets*；管理密钥建议一次性传入；不在本机发布',
        ciPush: '   # 之后由 CI 完成 check、build 与发布',
        upload: '   # direct-upload：默认读 .env.secrets*；也可以一次性传参',
    },
    links: {
        guide: '部署指南',
        recipe: '配方 {{id}}',
        secrets: '密钥与环境变量',
        cli: 'vmz deploy',
        staticHosts: '纯静态平台填写清单',
        recipeAnchors: {
            static: 'static-只有-cdn-对象存储',
            'web-ssr': 'web-ssr-单机全栈默认',
            'web-hybrid': 'web-hybrid-cdn-独立服务端',
            'web-client': 'web-client-纯前端-本地盘',
            'panel-embedded': 'rust-embedded-嵌入基线-整包回退',
        },
    },
    labels: {
        profiles: {
            static: '纯静态托管',
            'web-ssr': '单机全栈',
            'web-hybrid': 'CDN + 独立服务端',
            'web-client': '纯前端 + 本机静态',
            'panel-embedded': '面板嵌入（基线 + 整包回退）',
        },
        assemblies: {
            'web-static': '静态托管',
            'server-host': '单机服务端',
            'cdn+server': 'CDN + 服务端',
            'local-static': '本机静态',
            'rust-embedded': 'Rust 嵌入',
        },
        runtimes: { node: 'Node', worker: 'Worker', 'rust-host': 'Rust 宿主' },
        customProfile: '自定义配方',
        customAssembly: '自定义组装',
        customRuntime: '自定义运行时',
        none: '（无）',
        shipGitCi: 'Git CI 发布',
        shipUpload: '本机直传',
    },
};

const EN: PlannerCopy = {
    listSeparator: ', ',
    labelColon: ': ',
    adapterLine: '{{id}}',
    adapterLineWithNote: '{{id}} ({{note}})',
    disclaimer:
        'This prompt only describes how the configuration lands. It does not mean the project passes `vmz check` or `vmz build`. Hand it to a coding agent to scaffold and configure the repo. Shipping is decided by the actual result of those two commands. The prompt lists environment variable names only and never contains secret values.',
    shipCautions: {
        gitCi: [
            'Shipping mode is Git CI: `vmz deploy` only generates the pipeline and secret names. Publishing is triggered by your own `git push`.',
            'Managed secrets default to `.env.secrets*`. For CI, prefer passing them once with `--secret NAME=VALUE`, so nothing is written to disk or the report.',
        ],
        directUpload:
            'Shipping mode is direct upload: suited to private repos or hosts without Git integration. Tokens default to `.env.secrets*` and can also be passed once with `--secret`.',
    },
    publishDir: 'Publish directory: follow the static delivery manifest, usually dist (current profile {{profile}})',
    buildCmd: 'Build command: vmz build --release --profile {{profile}}',
    cautions: {
        embeddedSecrets:
            'Once assets are embedded in the binary, secrets must stay with a trusted host process. Bind by environment variable name only and never write values into the embedded artifact.',
        embeddedBrowserOnly:
            'Embedded assets or whole-package updates ship through the panel-embedded recipe. A browser-only topology does not apply to this delivery mode.',
        secretsNeedServer:
            'Secrets must stay on the server, so production cannot be static-only. This plan switched to a recipe with a trusted server.',
        secretsStaticVendor:
            'The selected static platform can host the public shell only. Requests that touch secrets need a separate trusted server, or a different secret boundary.',
        staticServerScripts:
            'Static hosting selected: server scripts may exist in the source, but this profile only ships the part that can be proven static.',
        staticServerScriptsStrict:
            'Static hosting selected: server scripts may exist in the source. Routes that depend on a runtime server or `secret()` follow the check / build result.',
        staticCannotSsr:
            'Static hosting cannot render HTML per request. Move to the hybrid or server recipe, or make the first screen CDN-prebuild.',
        ssrNeedsServer: 'Request-time SSR needs a server process, so this plan uses the Node runtime by default.',
        browserOnlyNoServer:
            'A browser-only topology has no server process. If you need APIs or SSR, choose request-time SSR and define the secret boundary.',
        prebuildWithServer:
            'Pregenerated HTML plus a server process maps to the single-host full-stack assembly. If the server lives on another machine, switch static assets to CDN.',
    },
    snippet: {
        sources: '        // sources: defineSite({ ... }) — see recipes#rust-embedded',
        plan: '    // Optional machine-readable config: let the coding agent generate deploy.plan.json for vmz deploy --plan. Never hand-copy it',
    },
    shipNotes: {
        gitCi: 'Published by CI, runs after a push',
        directUpload: 'Uploaded from this machine, no CI involved',
    },
    adapterNotes: {
        pagesNoSpa: '; do not configure SPA fallback',
        edgeoneCli: '; CLI flags follow the Tencent Cloud docs',
        workerBindings: 'Bindings register variable names only, never values',
        s3Local: 'Treated as direct upload by default',
        nodeCurrent: 'Switch releases through the CURRENT pointer',
        rustEmbedded: 'Embedded baseline with remote whole-package updates',
        filesystemSwitch: 'Switch the local release directory',
        filesystemDefault: 'Default local release directory when no external platform is selected',
    },
    steps: {
        envList: 'Environment variable names to prepare (names only): {{names}}',
        envEmpty: 'Public variables only, for example VMZ_SITE_ORIGIN. Never write secrets into static artifacts.',
        naCi: 'Direct upload is selected, so no CI pipeline is generated. Choose Git CI when you need one.',
        naUp: 'Git CI is selected, so nothing is uploaded from this machine. Choose direct upload when you need it.',
        heading: '### {{title}} ({{vendor}})',
        axes: { console: 'Console:', ci: 'Git CI:', local: 'Direct upload:' },
        tokens: {
            consoleBranchCi: 'Production branch, builds on push',
            consoleBranchUpload: 'No Git repo needed',
            githubSourceCi: 'Pages source set to Actions',
            githubSourceUpload: 'Pages accepts an artifact or the gh-pages branch',
            pagesSplit: 'Split with Pages: Pages serves the static shell, the Worker serves the API',
            pagesAlone: 'With Worker only, confirm where the first HTML comes from',
        },
        vendors: {
            'cloudflare-pages': {
                title: 'Cloudflare Pages',
                console: ['Project name, domain binding, and HTTPS', '{{branch}}', '{{cmd}}', '{{publishDir}}'],
                ci: [
                    'Run vmz deploy to generate the Actions workflow and register the CF_* variable names',
                    'Secrets default to .env.secrets*. In CI, prefer passing them once with --secret NAME=VALUE',
                    'The workflow runs wrangler pages deploy',
                    'Push manually when the change is ready',
                    '{{env}}',
                ],
                upload: [
                    'Run vmz deploy: local check and build, then upload through wrangler or the API',
                    'Tokens default to .env.secrets* or can be passed with --secret',
                    '{{env}}',
                ],
            },
            'github-pages': {
                title: 'GitHub Pages',
                console: ['{{githubSource}}', 'Custom domain; keep the base path in sync with VMZ_SITE_ORIGIN', '{{cmd}}', '{{publishDir}}'],
                ci: [
                    'Run vmz deploy to generate the workflow (OIDC authorization)',
                    'Secrets default to .env.secrets* or can be passed once with --secret',
                    'Push manually when the change is ready',
                ],
                upload: ['Run vmz deploy to upload from this machine (GH_TOKEN). The token comes from a secrets file or --secret', '{{env}}'],
            },
            vercel: {
                title: 'Vercel',
                console: ['Framework: Other. Confirm the Output Directory and domain', '{{cmd}}', '{{publishDir}}'],
                ci: [
                    'Run vmz deploy to generate the workflow and register the VERCEL_* variable names',
                    'Secrets default to .env.secrets* or can be passed once with --secret',
                    'Push manually when the change is ready',
                    '{{env}}',
                ],
                upload: [
                    'Run vmz deploy: vercel deploy --prebuilt --prod',
                    'Tokens default to .env.secrets* or can be passed with --secret',
                    '{{env}}',
                ],
            },
            netlify: {
                title: 'Netlify',
                console: ['Confirm the publish directory and domain', '{{cmd}}', '{{publishDir}}'],
                ci: [
                    'Run vmz deploy to register the NETLIFY_* variable names',
                    'Secrets default to .env.secrets* or can be passed once with --secret',
                    'Push manually when the change is ready',
                    '{{env}}',
                ],
                upload: [
                    'Run vmz deploy: netlify deploy --prod --dir=<publish>',
                    'Tokens default to .env.secrets* or can be passed with --secret',
                    '{{env}}',
                ],
            },
            'tencent-edgeone': {
                title: 'Tencent EdgeOne',
                console: ['Site and acceleration domain; upload the certificate', '{{cmd}}', '{{publishDir}}'],
                ci: [
                    'Run vmz deploy to register the TENCENTCLOUD_* and EDGEONE_* variable names',
                    'Secrets default to .env.secrets* or can be passed once with --secret',
                    'Push manually when the change is ready',
                    'CLI flags follow the Tencent Cloud docs',
                    '{{env}}',
                ],
                upload: [
                    'Run vmz deploy to upload from this machine. CLI flags follow the Tencent Cloud docs',
                    'Tokens default to .env.secrets* or can be passed with --secret',
                    '{{env}}',
                ],
            },
            'cloudflare-workers': {
                title: 'Cloudflare Workers',
                console: ['Script name and entry; bindings register variable names only', '{{pagesSplit}}'],
                ci: ['{{env}}'],
                upload: ['Publish with local wrangler or vmz deploy', '{{env}}'],
            },
            's3-cloudfront': {
                title: 'S3 + CloudFront',
                console: ['Bucket, region, and Distribution ID', '{{publishDir}}'],
                ci: ['Can also sync inside a CI runner'],
                upload: ['{{env}}'],
            },
            'node-vps': {
                title: 'Node VPS',
                console: ['Release directory and CURRENT pointer; confirm PORT', 'The reverse proxy forwards only, never rewrites routes'],
                ci: ['Optional: self-hosted runner'],
                upload: ['{{env}}', 'Switch the local release directory'],
            },
            'rust-bin': {
                title: 'Rust binary',
                console: ['Embedded build artifacts; register the UPDATE_BASE_URL variable name only'],
                ci: ['Can also package a release in CI'],
                upload: ['{{env}}'],
            },
        },
        local: {
            title: 'filesystem-release',
            console: ['{{cmd}}', 'No external platform selected'],
            ci: ['Choose a platform first, then configure CI'],
            upload: ['Run vmz deploy against the local release directory', '`.env.secrets*` at the project root stays on this machine only'],
        },
    },
    prompt: {
        title: '# VMZ deployment task (generated by /deploy-planner)',
        intro: 'You are the coding agent for this repository. Apply the conclusions below, fill in the scaffolding, prepare the release, and run the verification commands at the end. Do not invent a second router, MIME table, or SPA fallback. Vendor-side `_headers` and `vercel.json` rewrites are not the source of truth for VMZ.',
        platformEmpty: 'No external platform selected; use the local release directory',
        envEmpty: 'No extra release variables; add public ones such as VMZ_SITE_ORIGIN when needed',
        shipGitCi: [
            'Shipping mode is **git-ci**:',
            '- Generate the CI workflow and register secret names only. Never publish from the author machine and call it live',
            '- The author then runs `git push`, and CI performs check, build, and publish',
            '- Secrets default to `.env.secrets*`. Prefer `vmz deploy --secret NAME=VALUE` for a one-shot pass that stays off disk and out of the report',
        ].join('\n'),
        shipUpload: [
            'Shipping mode is **direct-upload**:',
            '- Run `vmz check` and `vmz build` on this machine, then let the adapter upload',
            '- Tokens default to `.env.secrets*`, or pass them once with `--secret NAME=VALUE`',
        ].join('\n'),
        headings: {
            topology: '## Topology',
            constraints: '## Hard constraints',
            tasks: '## What to do',
            delivery: '### delivery config (reference shape)',
            commands: '### Suggested commands',
            external: '## External platform checklist',
            cautions: '## Selection cautions (not check diagnostics)',
            docs: '## Related docs',
        },
        topologyLabels: {
            recipe: 'Recipe',
            profile: 'profile',
            assembly: 'Assembly',
            serverRuntime: 'Server runtime',
            ship: 'Shipping',
            adapters: 'Platform adapters',
            env: 'Required env (names only)',
        },
        constraints: [
            'Never write secret values into `vmz.config.ts`, web artifacts, reports, logs, workflows, or this plan text',
            'Shipping is decided only by the result of `vmz check` and `vmz build`. This prompt is not proof that it ships',
            'If `vmz deploy --plan` needs a machine-readable DeployPlan, generate the file yourself. Do not ask the user to hand-copy JSON',
            'When the matching `@vmz/plugin-deploy-*` is missing, fail and ask the user to install it. Never skip silently',
        ],
        tasks: [
            "1. Merge or write the `delivery` block in `vmz.config.ts` (shape below). Follow the repo's existing `defineConfig` style and never create a parallel `vmz.site.ts`.",
            '2. Prepare `vmz deploy` for the shipping mode: git-ci generates the CI workflow and registers secret names; direct-upload uses the local upload path.',
            '3. Check the console fields against the external platform checklist below. Record names and paths only.',
            '4. Run the suggested commands. When a binding is missing, report variable names only and never echo values. After git-ci, tell the user to run `git push` manually.',
        ],
        cautionsNone: 'None',
    },
    commands: {
        ci: '   # git-ci: reads .env.secrets* by default; pass managed secrets once; never publish locally',
        ciPush: '   # CI then runs check, build, and publish',
        upload: '   # direct-upload: reads .env.secrets* by default; values can also be passed once',
    },
    links: {
        guide: 'Deploy guide',
        recipe: 'Recipe {{id}}',
        secrets: 'Secrets and environment',
        cli: 'vmz deploy',
        staticHosts: 'Static host checklist',
        recipeAnchors: {
            static: 'static',
            'web-ssr': 'web-ssr-default',
            'web-hybrid': 'web-hybrid',
            'web-client': 'web-client',
            'panel-embedded': 'rust-embedded',
        },
    },
    labels: {
        profiles: {
            static: 'Static hosting',
            'web-ssr': 'Single-host full stack',
            'web-hybrid': 'CDN + separate server',
            'web-client': 'Client-only + local static',
            'panel-embedded': 'Embedded panel (baseline + whole-package fallback)',
        },
        assemblies: {
            'web-static': 'Static hosting',
            'server-host': 'Single-host server',
            'cdn+server': 'CDN + server',
            'local-static': 'Local static',
            'rust-embedded': 'Rust embedded',
        },
        runtimes: { node: 'Node', worker: 'Worker', 'rust-host': 'Rust host' },
        customProfile: 'Custom recipe',
        customAssembly: 'Custom assembly',
        customRuntime: 'Custom runtime',
        none: '(none)',
        shipGitCi: 'Git CI',
        shipUpload: 'Direct upload',
    },
};

export function plannerCopy(locale: PlannerLocale = 'zh-hans'): PlannerCopy {
    return locale === 'en-us' ? EN : ZH;
}
