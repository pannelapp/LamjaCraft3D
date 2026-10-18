# Performance maintenance and remaining opportunities

Status: 2026-10-18, based on v0.9.151–v0.9.157 measurements. The user considers interactive editing satisfactory. There is no required unfinished optimization; resume only for a reproducible slow operation. v0.9.158 adds documentation and source-package safeguards, with unchanged application TypeScript.

## Evidence and limits

The supplied model contains 303 objects and 112,870 faces. Its perforated board has 29,121 faces; a large cap has 661 holes and 29,119 boundary vertices. Splitting a document into objects does not reduce the work inside one complex face. Expensive nested searches and repeated derivation explained the observed growth; these measurements do not establish exponential complexity.

The latest actual-board measurement is an outward 0.25 mm Push/Pull in the complete document:

| CPU operation | v0.9.156 | v0.9.157 |
| --- | ---: | ---: |
| Prepared preview | 34.08 s | 0.39 s |
| Commit, history and complete changed-solid validation | 147.46 s | 6.25 s |
| First edited display-mesh access | 73.04 s derivation | 0.19 ms cached access |

Display-mesh preparation now occurs inside commit. The last row accesses that prepared mesh; it is not a rendered frame. Edited-board Undo/Redo took 0.69/0.66 s. Preview and committed canonical geometry match the previous version exactly; holes and modeling tolerances are retained.

These are individual Node CPU observations with stub DOM/WebGL and deferred rendering. They exclude GPU work, buffer upload and complete pointer-event/frame latency. Do not turn them into FPS claims or universal time thresholds. The original model is external and intentionally excluded from project/source archives. Its SHA-256 is `e5e75b74573ba1100a1cdb0d63a060da14f61fe6988c3cd86d178c9ba14d809b`.

The full development project contains detailed evidence under `docs/verification/v151` through `v157`, particularly `v156/RELEASE_VERIFICATION.md` and `v157/RELEASE_VERIFICATION.md`. Historical logs, fixtures and benchmark scripts are absent from the minimal source download. This maintenance document and the development rules are included in both distributions.

## Remaining work, if users encounter a problem

| Area and evidence | Next measurement | Possible approach and conditions |
| --- | --- | --- |
| Complex-face commit: measured 6.25 s; remaining time has not been fully attributed by phase. | Separate reconstruction, complete validation, history comparison/copy, mesh transform/install and first browser frame. | Remove demonstrated duplicate work. Consider a worker after measuring transfer/copy overhead; retain atomic commit, cancellation and stale-result checks. Complete validation must still finish before commit. |
| Repeated previews: one complex preview still measured 0.39 s; repeated gesture cost was not benchmarked here. | Cold/repeated previews, pointer scheduling, temporary allocation and changing distances. | Reuse immutable source-face preparation under exact solid/face keys. Coalesce superseded pointer requests and reject stale results. Preserve the latest distance, cancellation and preview/commit equivalence. Never reuse a result for a different requested edit. |
| History: capture/restore compares canonical contents linearly; new versions need detached copies. | Comparison versus copying, heap over repeated large-board edits, Undo branching and collection. | Persistent immutable maps or checked revision tracking could reduce work. First enforce every mutation boundary and prove private ownership/rollback. Identity alone cannot certify unchanged contents today. |
| Dense triangulation: this cap still rejects the compact attempt before existing slab fallback succeeds. Final component total: 0.90 s (0.28 s compact, 0.62 s slab). | Attempt/fallback costs, output size and allocation across varied faces. | A general proven early classifier or improved fallback might avoid rejected work. Preserve holes, winding, numerical behavior and determinism. Do not route by object ID, tool origin or a hole-count guess. |
| Large boolean/topology edits: plausible future cost, not established as the current dominant bottleneck. Outward Push/Pull does not measure through-cuts, Combine, Subtract or sketch subdivision. | A concrete slow edit, including intersection, reconstruction and validation stages. | Investigate conservative spatial broad phases, affected-region reconstruction or prepared inputs only where equivalence can be proved. Preserve manifold/connected-shell rules and general fallbacks. |
| Memory: caches and detached history intentionally exchange memory for less repeated CPU work. Retained bytes were not measured. | Heap, typed arrays/GPU buffers, cold/warm peaks and cleanup over edit/Undo/Redo/New/Open. | Tune budgets or add measured byte accounting. Eviction must derive correctly. Do not remove ownership copies or retain every preview/mesh indefinitely. |
| Browser first frame/visibility: full browser latency is outside the latest CPU benchmark. | Real trace of pointer handling, occlusion, uploads, allocation/GC and first paint on target hardware. | Optimize the measured stage; preserve shared static buffers, exact picking/occlusion and tool semantics. Stub-WebGL speed alone does not prove browser responsiveness. |

Changing native storage, simplifying holes, permanently triangulating faces or hiding geometry while editing is not required by current evidence. Those changes need separate product/geometry requirements and compatibility work. Acceleration data should remain disposable, rather than becoming a second persistent model.

## Contracts that protect the gains

`RULES.md` section 16.1 makes these review requirements mandatory. The complete project's `docs/ARCHITECTURE.md` describes implementation boundaries in more detail.

1. **Keep idle hover cheap.** Metadata labels, topology/BVH statistics and circular-center queries must not repeatedly triangulate faces or walk complete topology. Centers come from boundary loops. Hover-only highlights must not rebuild/upload static scene buffers. Compatible tools share buffers; cold Push/Pull → Rectangle → Circle transitions matter alongside warm hover. Share a lazy raw hit only within the current hover query.
2. **Invalidate by actual dependencies.** Read-only snap world snapshots require object identity, solid identity, object ID and exact transform. Aggregate snapshots also depend on ordered visible inputs. Geometry commands replace committed solids. Keep caches outside canonical data, native serialization and authoritative history; preserve unaffected meshes/BVHs during commands and history traversal.
3. **Use conservative broad phases.** Indexes shortlist; exact predicates decide. Perspective-pole crossings, unsafe/invalid bounds and uncertainty fail open. Restore original candidate order before source acceptance, deduplication and ranking. Guides/inference needing complete spans must retain them.
4. **Keep visibility reuse query-local.** Reuse exact world-coordinate physical visibility only within one synchronous query, with separate ordinary geometry/guide policies. Do not quantize coordinates or retain results across camera/document/preview changes. Push/Pull ownership/source exclusions stay outside this memo.
5. **Protect history ownership.** Opaque versions own private detached canonical data. Compare all canonical content and map order before sharing; do not substitute identity-only checks. Restore trusted internal versions without re-running geometry algorithms, while preserving checked external/legacy decoding. Preserve complete document/reference state, locked-object invariants, atomic rollback, redo branching and the 100-entry limit.
6. **Bound derived history retention.** Match exact geometry version and world transform. Never relabel a stale tagged mesh as a new version. Limits are 1,500,000 retained triangles, 2,000 records and two transforms/version; these are not byte limits and exclude active scene memory. Records omit canonical solids/version handles. Misses/oversized entries derive normally; remember existing views without forcing new ones.
7. **Preserve triangulation predicates.** The point tree filters only; active linked neighbors, clipping order, distance/inside/reflex tests and compact/slab fallback remain authoritative. Bounds must include fuzzy half-plane acceptance and floating-point error. Near-degenerate, non-finite and overflow-risk queries use linear search. Retain named numerical policy and exact-reference tests.
8. **Defer only irrelevant work.** Receiving-plane witnesses may wait until an opposing plane lies in the signed requested range. Once eligible, every original boundary and triangle-centroid witness is required. Do not replace material checks with sampled corners. Connected-shell reuse is an explicit one-component option; ordinary helper calls keep detached-copy ownership.
9. **Validate once and reuse safely.** Every new changed solid receives complete normal validation. `validateWithMesh` observes that validator's exact local mesh. Collect meshes without scene mutation; install matching object/solid/transform data only after all changed solids validate and the command succeeds. Failure rolls back and installs nothing. Avoid another validation/triangulation solely for the same first display.
10. **Measure work and meaning.** Keep deterministic work-count/equivalence tests, cold/invalidation cases and fallback coverage. Do not assert hardware-specific milliseconds in CI or reduce coverage to claim speed. A new cache needs documented ownership, complete keys, lifetime/eviction and a correct miss path.

## Regression map and measurement workflow

Use the complete development project for tests. Minimal embedded source exposes only build/typecheck.

| Changed behavior | Existing targeted checks |
| --- | --- |
| Hover metadata, static buffers, shared tool transitions | `npm run test:hover`, `npm run test:sketch-hover` |
| Snap geometry keys, spatial filtering, visibility lifetime | `npm run test:snap-cache`, `npm run test:snap-spatial`, `npm run test:snap-visibility-cache`, `npm run test:snapping` |
| Private history, invalidation, bounded retained views | `npm run test:history` |
| Conservative ear search, exact reference output | `npm run test:triangulation-search` |
| Deferred witnesses, connected reuse, validation/display installation | `npm run test:face-edit-preparation` |
| Maintenance document/rules in matching source download | `npm run test:source` |

Select scope using `RULES.md` section 20.1. Ordinary changes need strict typechecking, quick baseline and affected suites; common geometry/sweep/serialization/worker boundaries need the full suite. Full includes baseline/relevant regressions: avoid redundant runs and never report quick as full.

For a future slow operation:

1. Record operation, exact source hash, face/edge/hole/triangle counts, requested distance, app/runtime/browser and cold/warm state. Preserve the reproducer outside public archives where appropriate.
2. Trace the browser interaction, then isolate CPU phases. Include validation/history in commit costs. Separate mesh preparation from cache access and actual painting.
3. Compare the same source/operation before and after. Check distance, preview/commit agreement, unchanged source, complete validation, independent volume/geometry where applicable and exact Undo/Redo. Add a deterministic regression for the general property.
4. Keep raw results in a new version-specific verification folder; never overwrite historical measurements. Observe cold and warm behavior and report variability for performance claims.

Example component commands after `npm ci` and `npm run build` (replace the external input path):

```sh
node tests/face-triangulation-benchmark.mjs /path/model.lamjacraft.json docs/verification/current/face-triangulation.json
node tests/face-edit-benchmark.mjs /path/model.lamjacraft.json docs/verification/current/face-edit.json
node tests/history-benchmark.mjs /path/model.lamjacraft.json docs/verification/current/history.json
```

These scripts target the supplied workload, not arbitrary models. Face/history scripts accept `LAMJACRAFT_BENCH_ROOT` for another already-built version. Default input validation is normal; diagnostic `--reuse-validated-source` is restricted to the exact previously validated hash and must never become a production shortcut. The face-edit script's extra board Undo/Redo timing block currently runs only for v0.9.157: explicitly adapt that comparison guard on future releases before claiming those timings were rerun. R257/R259 cover history/cache correctness independently of that historical timing block.
