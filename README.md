# LamjaCraft 3D

A small offline 3D workshop for direct face editing in millimetres. Draw regions,
Push/Pull faces, edit solids and export geometry from a single HTML application.

This public source package is based on **v0.9.174**. It contains the application,
build tools, documentation and self-contained public tests. Private model
attachments, diagnostic snapshots and the complete internal project archive
are excluded. See [Public test data](docs/PUBLIC_TEST_DATA.md).

## Build and open

Use Node.js 22.16 or newer and npm. Python 3 must be available as `python3` for
the ZIP/source-package regression. It is not needed to use the application.

```sh
npm ci
npm run typecheck
npm run build
```

Open `dist/LamjaCraft-3D.html` in a modern browser. No application server,
account or network connection is needed at runtime. Dependency installation
needs npm access or a populated local cache.

Every build also writes `dist/index.html` and a matching buildable source ZIP.
About includes an offline download of that exact source, the native format
specification and complete license notices. Generated files stay out of Git;
attach the standalone HTML to a GitHub Release for end users.

## Tools

| Group | Tools |
| --- | --- |
| Edit | Objects/Groups, Copy, Paste, Delete, Move, Rotate |
| Reference | Guide Line, Guide Circle, Measure |
| Sketch | Rectangle, Circle, Arc, Contour, Editor |
| Mechanical | Gear, Rack, Bolt Circle, Slot, Arc Slot, Thread |
| Solid | Shapes, Photo AI |
| Modify | Push/Pull, Chamfer, Text, Texture, Merge Faces, Carve Out, Split Plane, Mirror |
| Help | Help, About |

The built-in Help follows these groups; the ? buttons provide contextual
instructions. Curved forms are represented by editable planar facets.
Sketch Editor is a temporary 2D workspace: only validated contours inserted
into a face become model geometry. Modeling, Illustration and Presentation
provide different display styles; object shininess appears in Presentation.

Open/Save uses native `.lamjacraft.json` projects. Import accepts native files,
SKP, OBJ and STL. Closed imported solids are editable; open polygon objects have
limited editing. Export offers native JSON, STL, OBJ/MTL, faceted STEP and PNG.
STEP import is not supported. Photo AI prepares a prompt for an external AI
chosen by the user; LamjaCraft does not send photos to a service.

## Tests

```sh
npm test                 # 19 quick public suites, with one build
npm run test:public      # all 90 public suites, including the quick checks
```

The public suites retain their complete original assertions. Twenty-one other
suites need private uploaded models or runtime snapshots and are deliberately
absent. A public pass does **not** mean the private full regression set passed.
There is no `test:full` alias in this distribution. The private development
project retains those suites and their data unchanged.

GitHub Actions runs typechecks and quick tests for pushes and pull requests.
Use its manual **Run workflow** action for the extended public checks. This
workflow builds/tests only; it does not deploy or publish anything.

See [Testing](docs/TESTING.md), [Contributing](CONTRIBUTING.md),
[Architecture](docs/ARCHITECTURE.md), [Development rules](RULES.md),
[Performance maintenance](docs/PERFORMANCE.md), [Sketch Editor](docs/SKETCH_EDITOR.md)
and [Native format](docs/NATIVE_FILE_FORMAT.md).

## Publishing this package

Extract the ZIP and put the **contents of this folder** in the repository root.
Do not commit the ZIP itself as the source repository. Follow
[Publishing](docs/PUBLISHING.md) for Git/GitHub Desktop and release instructions.

## License

Application code: MIT, Copyright (c) 2026 Arvid Mortensen. See [LICENSE](LICENSE).
Embedded DejaVu outlines retain their own font notices in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and
[DejaVu license](src/assets/DejaVuSans-LICENSE.txt).
TypeScript is a build dependency, not a runtime dependency.
