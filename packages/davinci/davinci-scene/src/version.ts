// Scene contract version — the single namespace every scene carries.
//
// Before 1.0.0 the contract namespace is `/v0` and never moves with package
// versions. Consumers refuse anything else outright — no dual read, no
// fallback, stale artifacts are regenerated instead.

/** The only scene contract version this build emits and accepts. */
export const SCENE_VERSION = "/v0";

export type SceneVersion = typeof SCENE_VERSION;

/** Contract guard used by `resolve` and `renderSvg` at their boundaries. */
export function assertSceneVersion(version: string, stage: string): void {
    if (version !== SCENE_VERSION) {
        throw new Error(
            `davinci.scene.unsupported-version: ${stage} wants ${SCENE_VERSION}, got ${JSON.stringify(version)}`,
        );
    }
}
