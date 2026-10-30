/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */
import type { Plugin } from 'esbuild';
/**
 * Creates an esbuild plugin that attaches the Domino instance to `globalThis` when
 * `@angular/platform-server/init` is bundled into the server polyfills bundle.
 *
 * @returns An esbuild plugin.
 */
export declare function createPlatformServerDominoExposePlugin(): Plugin;
/**
 * Creates an esbuild plugin that redirects imports of Domino in `@angular/platform-server`
 * to the single copy attached to `globalThis` by the server polyfills bundle.
 *
 * @returns An esbuild plugin.
 */
export declare function createPlatformServerDominoRedirectPlugin(): Plugin;
