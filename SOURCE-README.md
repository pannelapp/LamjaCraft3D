# LamjaCraft 3D — buildable source package

This is the source code bundled with the matching standalone HTML release.
The application is licensed under MIT, Copyright (c) 2026 Arvid Mortensen.
See `LICENSE` and `THIRD_PARTY_NOTICES.md` for terms and font credits.

The native file format specification is `docs/NATIVE_FILE_FORMAT.md`; its small complete cube example matches `src/assets/native-format-sample.json`. The specification is embedded in About during the build.

## Build

Use Node.js 22.16 or newer and npm. From this folder, run:

```sh
npm ci
npm run typecheck
npm run build
```

Open `dist/LamjaCraft-3D.html` in a modern browser. The application and its
modeling worker run locally; the finished HTML has no runtime network dependency.
The initial dependency installation needs access to npm or a populated npm cache.

Every build compiles the application and embedded worker, creates the source
ZIP from the current files, embeds that ZIP and the license notices, and writes
identical `dist/LamjaCraft-3D.html` and `dist/index.html` files. About provides
**Download source code** for that exact release. The download needs no server.
The generated source ZIP is also written to `dist/`.

## Performance maintenance

`docs/PERFORMANCE.md` records remaining measured costs, conditional optimization
ideas and the contracts required by `RULES.md` section 16.1. Read it before
changing affected code. Historical measurements and named regression suites
are available in the complete development project.

## Contents and omissions

Included: TypeScript sources, HTML template, required assets, build scripts,
TypeScript configurations, npm dependency lock, license notices and development
rules. `AGENTS.md` directs future changes to the release contract. Font outlines are already generated; rebuilding needs no font software.

Tests, test fixtures, example models, historical verification logs, original
large logo, installed dependencies and generated build/distribution files are
excluded. This package can build the application, but does not include the test
suite. Its package.json therefore exposes only `build` and `typecheck`.
The separate complete development-project ZIP retains tests and examples.

## Changes

Follow `RULES.md`, update the version in package.json and package-lock.json
together, and run `npm run build`. Always distribute newly generated HTML;
never edit the generated HTML or replace its embedded source separately.
