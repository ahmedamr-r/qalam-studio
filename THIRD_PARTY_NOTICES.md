# Third-party notices

Qalam Studio is licensed under the Apache License 2.0 (see [LICENSE](LICENSE)). It uses the open-source packages and assets listed below. Each keeps its own license.

Versions are the ones `pnpm install` installs from `pnpm-lock.yaml`. Each license and repository was read from the package's own `package.json` and license file in `node_modules`.

## Bundled into the app

`package.json` lists only Electron under `dependencies`. Vite bundles these into the window and the core:

| Package | Version | License | Repository |
| --- | --- | --- | --- |
| @anthropic-ai/sdk | 0.128.0 | MIT | https://github.com/anthropics/anthropic-sdk-typescript |
| @assistant-ui/react | 0.15.28 | MIT | https://github.com/assistant-ui/assistant-ui |
| @radix-ui/react-popover | 1.1.23 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-tabs | 1.1.21 | MIT | https://github.com/radix-ui/primitives |
| @radix-ui/react-tooltip | 1.2.16 | MIT | https://github.com/radix-ui/primitives |
| clsx | 2.1.1 | MIT | https://github.com/lukeed/clsx |
| culori | 4.0.2 | MIT | https://github.com/Evercoder/culori |
| d3-force | 3.0.0 | ISC | https://github.com/d3/d3-force |
| d3-quadtree | 3.0.1 | ISC | https://github.com/d3/d3-quadtree |
| immer | 11.1.18 | MIT | https://github.com/immerjs/immer |
| lucide | 1.48.0 | ISC (some icons MIT, from Feather) | https://github.com/lucide-icons/lucide |
| lucide-react | 1.48.0 | ISC (some icons MIT, from Feather) | https://github.com/lucide-icons/lucide |
| mammoth | 1.13.0 | BSD-2-Clause | https://github.com/mwilliamson/mammoth.js |
| motion | 13.4.6 | MIT | https://github.com/motiondivision/motion |
| nanoid | 6.0.1 | MIT | https://github.com/ai/nanoid |
| pdfjs-dist | 6.3.289 | Apache-2.0 | https://github.com/mozilla/pdf.js |
| postcss | 8.5.28 | MIT | https://github.com/postcss/postcss |
| react | 19.3.0 | MIT | https://github.com/react/react |
| react-colorful | 5.8.1 | MIT | https://github.com/omgovich/react-colorful |
| react-dom | 19.3.0 | MIT | https://github.com/react/react |
| sucrase | 3.35.1 | MIT | https://github.com/alangpierce/sucrase |
| yoga-layout | 3.2.1 | MIT | https://github.com/facebook/yoga |
| zod | 4.6.5 | MIT | https://github.com/colinhacks/zod |
| zustand | 5.0.15 | MIT | https://github.com/pmndrs/zustand |

Notes:

- The `lucide` and `lucide-react` license is ISC, with an MIT notice (Copyright (c) 2013-present Cole Bemis) for the icons that come from the Feather project. The list of those icons is in the package's `LICENSE` file.
- `@assistant-ui/react` brings in `@assistant-ui/core` 0.3.27, `@assistant-ui/store` 0.3.19, `@assistant-ui/tap` 0.9.23, `assistant-stream` 0.3.50, `assistant-cloud` 0.2.7 and `safe-content-frame` 0.0.34 (all MIT, from the same repository), plus `radix-ui` 1.8.1 (MIT), `react-textarea-autosize` 8.5.9 (MIT) and `secure-json-parse` 4.1.1 (BSD-3-Clause). `pnpm.overrides` in `package.json` pins them. Qalam uses only its unstyled primitives and never calls assistant-ui's cloud.
- `pdfjs-dist` also ships license files for its `wasm/` image decoders (`LICENSE_JBIG2`, `LICENSE_OPENJPEG`, `LICENSE_QCMS` and the matching `LICENSE_PDFJS_*` files).
- These packages have dependencies of their own, each under its own license. `pnpm licenses list --prod` prints the full list.
- The `devDependencies` (TypeScript, Vitest, Tailwind CSS, type packages and the others in `package.json`) are build and test tools. Each is under its own license.

## Loaded at runtime from the network

These are not in this repository. The browser or server downloads them while the app runs.

| Asset | Version | License | Source |
| --- | --- | --- | --- |
| CanvasKit (Skia), npm package `canvaskit-wasm` | 0.42.0 | BSD-3-Clause, Copyright (c) 2011 Google Inc. | https://github.com/google/skia/tree/main/modules/canvaskit |

- `src/engine/canvaskit.ts` loads CanvasKit in the browser from `https://cdn.jsdelivr.net/npm/canvaskit-wasm@0.42.0/bin/`. The `canvaskit-wasm` npm package is a devDependency. It provides the TypeScript types, and some tests run CanvasKit from it in Node.
- Google Fonts: for a font family that is not bundled, `app/api/fonts/route.ts` asks `fonts.googleapis.com` for the family's TTF file URLs, and the font files are then downloaded from `fonts.gstatic.com`. No Google Fonts files are stored in this repository. Each family has its own license, shown on its Google Fonts page.

## Bundled fonts

The fonts in `public/fonts` are licensed under the SIL Open Font License, Version 1.1. The full license text and the copyright notices are in [public/fonts/OFL.txt](public/fonts/OFL.txt).

| Family | Files | Version | Copyright | Source |
| --- | --- | --- | --- | --- |
| Inter | `Inter-400/500/600/700.ttf` | 4.001 | Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter) | https://github.com/rsms/inter |
| IBM Plex Sans Arabic | `IBMPlexSansArabic-400/500/600/700.ttf` | 1.101 | Copyright 2019 IBM Corp. All rights reserved. Reserved Font Name "Plex". | https://github.com/IBM/plex |
| Plus Jakarta Sans | `PlusJakartaSans-400/600/700.ttf` | 2.071 | Copyright 2020 The Plus Jakarta Sans Project Authors (https://github.com/tokotype/PlusJakartaSans) | https://github.com/tokotype/PlusJakartaSans |

## Bundled icon data: Hugeicons

`public/icons/hugeicons.json` holds the SVG path data of the free Hugeicons set. `scripts/hugeicons.mts` generates it from the npm package `@hugeicons/core-free-icons` 4.3.5, which is a devDependency (https://github.com/hugeicons/hugeicons, https://hugeicons.com). The studio fetches the file the first time it needs a Hugeicons icon. The package's license:

```
MIT License

Copyright (c) 2025 Hugeicons

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Other generated data

- `src/design-system/lucide-names.json` lists the icon names in the installed `lucide` package. `scripts/lucide-names.mjs` generates it. Lucide's license is listed above.
- `src/design-system/interview/fonts.json` lists Google Fonts families with their category, weights, Arabic support and the crowd-rated "expressive" tag scores. `scripts/fonts-catalog.mjs` builds it from `tags/all/families.csv` in the google/fonts repository (https://github.com/google/fonts) and from `https://fonts.google.com/metadata/fonts`. See those sources for their terms.
