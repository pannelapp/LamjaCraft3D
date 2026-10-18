# LamjaCraft development instructions

Read `RULES.md` before changing this project. Follow its English-language,
geometry, architecture, validation and release requirements.

For performance-sensitive changes, also read `docs/PERFORMANCE.md` and preserve
the contracts required by `RULES.md` section 16.1. It records remaining measured
costs, conditional follow-up ideas and the regression map.

Before delivering a release, update package.json and package-lock.json together
and run `npm run build`. The generated HTML must include its matching buildable
TypeScript source ZIP and full MIT/font notices. Never hand-edit generated HTML
or embed a source ZIP from another version. `RULES.md` section 22 defines the
mandatory source-package scope and checks.

The embedded source package deliberately excludes tests and examples and has
only build/typecheck npm commands. Retain the complete test suite and examples
in the separate full development project. Use that full project for required
regressions; do not silently remove tests to satisfy a release check.
