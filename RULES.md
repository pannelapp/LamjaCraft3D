# LamjaCraft 3D — Development Rules

These rules apply to new features, bug fixes, refactors, reviews, tests, UI work, and documentation changes. Their purpose is to keep LamjaCraft 3D understandable as it grows, prevent shape-specific exceptions from accumulating, and preserve clear architectural boundaries.

`docs/ARCHITECTURE.md` describes the system boundaries and invariants. This file describes **how the system should be changed**.

## 1. English is the project language

All new or modified project-owned technical content must be written in English.

This includes:

- source-code identifiers,
- comments and developer-facing messages,
- runtime errors and profiler labels,
- UI text, tooltips, titles, menus, buttons, status messages, and accessibility/ARIA text,
- system-generated object, face, guide, and feature labels,
- test names, fixtures, assertions, and benchmark labels,
- new documentation and changelog entries.

User-entered project names, object names, annotations, imported metadata, and other user content must **not** be automatically translated.

Persisted internal values should use stable English identifiers. Display text should not be used as a machine identifier when a stable enum/key can be used instead.

When an existing persisted value is renamed or translated, keep an explicit read-time migration/normalization path for supported older project files. Legacy-language strings are allowed only inside clearly named compatibility/migration code and compatibility tests; new data must be written using the current English form.

## 2. Solve the general geometry rule, not one example

When a bug appears in a specific model, first formulate the missing geometric or topological rule.

Good examples:

- “the sweep crosses an existing void and must be able to re-enter material”,
- “a terminal cap is only terminal when there is no shell farther along the sweep direction”,
- “two reconstructed vertices represent the same topological point when their real spatial distance is within the welding tolerance”.

Bad examples:

- “if the face has 48 segments and there is a circle on the side, do ...”,
- “if this face ID came from the circle tool, choose another algorithm”,
- “if the model resembles regression R47, skip this test”.

Shape-specific branches are acceptable only when the shape property is genuinely part of the mathematical operation, not because a particular UI tool happened to create the geometry.

## 3. One semantic operation, multiple allowed implementation paths

Fast paths, local B-rep operations, event resolvers, and CSG fallback may coexist. They are implementation paths for the same operation, not separate user semantics.

Before introducing a new fast path, it must be possible to explain why it is semantically equivalent to the general operation under its preconditions.

If that cannot be explained clearly, prefer the general path first.

## 4. Do not add fallback on top of fallback without cleaning up classification

When an operation family already has several event/fallback paths, the next bug fix should first consider whether the existing classification can be simplified or unified.

Before adding a branch to `moveFace`/sweep logic, answer:

1. Which general event type does this represent?
2. Does the same event already exist under another name or path?
3. Can it be represented as one explicit event result instead of another nested `if`/`catch`?
4. Which invariants make the path safe?
5. Which test proves that it solves more than one exact model?

If these questions do not have good answers, refactoring the event layer is probably better than adding another special case.

## 5. Expected geometry outcomes should be data, not exceptions

A geometric candidate that simply does not apply is normal control flow, not an exceptional failure.

Prefer explicit results that can distinguish cases such as:

- success,
- no event,
- invalid candidate,
- degenerate candidate,
- clamped,
- fallback required.

Use exceptions for unexpected failures, corrupted structures, and violations of internal invariants.

If a lower-level geometry library still throws for an expected candidate rejection, catch it at one narrow adapter boundary and convert it immediately to an explicit typed/result value. Higher-level event classification, fallback, and clamping code should consume that result rather than catch the same failure again.

Do not add broad or empty `catch` blocks around kernel logic without a concrete reason.

## 6. Magic numbers must become policy

New numerical multipliers, tolerances, probe distances, iteration limits, and preview-size limits must be named.

Values belonging to the same operation family should be grouped in a policy object such as `SWEEP_POLICY`, `GEOMETRY_POLICY`, or an equivalent structure.

Names should describe purpose rather than value. Add a comment or test explaining the numerical boundary when the reason is not obvious.

## 7. Preserve architecture boundaries

New features must use the existing boundaries:

- persistent document mutation → document command,
- low-level geometry → `geometryApi`,
- gesture/interactions → `ToolController`,
- snapping → `SnapEngine`,
- render/picking derived data → `SceneGeometry`,
- file-format migration → dedicated serialization/deserialization compatibility code.

Do not duplicate B-rep logic inside a tool, UI handler, renderer, or importer because it is locally convenient.

### 7.1 Shared interaction patterns must stay consistent

Tools that expose the same interaction pattern should follow the same gesture contract unless there is a documented semantic reason not to.

For example, when a tool supports both click → move → click and press-drag-release, both input styles should reuse the same preview/commit helper, cancellation behavior, and command path. Numeric entry must also commit through that same operation rather than a separate geometry implementation.

Do not fix an interaction inconsistency by adding a one-off `pointerUp` or placement branch when the behavior belongs to a shared gesture pattern. Add a regression that exercises the user-visible interaction contract.

### 7.2 Tool workflow and cancellation

Completing or rejecting an operation keeps the explicitly chosen tool active. Surface sketches do not automatically switch to Push/Pull. A ground profile is the explicit exception: its uncommitted height step temporarily activates Push/Pull, then returns to the originating drawing tool on completion or cancellation. Predefined 3D Shapes are already solids and stay in Shapes.

Escape consumes the innermost transient step before leaving the tool: numeric entry, camera navigation, an active gesture, or controller-owned partial state such as a measurement endpoint, texture-origin pick/area or Carve Out target. Escape while idle selects Select. Native dialogs own Escape while open, and a busy worker operation handles Escape as Cancel. Tool-specific partial state must declare its cancellation through the shared controller boundary.

An explicit toolbar or shortcut choice fully cancels unfinished work and replaces any temporary return destination. Orbit/pan preserves pending tool data. Undo/Redo clears transient previews and stale references while retaining the chosen tool (or the source tool of a temporary ground-height step). New/Open project resets to Select. These transitions must not add document history entries; only modeling commands do so.

## 8. The canonical B-rep remains the only geometric truth

Committed geometry lives in the B-rep. Render meshes, triangle caches, BVHs, preview meshes, snap caches, and tool-local helpers are derived state.

Derived state must be disposable and reproducible from the authoritative model.

Editable mesh import is a conversion into the canonical B-rep, not permission to add a second persistent mesh model. Imported exchange geometry must be validated before document commit. If an external mesh cannot be converted safely, reject it (or, if a future reference-mesh mode is added, keep that mode explicitly non-editable and separate from solid truth).

Never fix a modeling inconsistency by making rendering or picking disagree with the B-rep.

### 8.1 Boolean Combine and Group are different semantics

Boolean Combine changes geometry. It may commit only when its inputs reconstruct to one connected, valid manifold B-rep. Do not make Combine accept disconnected shells merely to make selection management easier.

A future Group feature is an organizational/document relationship and may contain separated objects without changing their solids. Keep these concepts separate in commands, persistence, UI, and tests.

## 9. Preview must not change the user's requested operation

Interactive preview may use cheaper implementation paths than commit, but it must represent the same requested operation and distance.

A preview optimization must not:

- silently change the requested distance,
- expose a different topology as if it were final,
- persist transient state,
- convert an internal preview limitation into a new user-visible parameter.

Where practical, tests should verify preview/commit equivalence for the same input.

## 10. New sketch tools should produce regions, not new feature systems

A new planar drawing tool should normally produce a planar region that the existing face subdivision pipeline can consume.

Do not create a parallel persistent feature graph merely because a new sketch primitive has different UI interaction.

Tool-specific construction data may be transient; the committed result should remain ordinary B-rep geometry unless a future feature system is introduced deliberately at the architecture level.

Sketch Editor may retain open strokes across gestures within its transient 2D workspace. Only validated closed contours enter the model through the ordinary face-subdivision command. Drafts, local sketch history, editor guides and editor measurements must not enter native files or model history. Preserve local Undo/Redo isolation and atomic insertion of all contours; do not introduce a persistent sketch dependency graph implicitly.

## 11. Default Delete remains conservative

Default Delete and selected-entity keyboard/property deletion may remove topology only when the model can preserve its geometric meaning without implicitly opening or deforming the solid.

Examples that may be dissolvable when safe include coplanar sketch boundaries and redundant collinear vertices.

Shape-changing face/edge/vertex editing must be implemented as explicit geometry operations rather than hidden inside generic Delete behavior. The explicitly requested **Edges · flatten / trim** and **Points · dissolve / trim** viewport options are opt-in exceptions: each is off by default, owns a dedicated geometry API operation and command, previews the checked shape/material change, and never falls through from a rejected edge/point to feature or object deletion. They do not change keyboard/property deletion semantics.

## 12. Persistent references must use stable identities

Selection, dimensions, annotations, history metadata, and other persistent references should use stable entity identities whenever possible.

A topology-changing operation should return enough mapping information to preserve references when stable identity can be determined. When a general rebuild/Boolean cannot provide a trustworthy mapping, the reference-owning layer must detach affected references deterministically to their explicit fallback representation rather than guessing a new target or leaving dangling identity.

Deletion may intentionally remove dependent annotations when that is part of the deletion semantic. Other topology changes should prefer deterministic fallback over silent data loss.

Do not rely on array order, display labels, localized strings, or incidental triangulation order as persistent identity.

## 13. TypeScript strict mode is required

The project compiles with `strict: true`, `noUnusedLocals: true`, and `noUnusedParameters: true`. New code and tests must keep these checks green; do not locally weaken compiler settings to make a change pass.

Prefer:

- explicit narrowing of `unknown`,
- typed result objects,
- discriminated unions for state/event variants,
- `null`/`undefined` handling at boundaries,
- narrow interfaces instead of `any` where practical.

Do not introduce new avoidable implicit `any`, unsafe casts, or unchecked nullable access.

## 14. Every bug fix needs a testable invariant

A regression test should capture the general property that failed, not only replay coordinates from one user model.

A useful geometry regression should normally assert one or more of:

- the resulting solid validates,
- requested distance versus clamped distance is correct,
- topology remains manifold,
- no artificial internal wall remains,
- preview and commit agree,
- stable identity mapping is preserved where required,
- serialization round-trips without changing meaning.

Keep the original reproducer when it adds coverage, but name the underlying rule in the test.

## 15. Add deterministic stress testing as the combination space grows

When many valid combinations of sketches, splits, sweeps, holes, and intersections exist, supplement hand-written regressions with deterministic generated cases.

Generated tests must use a fixed seed or otherwise be reproducible.

At minimum, stress tests should validate every resulting committed solid and report enough information to reproduce a failing case.

Random tests that cannot reproduce their failure are not acceptable CI tests.

## 16. Do not optimize without measurement

Keep correctness paths simple until profiling shows a meaningful bottleneck.

When adding a performance fast path:

- retain semantic equivalence,
- benchmark the relevant workload,
- keep a correctness fallback where appropriate,
- document the preconditions,
- add a regression if the optimization affects topology or numerical behavior.

Do not trade away a clear invariant for a theoretical micro-optimization.

### 16.1 Preserve measured performance contracts

Before changing hover/render feedback, snapping, geometry history, triangulation, sweep preparation or command validation/display installation, read `docs/PERFORMANCE.md`. Its contracts and regression map apply to future changes in those areas.

- Idle hover and compatible tool transitions must not repeatedly triangulate unchanged faces, rebuild static buffers or walk whole-model topology for metadata.
- Derived caches require complete dependency keys, explicit ownership/lifetime, correct invalidation and a correct miss path. Preserve unaffected object/solid identities and scene data; bound retained history views. Keep caches outside canonical B-rep, native files and authoritative history.
- Broad phases must include every candidate accepted by the exact predicates and fail open on uncertainty. Preserve candidate order, tolerances, source exclusions and query-local visibility policy.
- History must retain private detached geometry and content/mutation checks. Do not substitute live references or identity-only trust. External data retains checked decoding; failed commands restore complete state atomically.
- New changed solids still require complete validation. Reuse its computed mesh only after all changed objects validate and the command succeeds. Do not repeat that work solely for first display or install partial failed results.
- Deferred work must preserve every required witness/check once its preconditions apply. Explicit connected-result reuse must not change ordinary detached-copy ownership.
- Preserve deterministic work-count, equivalence, invalidation, fallback and Undo/Redo regressions. Extend them for new dependencies or numerical branches; never loosen assertions or skip tests to hide regressions.

Keep raw benchmark evidence with workload, version and limits. Distinguish measured remaining costs from hypotheses and CPU components from browser frames. Further optimization requires a concrete measured problem, not an obligation to implement every opportunity in the maintenance notes.

## 17. Dead code and obsolete paths must not accumulate

When a refactor makes a helper, branch, compatibility shim, or algorithm obsolete, remove it unless there is a documented near-term reason to keep it.

Compatibility code must be clearly marked as legacy/migration code and should have a defined reason for existence.

Do not keep two active implementations “just in case” when only one is part of the intended architecture.

## 18. Split large files by responsibility, not arbitrary size

A large file should be split when it contains distinct responsibilities that can have clear interfaces.

Do not split code merely to meet a line-count target. Conversely, do not keep unrelated tools or geometry subsystems in one file simply because they historically grew there.

A file boundary should make dependencies and ownership clearer.

## 19. Documentation describes the current state; history belongs in the changelog

`README.md` should explain what LamjaCraft 3D is and how to run/use the current project.

`docs/ARCHITECTURE.md` should describe current architectural contracts and invariants.

`RULES.md` should describe development rules and review expectations.

`CHANGELOG.md` should contain historical release/alpha changes.

Do not make current architecture documentation read like a chronological patch diary.

New documentation should be written in English. Existing historical documentation may be translated separately, but modified sections should move toward the current English-language policy rather than adding new Norwegian prose.

## 20. Minimum requirements before merging a geometry change

Before merging a non-trivial geometry change, verify:

- the bug/feature is described as a general geometric rule,
- the change respects the B-rep and `geometryApi` boundaries,
- no unnecessary shape/tool-specific branch was introduced,
- expected invalid candidates do not require broad exception swallowing,
- new numerical thresholds are named and justified,
- committed solids validate,
- relevant preview/commit behavior is covered,
- a regression test exists for a bug fix,
- `npm run typecheck` passes,
- `npm test` (the quick baseline) and the affected feature suite(s) pass,
- new or modified code/UI/test text is English,
- serialization compatibility is considered for changed persisted values.

### 20.1 Choose checks by the change

`npm test` runs the quick baseline: startup/application smoke, manual saving, camera views, visibility, contextual sidebar help and tool workflow. Run it and `npm run typecheck` for ordinary changes. Add the relevant `test:*` feature command when changing that feature.

Run `npm run test:full` when changing shared B-rep/CSG reconstruction, geometric tolerances, common sweep/event infrastructure, shared worker transport/lifecycle, project serialization or other boundaries used by many tools. Also run it at a substantial integration milestone or when focused checks leave a concrete cross-feature concern unresolved. An isolated feature change needs its focused regressions and the quick baseline; an unrelated UI, help, styling or documentation change does not require all geometry/stress suites.

Choose scope by the behavior and dependencies that changed, not by the file name or the fact that a new version, standalone HTML or ZIP is being produced. Adding a compatible parameter or request variant for one tool does not by itself require the full suite: exercise that tool's geometry, preview/commit, worker request/result, cancellation, stale-result and history checks. Escalate when the change affects common message dispatch, validation, transport, progress, cancellation, lifecycle, compatibility or other tools. Likewise, a tool-local Taper change is not automatically a change to the common sweep/event infrastructure.

Record the selected scope and its reason in the release verification notes. If a full run is planned, it already includes the quick baseline and feature suites; do not routinely run those separately immediately beforehand. Focused runs while investigating or fixing a failure remain useful. Repeat checks after changes that invalidate their earlier result. Preserve useful independent geometry and interaction regressions; reduce unnecessary invocation rather than coverage.

All existing regressions and deterministic stress cases remain in the full suite. Do not weaken assertions, remove coverage or add hidden skips to make the quick command shorter. See `docs/TESTING.md` for the commands and selection guide.

## 21. When in doubt

Prefer, in this order:

1. preserve a clear invariant,
2. make the general operation correct,
3. keep one source of truth,
4. make behavior deterministic and testable,
5. keep compatibility explicit at boundaries,
6. optimize measured bottlenecks,
7. add convenience behavior last.

A smaller, general, well-tested rule is preferable to a larger collection of patches that happens to pass today's examples.

## 22. Standalone source and license release contract

Every delivered HTML release must be generated by `npm run build`. Never hand-edit generated HTML or insert a source ZIP from another release. The builder must:

- compile both the application and embedded modeling worker with the existing strict TypeScript settings;
- require matching package.json and package-lock.json versions and the MIT application license;
- package current TypeScript inputs, the HTML template, necessary assets, build scripts, configurations, dependency lock, source-package README, AGENTS.md, development rules and license notices;
- exclude tests, fixtures, example models, historical verification data, the unused original large logo, node_modules and generated build/dist files from the embedded source package;
- expose only build and typecheck commands in the embedded package.json; keep test commands, tests and examples in the separate full development project;
- embed the source ZIP as inert data and provide an offline About download for the same visible version;
- include the full MIT notice with Arvid Mortensen's copyright and preserve third-party font notices in both the HTML and source package;
- use deterministic source ZIP ordering and timestamps, write identical standalone/index HTML, and fail on missing configured TypeScript inputs, inconsistent versions or unresolved template markers.

When changing this release path, run `npm run typecheck`, the quick baseline and the source-package regression. That regression must check the actual About download, ZIP integrity, scope/version/license, and rebuilding the extracted source into byte-identical HTML. Use the complete development project for tests; the embedded package is intentionally a buildable source distribution without tests. This release contract does not change native project serialization or model geometry.

### Native format documentation assets

Every release includes `docs/NATIVE_FILE_FORMAT.md`, its build-time renderer and the small `src/assets/native-format-sample.json` interoperability sample in the matching source package. This required documentation sample is distinct from excluded development example models. About must embed the canonical specification with its small complete sample and avoid document/history mutation. Keep the format documentation neutral and display credits, application description, file format, source code with its download button and licenses in that order. Update the reference when persisted fields or supported file versions change.
