"use strict";
/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPlatformServerDominoExposePlugin = createPlatformServerDominoExposePlugin;
exports.createPlatformServerDominoRedirectPlugin = createPlatformServerDominoRedirectPlugin;
const path_1 = require("../../utils/path");
/**
 * Filter matching the Domino bundle import inside `@angular/platform-server`.
 */
const BUNDLED_DOMINO_FILTER = /[\\/]third_party[\\/]domino[\\/]bundled-domino\.mjs$/;
/**
 * The property name on `globalThis` where the Domino instance is stored.
 */
const DOMINO_GLOBAL_PROPERTY = 'ɵdomino';
/**
 * Creates an esbuild plugin that attaches the Domino instance to `globalThis` when
 * `@angular/platform-server/init` is bundled into the server polyfills bundle.
 *
 * @returns An esbuild plugin.
 */
function createPlatformServerDominoExposePlugin() {
    return {
        name: 'angular-platform-server-domino-expose',
        setup(build) {
            build.onResolve({ filter: BUNDLED_DOMINO_FILTER }, (args) => args.namespace !== 'angular:domino-expose' && args.kind === 'import-statement'
                ? {
                    path: 'angular:platform-server-domino',
                    namespace: 'angular:domino-expose',
                    pluginData: {
                        importPath: args.path,
                        resolveDir: args.resolveDir,
                    },
                }
                : null);
            build.onLoad({ filter: /./, namespace: 'angular:domino-expose' }, (args) => {
                const { importPath, resolveDir } = args.pluginData;
                return {
                    contents: [
                        `import domino from ${JSON.stringify((0, path_1.toPosixPath)(importPath))};`,
                        `globalThis['${DOMINO_GLOBAL_PROPERTY}'] = domino;`,
                        `export default domino;`,
                    ].join('\n'),
                    loader: 'js',
                    resolveDir,
                };
            });
        },
    };
}
/**
 * Creates an esbuild plugin that redirects imports of Domino in `@angular/platform-server`
 * to the single copy attached to `globalThis` by the server polyfills bundle.
 *
 * @returns An esbuild plugin.
 */
function createPlatformServerDominoRedirectPlugin() {
    return {
        name: 'angular-platform-server-domino-redirect',
        setup(build) {
            build.onResolve({ filter: BUNDLED_DOMINO_FILTER }, (args) => args.kind === 'import-statement'
                ? {
                    path: 'angular:platform-server-domino',
                    namespace: 'angular:platform-server-domino',
                }
                : null);
            build.onLoad({ filter: /./, namespace: 'angular:platform-server-domino' }, () => ({
                contents: `export default globalThis['${DOMINO_GLOBAL_PROPERTY}'];`,
                loader: 'js',
            }));
        },
    };
}
//# sourceMappingURL=platform-server-domino-plugin.js.map