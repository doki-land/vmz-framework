/**
 * profile-solver: deterministic Surface / capability / route solver
 * (architecture notes / ).
 *
 * Algebraic first version — fixtures supply requirements; no real VPG infer.
 *
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    PROFILE_DIAG_CAPABILITY_PERMISSION_UNDECLARED,
    PROFILE_DIAG_CAPABILITY_UNRESOLVED,
    PROFILE_DIAG_ROUTE_UNREALIZABLE,
    PROFILE_DIAG_SURFACE_AMBIGUOUS,
    PROFILE_DIAG_SURFACE_NO_MATCH,
    PROFILE_HOST_RESOLUTION_MANIFEST_SCHEMA,
    PROFILE_PROTOCOL,
    PROFILE_SOLVER_CHECK_SCHEMA,
    checkProfileSolverJson,
    createWorkspace,
    profileCatalog,
    queryProfileProtocolCatalog,
} from 'vmz';

function fail(msg) {
    console.error(` GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('profile-solver: catalog includes solver documents…');
const jsCat = profileCatalog();
if (jsCat.protocol !== PROFILE_PROTOCOL) fail('JS catalog protocol');
for (const kind of [
    'surface_requirements',
    'capability_requirement',
    'surface_assignment_table',
    'capability_resolution_table',
    'route_realization_table',
    'host_resolution_manifest',
    'solver_input',
    'solver_check',
]) {
    if (!jsCat.documents.some((d) => d.kind === kind)) fail(`missing ${kind}`);
}
for (const code of [
    PROFILE_DIAG_SURFACE_NO_MATCH,
    PROFILE_DIAG_SURFACE_AMBIGUOUS,
    PROFILE_DIAG_CAPABILITY_UNRESOLVED,
    PROFILE_DIAG_CAPABILITY_PERMISSION_UNDECLARED,
    PROFILE_DIAG_ROUTE_UNREALIZABLE,
]) {
    if (!jsCat.diagnostics.includes(code)) fail(`missing diagnostic ${code}`);
}

const nativeCat = JSON.parse(queryProfileProtocolCatalog());
if (!nativeCat.documents?.some((d) => d.kind === 'solver_check')) {
    fail('native catalog missing solver_check');
}

console.log('profile-solver: Browser Direct smoke…');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-p1-'));
fs.mkdirSync(path.join(dir, 'src', 'pages'), { recursive: true });
fs.writeFileSync(
    path.join(dir, 'src', 'pages', 'index.vmz'),
    `<template>
  <button @click={increment}>{n}</button>
</template>
<script client>
export default class IndexPage {
  n = 0;
  increment() { this.n++; }
}
</script>
`,
);
fs.writeFileSync(
    path.join(dir, 'src', 'Application.vmz'),
    `<template><slot /></template>
<script client>
export default class Application {}
</script>
`,
);
const outDir = path.join(dir, 'dist');
const ws = createWorkspace({ root: dir, outDir });
const built = ws.build();
if ((built.diagnostics || []).some((d) => d.severity === 'error')) {
    fail(`build errors: ${JSON.stringify(built.diagnostics)}`);
}

console.log('profile-solver: checkProfileSolverJson (browser counter)…');
const report = JSON.parse(checkProfileSolverJson(dir));
if (report.schema !== PROFILE_SOLVER_CHECK_SCHEMA) fail(`report schema ${report.schema}`);
if (report.status !== 'ready') fail(`status ${report.status}: ${JSON.stringify(report.diagnostics)}`);
if (report.manifest?.schema !== PROFILE_HOST_RESOLUTION_MANIFEST_SCHEMA) fail('manifest schema');
if (report.manifest.surfaceAssignments?.assignments?.length !== 1) fail('expected 1 surface assignment');
if (report.manifest.surfaceAssignments.assignments[0].surfaceId !== 'vmz.surface.web.main') {
    fail('expected web.main assignment');
}
if (report.manifest.capabilityResolutions?.resolutions?.length !== 1) fail('expected 1 capability');
if (report.manifest.routeRealizations?.realizations?.length !== 1) fail('expected 1 route');
if (JSON.stringify(report).toLowerCase().includes('"isios"')) fail('must not use runtime isIOS');

const wsReport = JSON.parse(ws.checkProfileSolver());
if (wsReport.schema !== PROFILE_SOLVER_CHECK_SCHEMA || wsReport.status !== 'ready') {
    fail(`workspace check ${wsReport.status}`);
}

const host = structuredClone(report.hostProfile);
const delivery = structuredClone(report.deliveryProfile);
const input = structuredClone(report.solverInput);

console.log('profile-solver: reject SURFACE_NO_MATCH…');
const noMatch = structuredClone(input);
noMatch.regions[0].requirements.requiredOperations = ['NativeTextureMount'];
fs.writeFileSync(path.join(dir, 'host-profile.json'), JSON.stringify(host, null, 2));
fs.writeFileSync(path.join(dir, 'delivery-profile.json'), JSON.stringify(delivery, null, 2));
fs.writeFileSync(path.join(dir, 'solver-input.json'), JSON.stringify(noMatch, null, 2));
const noFail = JSON.parse(checkProfileSolverJson(dir));
if (noFail.status !== 'failed') fail('expected failed for no match');
if (!(noFail.diagnostics || []).some((d) => d.code === PROFILE_DIAG_SURFACE_NO_MATCH)) {
    fail(`expected ${PROFILE_DIAG_SURFACE_NO_MATCH}`);
}

console.log('profile-solver: reject SURFACE_AMBIGUOUS…');
const ambHost = structuredClone(host);
ambHost.surfaces.push({
    schema: 'vmz.profile.surface_binding.v0',
    surfaceId: 'vmz.surface.native.alt',
    kind: 'native',
    driverId: 'vmz.driver.native-view',
    supportedOperations: host.surfaces[0].supportedOperations,
    supportedElementKinds: host.surfaces[0].supportedElementKinds,
    supportedEventKinds: host.surfaces[0].supportedEventKinds,
    supportedStyleFeatures: host.surfaces[0].supportedStyleFeatures,
    supportedAccessibility: host.surfaces[0].supportedAccessibility,
});
const ambDelivery = structuredClone(delivery);
ambDelivery.defaultSurface = 'vmz.surface.missing';
ambDelivery.resolutionDigest = null;
fs.writeFileSync(path.join(dir, 'host-profile.json'), JSON.stringify(ambHost, null, 2));
fs.writeFileSync(path.join(dir, 'delivery-profile.json'), JSON.stringify(ambDelivery, null, 2));
fs.writeFileSync(path.join(dir, 'solver-input.json'), JSON.stringify(input, null, 2));
const ambFail = JSON.parse(checkProfileSolverJson(dir));
if (ambFail.status !== 'failed') fail('expected failed for ambiguous');
if (!(ambFail.diagnostics || []).some((d) => d.code === PROFILE_DIAG_SURFACE_AMBIGUOUS)) {
    fail(`expected ${PROFILE_DIAG_SURFACE_AMBIGUOUS}`);
}

console.log('profile-solver: reject CAPABILITY_UNRESOLVED…');
fs.writeFileSync(path.join(dir, 'host-profile.json'), JSON.stringify(host, null, 2));
fs.writeFileSync(path.join(dir, 'delivery-profile.json'), JSON.stringify(delivery, null, 2));
const capInput = structuredClone(input);
capInput.capabilities[0].capabilityId = 'vmz.capability.missing';
fs.writeFileSync(path.join(dir, 'solver-input.json'), JSON.stringify(capInput, null, 2));
const capFail = JSON.parse(checkProfileSolverJson(dir));
if (capFail.status !== 'failed') fail('expected failed for unresolved capability');
if (!(capFail.diagnostics || []).some((d) => d.code === PROFILE_DIAG_CAPABILITY_UNRESOLVED)) {
    fail(`expected ${PROFILE_DIAG_CAPABILITY_UNRESOLVED}`);
}

console.log('profile-solver: reject CAPABILITY_PERMISSION_UNDECLARED…');
const permHost = structuredClone(host);
permHost.capabilities.push({
    schema: 'vmz.profile.capability_binding.v0',
    capabilityId: 'vmz.capability.camera.capture',
    versionRange: '^0',
    executionDomain: 'native',
    providerId: 'vmz.provider.camera',
    permissions: [],
});
const permInput = structuredClone(input);
permInput.capabilities.push({
    schema: 'vmz.profile.capability_requirement.v0',
    capabilityId: 'vmz.capability.camera.capture',
    versionRange: '^0',
    permissions: ['camera'],
});
fs.writeFileSync(path.join(dir, 'host-profile.json'), JSON.stringify(permHost, null, 2));
fs.writeFileSync(path.join(dir, 'solver-input.json'), JSON.stringify(permInput, null, 2));
const permFail = JSON.parse(checkProfileSolverJson(dir));
if (permFail.status !== 'failed') fail('expected failed for undeclared permission');
if (!(permFail.diagnostics || []).some((d) => d.code === PROFILE_DIAG_CAPABILITY_PERMISSION_UNDECLARED)) {
    fail(`expected ${PROFILE_DIAG_CAPABILITY_PERMISSION_UNDECLARED}`);
}

console.log('profile-solver: reject ROUTE_UNREALIZABLE…');
const routeDelivery = structuredClone(delivery);
routeDelivery.entryRoutes = ['pages/missing'];
fs.writeFileSync(path.join(dir, 'host-profile.json'), JSON.stringify(host, null, 2));
fs.writeFileSync(path.join(dir, 'delivery-profile.json'), JSON.stringify(routeDelivery, null, 2));
fs.writeFileSync(path.join(dir, 'solver-input.json'), JSON.stringify(input, null, 2));
const routeFail = JSON.parse(checkProfileSolverJson(dir));
if (routeFail.status !== 'failed') fail('expected failed for unrealizable route');
if (!(routeFail.diagnostics || []).some((d) => d.code === PROFILE_DIAG_ROUTE_UNREALIZABLE)) {
    fail(`expected ${PROFILE_DIAG_ROUTE_UNREALIZABLE}`);
}

ws.dispose();
fs.rmSync(dir, { recursive: true, force: true });
console.log(' GATE OK: deterministic Surface/capability/route solve + NO_MATCH/AMBIGUOUS/UNRESOLVED diagnostics');
