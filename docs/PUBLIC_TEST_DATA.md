# Public test-data policy

Publish code and reproducible small synthetic cases. Keep uploaded designs,
unknown-origin exchange models and raw debug snapshots private until their
contents and redistribution terms have been explicitly reviewed. Compression,
anonymizing a filename or converting a model to another format does not remove
the model's contents or establish permission to publish it.

## Contents of this source package

All runtime TypeScript and the HTML template match v0.9.174. Build scripts,
configurations, lockfile, MIT/font notices, architecture/performance/native-format
documentation and public test helpers are included. Tests are development-only;
they are never bundled into the runtime or the About source ZIP.

The public regression set contains 90 whole suites. The 21 mixed suites needing
private attached models/snapshots are excluded in their entirety, with their
names and reasons listed in `tests/public-suites.json`. Their original copies
and data remain intact in the private development project. Private opt-in tests,
local benchmark inputs, raw diagnostics, historical verification/screenshots,
large original logo and existing complete development ZIPs are excluded.

Only these reviewed stored test/reference inputs are included:

| Path | Origin and purpose |
| --- | --- |
| `tests/fixtures/triangulation-bridged-reference.js` | Frozen project reference algorithm, not model data |
| `tests/fixtures/round-text-short-edge.json` | Synthetic canonical cone/text seam case |
| `tests/fixtures/round-text-offset-corner.json` | Synthetic canonical sphere/text seam case |
| `examples/curved-split-surface.lamjacraft.json` | Simple synthetic box and construction grid for native Open |
| `examples/dense-split-surface.lamjacraft.json` | Simple synthetic box and 30 × 30 construction grid for capacity/split |

The two box inputs contain the same plain 80 × 60 × 30 mm closed box and a
construction grid, rather than an imported user design. Text seam provenance is
recorded in `tests/fixtures/round-text-seams.md`. SHA-256 checksums of these five
inputs are in the public manifest. The small cube in
`src/assets/native-format-sample.json` is a separate required interoperability
example for the native format documentation.

## Adding data later

1. Prefer a deterministic generator and independent expected geometric results.
2. If a stored fixture is needed, minimize it while preserving the failing rule.
3. Record who created it, the source, redistribution permission/license and the
   reason a synthetic generator does not suffice. Preserve required notices.
4. Inspect names, metadata, geometry, embedded screenshots, paths and logs.
5. Include only the files needed to reproduce the test. Keep heavyweight or
   private optional tests separate and explicit; never call a skipped test a pass.

There is no blanket permission claim for the excluded user-provided fixtures.
The application MIT notice does not automatically establish terms for an
independently sourced model or font. Keep third-party notices distinct.
