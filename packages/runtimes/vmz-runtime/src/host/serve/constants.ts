import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { createRequire, registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { listClientComponents } from '../list-client-components.js';
import type { ClosedAccessResult, HostRequestOpts, LocaleHostCtx, SseClient } from '../../shared/host.types.js';
import { LOCALE_LINK_PLAN_SCHEMA, linkRouteAliasesFromUnits, localeHrefTableFromPlan, localizeBodyLinks } from '../localize-body-links.js';
import { loadNativeAddon } from '../native-addon.js';
import { createRenderHost } from '../render-host.js';
import { resolveRouteLayoutChain } from '../route-layout-chain.js';
import { handleNodeRequest, setRoutes, setServerModuleResolver } from '../../faces/vmz-runtime.js';

export const ROUTE_CATALOG_SCHEMA = 'vmz.route.catalog.v0';

export const ROUTE_CATALOG_REL = '_vmz/route-catalog.json';

export const LOCALE_LINK_PLAN_REL = '_vmz/locale-link-plan.json';

export const THEME_STORE_KEY = 'vmz-theme';

export const LOCALE_STORE_KEY = 'vmz.locale';

export const SHUTDOWN_TIMEOUT_MS = Number(process.env.VMZ_SHUTDOWN_TIMEOUT_MS || 10000);
