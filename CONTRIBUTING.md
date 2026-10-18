# Contributing

Read `RULES.md` and `docs/ARCHITECTURE.md` before changing the application.
Project code, UI, tests and technical documentation use English. Preserve the
canonical B-rep, geometryApi, document commands, ToolController and SnapEngine
boundaries. Read `docs/PERFORMANCE.md` before changing performance-sensitive paths.

## Public distribution scope

This repository deliberately excludes private attachments and their dependent
test suites. In this distribution use `npm test` for the quick checks and
`npm run test:public` for the extended public regressions. Both run complete
suites listed in `tests/public-suites.json`; neither silently skips assertions.
The internal `test:full` command mentioned in the shared development rules is
available in the separate private project, not in this public package.

For ordinary changes run typechecks, quick tests and affected available suites.
For shared geometry, tolerances, workers or serialization, run all public
regressions and ask the maintainer to run the private full set before merging.
Record exactly which coverage ran. A public-only result must not be described
as a pass of the private full set. Do not remove assertions or hide a failing
test behind a missing-file check.

Register new public suites in `tests/public-suites.json` and retain the quick
set as a subset of the extended public set. Add small procedural reproducers
whenever possible. Commit a model or snapshot
only after checking its contents, provenance and permission to redistribute.
Use the policy in `docs/PUBLIC_TEST_DATA.md`. Keep local attachments in
`private/` or outside the repository; never copy the internal project archive
into this tree. `.gitignore` is a convenience and does not inspect file contents.

Update Help and contextual instructions when changing tool names, placement,
parameters or interaction. Keep the Help groups aligned with the palette.

## Builds and releases

Update package.json, package-lock.json and the public test manifest version
together for application releases. Always build through `npm run build`; never hand-edit the generated
HTML or replace its embedded source ZIP independently. Keep MIT and font notices.
Normal builds need only TypeScript; the embedded vector font data is ready to use.

Describe the problem, resulting behavior, relevant invariants and validation
in pull requests. Include a synthetic reproducer where practical. Do not post
private models or raw diagnostic logs in a public issue without reviewing them.
