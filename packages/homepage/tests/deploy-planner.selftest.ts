/**
 * Smoke checks for deploy-planner decision table + agent prompt.
 * Run: pnpm --filter @vmz/homepage test:deploy-planner
 */
import { buildDeployPlan, DEFAULT_ANSWERS } from '../src/deploy/planner.ts';

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

const staticPlan = buildDeployPlan(DEFAULT_ANSWERS);
assert(staticPlan.profileId === 'static', 'default → static');
assert(staticPlan.ship === 'git-ci', 'default ship git-ci');
assert(typeof staticPlan.agentPrompt === 'string' && staticPlan.agentPrompt.length > 200, 'prompt');
assert(staticPlan.agentPrompt.includes('VMZ 部署落地任务'), 'prompt title');
assert(!('planJson' in staticPlan), 'no hand-copy planJson field');
assert(
    staticPlan.deepLinks.some((l) => l.href.includes('#static-只有-cdn-对象存储')),
    'recipe deep link slug',
);
assert(
    staticPlan.cautions.some((c) => c.includes('advice') && c.includes('--secret')),
    'default ship advice',
);

const secretsPlan = buildDeployPlan({
    ...DEFAULT_ANSWERS,
    secrets: 'yes',
    vendors: ['cloudflare-pages'],
});
assert(secretsPlan.assembly !== 'static-cdn', 'secrets ban static');
assert(
    secretsPlan.adapters.some((a) => a.kind === 'cloudflare-pages'),
    'platform kind',
);
assert(
    secretsPlan.cautions.some((c) => c.includes('advice') && c.includes('--secret')),
    'ship advice always',
);

const ci = buildDeployPlan({
    ...DEFAULT_ANSWERS,
    ship: 'git-ci',
    vendors: ['cloudflare-pages'],
});
assert(ci.ship === 'git-ci', 'ship git-ci');
assert(ci.agentPrompt.includes('git-ci'), 'prompt ship');
assert(ci.agentPrompt.includes('--secret'), 'prompt secret advice');
assert(ci.agentPrompt.includes('手抄 JSON'), 'no hand json');
assert(
    ci.commandsSuggested.some((c) => c.includes('git push')),
    'push after ci',
);
assert(ci.adapters[0].kind === 'cloudflare-pages', 'kind is platform');

const up = buildDeployPlan({
    ...DEFAULT_ANSWERS,
    ship: 'direct-upload',
    vendors: ['vercel'],
});
assert(up.ship === 'direct-upload', 'ship upload');
assert(up.requiredEnv.includes('VERCEL_TOKEN'), 'vercel env');
assert(up.agentPrompt.includes('direct-upload'), 'prompt upload');
assert(
    up.commandsSuggested.some((c) => c.includes('direct-upload')),
    'upload command',
);
assert(up.vmzConfigSnippet.includes('deploy.plan.json') === false || up.vmzConfigSnippet.includes('// deploy:'), 'plan commented not forced');

const hybrid = buildDeployPlan({
    secrets: 'none',
    html: 'request-ssr',
    assets: 'cdn',
    server: 'worker',
    update: 'no',
    ship: 'git-ci',
    vendors: ['cloudflare-workers'],
});
assert(hybrid.profileId === 'web-hybrid', 'hybrid');

const rust = buildDeployPlan({
    ...DEFAULT_ANSWERS,
    html: 'request-ssr',
    server: 'rust-host',
    assets: 'same-host',
    vendors: [],
});
assert(rust.serverRuntime === 'rust-host', 'rust-host runtime id');

console.log('deploy-planner.selftest: ok');
