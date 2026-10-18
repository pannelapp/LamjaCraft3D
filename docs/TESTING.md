# Public test coverage

Use Node.js 22.16+ and Python 3 (`python3`). Install the pinned development
dependency with `npm ci`. Typecheck using `npm run typecheck`.

| Command | Scope |
| --- | --- |
| `npm test` / `npm run test:quick` | 19 baseline suites; one build |
| `npm run test:public` | 90 self-contained public suites, including the baseline; one build |
| Other available `test:*` commands in package.json | Focused complete suites whose inputs are included |
| `node tests/<suite>.mjs` | One suite after a build; see the explicit manifest |

`tests/public-suites.json` defines the exact order, input provenance and the
21 private-data suites omitted from the internal extended command. The public
extended set also includes Explore navigation from the quick baseline, so all
quick checks belong to the extended public set. No suite internally skips an
assertion due to a missing model. The runner stops on a failure and writes
`build/public-test-results.json` with each completed suite and its duration.

The baseline covers hover/snap/history contracts, triangulation preparation,
lighting, saving, camera/navigation, visibility/list selection, Help/workflow,
application smoke, native format documentation and the actual About source
download with a clean byte-identical rebuild.

The extended public set adds synthetic SKP layouts, native Open/import/export,
build plates, wrapped texture, Chamfer variants, render/PNG contracts, object
appearance/locks, curved split surfaces/capacity, selection/transforms, Sketch
Editor, taper/twist, Mirror, multi-object Boolean cases, Carve Out, workers,
exchange/mesh import and Text. Most UI tests use a fixture DOM/WebGL; a pass is
not a real-browser layout, GPU, visual-quality or FPS result.

The shared performance notes refer to `test:hover` and GLES driver evidence
from the internal development project. Those GPU drivers are not included here;
the public hover checks are `node tests/hover-performance.mjs` after a build
(also included in both public sets). Keep those scopes distinct.

Private original-model replay is absent for selected import, texture, point/
edge editing, Merge Faces and Boolean suites. Their synthetic assertions inside
those mixed suites are also absent, rather than extracting a weaker test under
the same name. Public tests in other suites still cover related geometry and
workflow. Do not infer feature completeness from the suite count alone.

Shared geometry/worker/format changes require the extended public set and a
maintainer run of the full private project, as explained in `CONTRIBUTING.md`.
The private project and its original assertions remain unchanged.

The extended run can take many minutes; the wrapped Text seam regressions in
particular perform repeated complete geometric cuts. Use the quick baseline
for ordinary UI/documentation changes and choose additional coverage by scope.

## Optional independent STEP check

Run `node tests/exchange.mjs` after a build to create `build/exchange-fixtures`,
then `npm run test:step` with Python's OCP/Open CASCADE bindings installed.
OCP is not required for builds, public Node tests or the application.

## Generated evidence

Some complete original suites write synthetic outputs under `build/`,
`docs/verification/` or `examples/`. Build/evidence directories are ignored and
not distributed. Review any newly generated model before committing it. Do not
commit repeated benchmark logs, screenshots or distribution bundles to source
history. Use a reproducible generator and a short result summary instead.
