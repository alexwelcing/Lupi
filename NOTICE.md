# Notice

This repo is the maintained standalone home for Lupi at `lupi.live`.

It was initialized from the Lupine monorepo extraction work. Historical
development and provenance remain available in:

https://github.com/alexwelcing/lupine

## Licensing

Relicensed 2026-11-11 by the copyright holder: code MIT (was
AGPL-3.0-or-later where applicable); first-party prose and data CC BY 4.0 (was
CC BY-SA 4.0 / ODbL).

- Project-owned code: MIT (`LICENSE`).
- First-party prose, figures, documentation and visual assets: CC BY 4.0
  (`LICENSE-CONTENT.md`).
- First-party structured data, viewer manifests and catalogs: CC BY 4.0
  (`LICENSE-DATA.md`).

You can reuse our code (MIT) and our first-party text and data (CC BY 4.0) with
attribution and no share-alike obligations.

## Third-party material

Third-party dependencies and imported scientific data retain their upstream
licenses; MIT and CC BY 4.0 above do not apply to them. In this repo that
includes, for example:

- packages installed through `package.json`, `pnpm-lock.yaml` and
  `packages/parsers/wasm/Cargo.toml`, each under its own licence;
- the OMol25 featured rows under `apps/web/public/datasets/omol25/` (Open
  Molecules 2025, CC BY 4.0, cited in `featured.v1.json`);
- NIST Interatomic Potentials Repository catalog data under
  `apps/web/public/nist/` and `nist_ipr/`;
- molecule structures and identities taken from PubChem and other public
  sources (see the source fields in `packages/ui/src/gallery-nomenclature.json`);
- the environment HDRIs and the adapted TSL shading described below.

The environment HDRIs in `apps/web/public/hdri/` are from Poly Haven and are
CC0 1.0 (public domain); see `apps/web/public/hdri/NOTICE.md`.

Some TSL shading in `packages/scene/src/tsl/` is adapted from Shaders
(https://github.com/shader-effects-inc/shaders, v4.0.2), Copyright (c) 2026
Shader Effects Inc., released under the MIT License. Each adapted file names
the component it follows. The MIT License text follows.

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.
