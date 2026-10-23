/** Homepage Deploy Planner — T.* → agent prompt (04 contract).
 *
 * Primary deliverable: copy-paste agentPrompt for Cursor/Codex/etc.
 * Structured fields are a glanceable summary; not a hand-copied JSON plan.
 *
 * Axes: T.vendor = where · T.ship = how (git-ci | direct-upload)
 * Copy lives in `planner-copy.ts`, keyed by the page locale.
 */

import { plannerCopy } from './planner-copy.ts';
import type { PlannerCopy, PlannerLocale, VendorStepCopy } from './planner-copy.ts';


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
    /** UI locale for cautions, checklists, and the generated prompt. */
    locale?: PlannerLocale;
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

/** Fill `{{name}}` placeholders in a copy template. */
function templ(template: string, vars: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => vars[key] || '');
}

/** Heading ids must match document renderer slugify (see dist recipes.html). */
function recipeDocHref(locale: PlannerLocale, recipeId: string, copy: PlannerCopy): string {
    const base = `/d/${locale}/guide/deploy/recipes`;
    const anchor = copy.links.recipeAnchors[recipeId];
    return anchor ? `${base}#${anchor}` : base;
}

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

function pushShipCautions(ship: ShipMode, cautions: string[], copy: PlannerCopy) {
    if (ship === 'git-ci') {
        cautions.push(copy.shipCautions.gitCi[0]);
        cautions.push(copy.shipCautions.gitCi[1]);
    } else {
        cautions.push(copy.shipCautions.directUpload);
    }
}

function forceServer(server: ServerAnswer): ServerAnswer {
    return server === 'none' ? 'node' : server;
}

function hasStaticVendor(vendors: VendorId[]): boolean {
    return vendors.some((v) => STATIC_VENDORS.includes(v));
}

function publishDirNote(profileId: string, copy: PlannerCopy): string {
    return templ(copy.publishDir, { profile: profileId });
}

function buildCmd(profileId: string, copy: PlannerCopy): string {
    return templ(copy.buildCmd, { profile: profileId });
}

function pickRecipe(answers: PlannerAnswers, cautions: string[], copy: PlannerCopy): RecipePick {
    const { secrets, html, assets, server, update, vendors } = answers;

    if (update === 'release-fallback' || assets === 'embedded-binary') {
        if (secrets === 'yes' && assets === 'embedded-binary') {
            cautions.push(copy.cautions.embeddedSecrets);
        }
        if (html === 'browser-only') {
            cautions.push(copy.cautions.embeddedBrowserOnly);
        }
        return {
            recipeId: 'panel-embedded',
            profileId: 'panel-embedded',
            assembly: 'rust-embedded',
        };
    }

    if (secrets === 'yes') {
        if (html === 'cdn-prebuild' || html === 'browser-only' || server === 'none') {
            cautions.push(copy.cautions.secretsNeedServer);
        }
        if (hasStaticVendor(vendors)) {
            cautions.push(copy.cautions.secretsStaticVendor);
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
            cautions.push(copy.cautions.staticServerScripts);
        } else {
            cautions.push(copy.cautions.staticServerScriptsStrict);
        }
        return {
            recipeId: 'static',
            profileId: 'static',
            assembly: 'web-static',
        };
    }

    if (hasStaticVendor(vendors) && html === 'request-ssr') {
        cautions.push(copy.cautions.staticCannotSsr);
    }

    if (html === 'request-ssr') {
        const runtime = forceServer(server);
        if (server === 'none') {
            cautions.push(copy.cautions.ssrNeedsServer);
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
            cautions.push(copy.cautions.browserOnlyNoServer);
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
        cautions.push(copy.cautions.prebuildWithServer);
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

function buildSnippet(pick: RecipePick, copy: PlannerCopy): string {
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
            copy.snippet.sources,
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
        copy.snippet.plan,
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

function buildAdapters(
    answers: PlannerAnswers,
    pick: RecipePick,
    copy: PlannerCopy,
): { kind: string; note?: string }[] {
    const adapters: { kind: string; note?: string }[] = [];
    const shipNote = answers.ship === 'git-ci' ? copy.shipNotes.gitCi : copy.shipNotes.directUpload;
    const notes = copy.adapterNotes;

    for (const v of answers.vendors) {
        if (v === 'cloudflare-pages') {
            adapters.push({ kind: 'cloudflare-pages', note: `${shipNote}${notes.pagesNoSpa}` });
        } else if (v === 'github-pages') {
            adapters.push({ kind: 'github-pages', note: shipNote });
        } else if (v === 'vercel') {
            adapters.push({ kind: 'vercel', note: shipNote });
        } else if (v === 'netlify') {
            adapters.push({ kind: 'netlify', note: shipNote });
        } else if (v === 'tencent-edgeone') {
            adapters.push({ kind: 'tencent-edgeone', note: `${shipNote}${notes.edgeoneCli}` });
        } else if (v === 'cloudflare-workers') {
            adapters.push({ kind: 'cloudflare-workers', note: notes.workerBindings });
        } else if (v === 's3-cloudfront') {
            adapters.push({ kind: 's3-cloudfront', note: notes.s3Local });
        } else if (v === 'node-vps') {
            adapters.push({ kind: 'node-vps', note: notes.nodeCurrent });
        } else if (v === 'rust-bin') {
            adapters.push({ kind: 'rust-bin', note: notes.rustEmbedded });
        }
    }

    if (adapters.length === 0) {
        const note =
            pick.assembly === 'server-host' || pick.assembly === 'rust-embedded'
                ? notes.filesystemSwitch
                : notes.filesystemDefault;
        adapters.push({ kind: 'filesystem-release', note });
    }
    return adapters;
}

function axisStep(id: string, vendor: string, title: string, console: string[], ci: string[], localPush: string[]): ExternalStep {
    return { id, vendor, title, console, ci, localPush };
}

function buildExternalSteps(
    answers: PlannerAnswers,
    pick: RecipePick,
    requiredEnv: string[],
    copy: PlannerCopy,
): ExternalStep[] {
    const steps: ExternalStep[] = [];
    const tokens: Record<string, string> = {
        cmd: buildCmd(pick.profileId, copy),
        publishDir: publishDirNote(pick.profileId, copy),
        env:
            requiredEnv.length > 0
                ? templ(copy.steps.envList, { names: requiredEnv.join(copy.listSeparator) })
                : copy.steps.envEmpty,
        branch:
            answers.ship === 'git-ci' ? copy.steps.tokens.consoleBranchCi : copy.steps.tokens.consoleBranchUpload,
        githubSource:
            answers.ship === 'git-ci' ? copy.steps.tokens.githubSourceCi : copy.steps.tokens.githubSourceUpload,
        pagesSplit: answers.vendors.includes('cloudflare-pages')
            ? copy.steps.tokens.pagesSplit
            : copy.steps.tokens.pagesAlone,
    };
    const fill = (lines: string[]) => lines.map((line) => templ(line, tokens));
    const naCi = [copy.steps.naCi];
    const naUp = [copy.steps.naUp];

    const push = (id: string, source: VendorStepCopy) => {
        steps.push(
            axisStep(
                id,
                source.title,
                id,
                fill(source.console),
                answers.ship === 'git-ci' ? fill(source.ci) : naCi,
                answers.ship === 'direct-upload' ? fill(source.upload) : naUp,
            ),
        );
    };

    for (const v of answers.vendors) {
        const source = copy.steps.vendors[v];
        if (source) push(v, source);
    }

    if (steps.length === 0) push('local', copy.steps.local);

    return steps;
}

function bullet(lines: string[]): string {
    return lines.map((l) => `- ${l}`).join('\n');
}

function formatStepBlock(step: ExternalStep, copy: PlannerCopy): string {
    const { heading, axes } = copy.steps;
    return [
        templ(heading, { title: step.title, vendor: step.vendor }),
        '',
        axes.console,
        bullet(step.console),
        '',
        axes.ci,
        bullet(step.ci),
        '',
        axes.local,
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
    copy: PlannerCopy;
}): string {
    const {
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
        copy,
    } = input;
    const { prompt } = copy;

    const platformLine =
        adapters.length > 0
            ? adapters
                  .map((a) =>
                      a.note
                          ? templ(copy.adapterLineWithNote, { id: a.kind, note: a.note })
                          : templ(copy.adapterLine, { id: a.kind }),
                  )
                  .join(copy.listSeparator)
            : prompt.platformEmpty;

    const envLine =
        requiredEnv.length > 0 ? requiredEnv.join(copy.listSeparator) : prompt.envEmpty;

    const shipBlock = ship === 'git-ci' ? prompt.shipGitCi : prompt.shipUpload;

    const cautionBlock =
        cautions.length > 0
            ? [prompt.headings.cautions, '', bullet(cautions)].join('\n')
            : `${prompt.headings.cautions}\n\n- ${prompt.cautionsNone}`;

    const stepsBlock = externalSteps.map((step) => formatStepBlock(step, copy)).join('\n\n');

    const linksBlock = bullet(deepLinks.map((l) => `${l.label}${copy.labelColon}${l.href}`));

    return [
        prompt.title,
        '',
        disclaimer,
        '',
        prompt.intro,
        '',
        prompt.headings.topology,
        '',
        bullet([
            `${prompt.topologyLabels.recipe}: ${pick.recipeId}`,
            `${prompt.topologyLabels.profile}: ${pick.profileId}`,
            `${prompt.topologyLabels.assembly}: ${pick.assembly}`,
            ...(pick.serverRuntime ? [`${prompt.topologyLabels.serverRuntime}: ${pick.serverRuntime}`] : []),
            `${prompt.topologyLabels.ship}: ${ship}`,
            `${prompt.topologyLabels.adapters}: ${platformLine}`,
            `${prompt.topologyLabels.env}: ${envLine}`,
        ]),
        '',
        prompt.headings.constraints,
        '',
        shipBlock,
        '',
        bullet(prompt.constraints),
        '',
        prompt.headings.tasks,
        '',
        prompt.tasks.join('\n'),
        '',
        prompt.headings.delivery,
        '',
        '```ts',
        vmzConfigSnippet.trimEnd(),
        '```',
        '',
        prompt.headings.commands,
        '',
        bullet(commandsSuggested),
        '',
        prompt.headings.external,
        '',
        stepsBlock,
        '',
        cautionBlock,
        '',
        prompt.headings.docs,
        '',
        linksBlock,
        '',
    ].join('\n');
}

export function buildDeployPlan(answers: PlannerAnswers): DeployPlanView {
    const locale: PlannerLocale = answers.locale === 'en-us' ? 'en-us' : 'zh-hans';
    const copy = plannerCopy(locale);
    const cautions: string[] = [];
    const pick = pickRecipe(answers, cautions, copy);
    pushShipCautions(answers.ship, cautions, copy);
    const requiredEnv = collectRequiredEnv(answers, pick);
    const adapters = buildAdapters(answers, pick, copy);
    const externalSteps = buildExternalSteps(answers, pick, requiredEnv, copy);
    const vmzConfigSnippet = buildSnippet(pick, copy);
    const ship = answers.ship;

    const commandsSuggested: string[] = ['vmz check', `vmz build --release --profile ${pick.profileId}`];
    if (ship === 'git-ci') {
        commandsSuggested.push(
            `vmz deploy [--secret NAME=VALUE]…  ${copy.commands.ci}`,
            `git push  ${copy.commands.ciPush}`,
        );
    } else {
        commandsSuggested.push(`vmz deploy [--secret NAME=VALUE]…  ${copy.commands.upload}`);
    }

    const deployGuide = `/d/${locale}/guide/deploy`;
    const deepLinks = [
        { label: copy.links.guide, href: `${deployGuide}/` },
        { label: templ(copy.links.recipe, { id: pick.recipeId }), href: recipeDocHref(locale, pick.recipeId, copy) },
        { label: copy.links.secrets, href: `${deployGuide}/secrets-env` },
        { label: copy.links.cli, href: `${deployGuide}/cli` },
    ];
    if (hasStaticVendor(answers.vendors) || pick.assembly === 'web-static') {
        deepLinks.splice(2, 0, { label: copy.links.staticHosts, href: `${deployGuide}/static-hosts` });
    }

    const disclaimer = copy.disclaimer;
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
        copy,
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
