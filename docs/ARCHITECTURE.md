# LamjaCraft 3D — Architecture Contract

This document describes the **current architectural contracts** of LamjaCraft 3D. Historical changes belong in `CHANGELOG.md`; development/review rules belong in `RULES.md`.

An architecture contract may change, but the change must be explicit, tested, and documented. A local bug fix must not silently redefine these boundaries.

## Transient 2D sketch workspace

Sketch Editor is a ToolController-owned session on a selected planar solid face.
Its open strokes, local history and construction aids remain outside the document.
SnapEngine handles 2D endpoint/edge/guide snapping. geometryApi validates closed,
non-intersecting contour graphs; Return stages mouse placement on the unchanged
source support. A document command inserts all contours through existing face
subdivision, with normal full validation and atomic history/rollback. Native
serialization and the canonical B-rep contract are unchanged. No persistent
sketch graph or constraint solver is implied. See `docs/SKETCH_EDITOR.md`.

## Text geometry boundary

`03_text_font.ts` contains three generated, licensed Latin-1 vector glyph subsets, shared by main and worker builds. `03_text.ts` converts quadratic contours with a named model-space error/complexity policy, classifies nested material/hole regions and sweeps planar footprints normal to their support plane using the existing region-prism/CSG construction. A complete-footprint check includes segment crossings, boundary clearance and source openings enclosed by glyph material; unsupported placement and excess foreground boundary comparisons are rejected before Boolean work. The prism starts exactly at the source plane: no overlap slab may add behind a thin sheet or cut above the requested face into a nearby overhang. Canonical validation and a single connected surface are required. Font single-point zero-area contours are excluded by the reproducible generator because they have no painted outline.

`03_text_curved.ts` derives a connected front-facing chart from canonical half-edge adjacency, bounded by projection/neighbor cosines and face/work/vertex budgets. Projected source triangles must not overlap. The complete glyph footprint fits the chart perimeter/holes before per-face clipping. Glyph triangles (with counters already removed) intersect projected source triangles; oriented boundary assembly reconstructs per-face material regions before simplification. Preview and commit use this same deterministic footprint. The common placement-normal depth vector translates every roof point; shared source seams therefore coincide exactly at both levels. The surface rebuild keeps each face complement, translated letter roof and perimeter/counter walls, omitting internal facet walls. An inclusive triangle-contact check rejects both crossings and exact terminal contacts with retained surfaces outside the single-valued chart. Untouched chart neighbors may meet the footprint at depth zero; unchanged projection coordinates and the single-valued chart rule out later collisions there. Existing surface-layer checks also reject displaced caps outside the intended material layer. The canonical constructor and connected-shell validator own commit validation. Size/depth are projection-plane/placement-normal measures, not intrinsic arc-length/per-face-normal measures. This local chart also handles doubly curved and imported surfaces without primitive provenance; it does not imply full-circle wrapping or arbitrary folded charts.

`06_tool_text.ts` owns transient placement/settings-derived wire data only. Snapping reuses `onFacePoint`/SnapEngine; freeze/reposition and explicit Apply are separate from a drag gesture. Geometry runs through `geometryApi.faceTextAsync` in the existing embedded worker. `04_text_model.ts` commits the checked result through one `face-text` document command, preflighting exact source identity, document revision, transform, visibility, grouping and edit locks. Shared topology mapping handles dependent references. Cancellation/error/stale results and jobs whose text settings/placement changed never become document geometry. Font/text/layout data are not persisted; saved letters are ordinary B-reps and native format remains unchanged. The Text controller defaults to automatic local surface handling and can explicitly request cylindrical wrapping. A complete footprint that fits one face uses the original planar CSG operation. Otherwise it derives the connected chart; a coplanar footprint still uses CSG to preserve thin-sheet through-cuts and Boolean behavior, while a genuinely curved footprint uses the checked local skin operation. Explicit planar/curved requests and the original omitted-parameter default remain internal geometry API compatibility paths, without a Flat/Curved UI setting or new persisted model feature. The curved path follows a local projected surface chart; text regeneration remains deferred; cylindrical wrapping uses the separate intrinsic chart described below.

`03_text_cylinder.ts` recognizes a complete straight convex side shell for a chosen object-local axis using half-edge adjacency, a projected cross-section hull and constant-radius/normal checks. It creates an isometric affine chart on every side panel: horizontal distance is cumulative actual facet length and vertical distance is axial height. Periodic copies of the same glyph triangles cover the closure seam without duplication or angular width distortion. Complete clipped area and physical-edge clearance checks reject missing material and caps/openings. Full-turn fitting adds equal spacing to character advances; glyph outlines and cap height remain unchanged. Four centered lines share chosen font metrics and baseline spacing.

Cylinder footprints and local curved footprints share the checked `applyTextSurfaceSkin` boundary for source complements, retained-wall contact/clearance, canonical reconstruction and single-shell validation. Cylinder roof offsets satisfy each facet's normal depth with matching adjacent-edge miters; affine interpolation preserves shared seams. Nonplanar slanted outline walls are triangulated; the independent volume test bounds their deviation from the exact bilinear strip integral. Cylinder-specific clipping, source-face, vertex, inward-radius and generated-face limits are named in `CYLINDER_TEXT_POLICY`. No B-rep/CSG tolerance, shared worker transport or native format is changed. New optional Text parameters travel in the existing `face-text` worker request and command metadata, with existing stale-setting guards.

## 1. Authoritative model

The authoritative geometry of each model object is one local polyhedral B-rep containing:

- `Vertex`,
- `HalfEdge`,
- `Loop`,
- `Face`.

Object translation/rotation belongs to `ModelObject`. UI, rendering, picking, or export code must not maintain a second authoritative world-space solid.

Rotate defaults to Picked face. Its World XY/XZ/YZ alternatives use a named mapping to positive global Z/Y/X normals, keeping the object origin or group bounds center as the pivot. Move labels its existing free-drag mode XY; its transient mode key and feature-snapping contract are unchanged.

Delete has a dedicated default-off Points · dissolve / trim category. `03_delete_point.ts` removes exactly one canonical vertex, shortens its incident outer loops without moving retained coordinates, removes incident triangle faces that collapse, and traces the unmatched directed edges of the retained face graph. A single planar closing boundary becomes a cap; no remaining gap is a redundant-point dissolve. All other source vertices must remain used. A planar triangle fan can collapse back to one logical face. Convex cuts remove measurable material; dissolves/planar flattening conserve volume within the named numerical budget. Objects with multiple connected surface components (including enclosed cavity shells), real hole-rim points, concave/material-adding corners, multiple/nonplanar boundaries, self-crossing/touching loops, holes reached by a cut and crossing/contacting caps reject. Retained vertices outside the cap loop may not touch the new cap, including a single-vertex tangency. Canonical closed validation and Float32-safe export precede success.

`06_tool_delete_point.ts` defers the bounded geometry check until after hover, caches the exact candidate and guards source identity, document revision, transform, checkbox, tool, visibility, grouping and busy state. The renderer derives buffers only from that current checked solid, with green cap/amber shortened faces. Pending/rejected point clicks do not fall through to other categories. Dimensions/guides/groups retain their existing priority; an enabled Point pick precedes edge/feature/object picking. Commit uses one `delete-point` command with exact retained vertex/directed-edge topology mappings. Removed anchors freeze at their source world position. Mode/settings/tool/document changes discard pending preview work. Keyboard/property Delete is unchanged.

`POINT_DELETE_POLICY` bounds 2,000 faces, 1,000 vertices, 20,000 half-edges, 2,000 surface triangles and 100,000 boundary/surface comparisons. These match the existing interactive point/edge check scale. Material-difference acceptance uses the edge-trim family's 1e-8 absolute/relative volume budget; geometric plane/topology/minimum-area thresholds remain unchanged. The closing cap alone needs a surface-crossing test: retained outer polygons pass convex-corner, winding, simple-loop and hole-containment checks, so they only lose material on their unchanged source planes. This API uses the existing point-move triangle crossing predicate without modifying it, shared reconstruction, worker protocols or serialization.

Move defaults to Object and has an exclusive Point alternative. `06_tool_move_point.ts` stores one canonical vertex ID, immutable source identity/revision/transform, a requested world target and a derived candidate. The geometry API prepares incident boundary-conforming indexed triangles in `03_move_point.ts`. Moving a corner copies its local coordinate exactly, retains every other original coordinate/ID, keeps still-planar logical faces and persists warped faces as planar triangles. It rejects triangulation needing synthetic boundary vertices rather than changing neighboring edge ownership. Source face properties and IDs are retained wherever the logical face remains; the first replacement triangle retains its source face ID. Stable retained vertex/edge topology mapping keeps passive dimension anchors attached.

Pointer targets receive immediate gray guide-edge feedback. Full validation is deferred until a 75 ms pointer pause, based on measured dense imported-cap checks; numeric preview and final commit validate synchronously. Source/revision/transform/visibility/group/busy guards prevent stale commits. Pending candidates never become document geometry. Render buffers derive only from a current validated result, and commit flushes the latest target before applying that exact candidate through one `move-point` document command. Cancellation clears pending work without document changes. Camera resume rebases pointer constraints while retaining the world target. Object/group rigid Move remains on its existing command path.

Named point-edit work ceilings bound faces (2,000), vertices (1,000), half-edges (12,000), triangles (2,000) and triangle comparisons (100,000). These are interactive-work limits, not a changed geometric tolerance. Existing plane/topology/minimum-edge/minimum-area policies govern validity. A 1e-9 mm movement floor avoids empty edits below the existing minimum-edge resolution; 4 px separates a click from drag and the axis-ray denominator guard avoids end-on axis division. Crossing checks cover moved triangles against the resulting surface; canonical validation and Float32-safe closed export are required. Native serialization, geometric tolerances and worker payloads are unchanged.

Object/group face-plane rotation freezes one world normal and one outer-boundary center from `geometryApi.face`. The Rotate ToolController previews a rigid transform from immutable gesture-start transforms; each group member receives the same world-axis rotation for both its position and orientation. Shared math composes this rotation with the stored Rz × Ry × Rx frame and handles Euler gimbal poles. Commit restores the preview first and uses the existing object/group document transform command. Cancellation, mode changes and document changes drop the transient face frame; camera navigation preserves/rebases it. Rendered face outlines/rings are derived overlays, not construction geometry or a persistent face reference.

Faces may be concave and may contain hole loops. Every committed replacement solid must validate as a closed, consistently oriented B-rep before the command can enter history.

The following are derived state, not model truth:

- render meshes and WebGL buffers,
- triangulation,
- BVHs and picking acceleration,
- snap caches,
- preview meshes/solids,
- STL export meshes,
- transient CSG/BSP structures,
- hover and selection visuals.

Derived structures must be disposable and reproducible from the document/B-rep.

### STL cleanup at the conversion boundary

STL decoding and welding classify redundant input triangles before reconstruction: zero-area triangles within the named coordinate-noise budget, triangles collapsed by existing vertex welding, and identical welded vertex triples are discarded with counts. Small positive-area triangles outside that budget are rejected. OBJ retains strict triangle conversion.

If ordinary duplicate cleanup leaves non-manifold edges, STL conversion classifies complete planar contact sheets. It cancels unique opposite directed boundaries or a single branch sheet whose entire perimeter is covered twice by the remaining surface. Branch edges separate sheet ownership before orientation, including incorrectly wound internal walls. Cleanup must yield a closed exterior after boundary seam conformance. The STL-only separate-parts option restores each proven interface to exactly two adjacent independently closed parts and checks preserved material volume. Counts are reported separately from ordinary duplicate removal; OBJ remains strict.

Contact classification and part separation share a temporary segment AABB index. Its padded overlap query is a conservative prefilter for the existing collinearity/overlap/containment predicates, including long edges with both endpoints outside a query segment. Candidate order remains the input order. Geometric tolerances and edge-comparison ceilings are unchanged: only spatially relevant candidates consume comparison budgets. The index is derived from staged mesh edges and never becomes document truth.

The shared kernel `conformTriangleMeshBoundaries` reconstructs only unmatched triangle boundary edges at existing boundary vertices. Export requires a closed result; import permits inspection of remaining openings before explicit planar cap repair. A named seam policy and import triangle budget bound subdivision. Cleanup reports its changes but never commits input meshes or caps openings. The reconstructed solid must pass the ordinary B-rep validator and exportability checks before the existing staged import command can add it. Project format and kernel tolerances are unchanged.

### Planar STL boundary reconstruction

`stlPlanarGroups` admits opposite-facing neighbours on the same plane using the unchanged angle, sign-adjusted offset and source-point planarity budgets. `03_stl_planar_merge.ts` cancels only shared indexed triangle edges inside each connected planar group. This removes coplanar zero-thickness folds without projecting vertices. The largest surviving loop determines the face normal and material winding, independently of seed triangle order; hole loops remain opposite. Accepted indexed fold merges emit `planar-fold-merged` diagnostics. Distinct surfaces separated by finite thickness are not flattened. Remaining directed source edges must form disjoint simple loops with one outer boundary and contained holes. Collinear boundary subdivisions are retained; interior vertices may disappear only when they cease to belong to any boundary. No points are projected, averaged or inserted. Every source vertex in the group must fit the resulting outer-boundary plane within the unchanged `TOL.plane` budget. Ambiguous or pinched boundaries remain triangles.

All candidate regions are first constructed through the ordinary canonical constructor and checked for source-volume preservation and closed exportability. If this fails, recovery tries blocks against the last validated indexed result, splitting only rejected blocks. Named check and triangle-visit limits bound recovery; exhausting the budget retains a previously validated result. The existing polygon reconstruction can simplify collinear subdivisions that the indexed representation preserves; its independently validated result remains eligible when it has fewer faces and preserves source volume. Both are implementation paths for the same conversion, not a second geometric model or relaxed acceptance. Cancellation still terminates the existing worker, and only the existing staged document command commits. OBJ conversion shares the same shell reconstruction boundary.

### Explicit selected-face merging

`03_merge_faces.ts` owns one bounded local operation: replace a connected selection with one face on a selected supporting plane. The reference is the largest selected face unless explicitly chosen. Original shared-edge ownership determines the outer/hole loops; pinches, disconnected selections, multiple outer loops and selections bending beyond the same-side policy are rejected. No edges are split by proximity.

When adjustment is enabled, each surviving boundary vertex is solved against the reference plane and every incident unselected supporting plane using rank-tested orthogonal constraints. The closest feasible common point is used within the requested movement limit. All other points remain exact. The operation keeps surrounding planes within the existing face-planarity budget, checks local boundary crossings/touches and hole containment, then requires canonical validation and closed exportability. It does not propagate deformation or relax global tolerances. With adjustment disabled, vertices stay fixed and source material volume must remain within the named unchanged-volume budget. Expected rejection is typed data; the canonical constructor/exporter's throwing contract has one adapter.

`geometryApi.mergeFaces` supplies the kernel result and topology mapping. Retained vertex identities follow their moved corners; source boundary edges map by directed vertex identities, removed interior edges detach, and selected face references map to the surviving reference face. The existing annotation owner performs deterministic fallback for removed identities. Unselected face IDs and metadata remain intact.

`mergeFacesToolController` owns transient selection and the validated result preview. Preview never swaps document solids. Rendering uses `SceneGeometry.previewMesh` for the visible result while viewport clicks during preview return to source selection before accepting another face. Apply uses that exact candidate through `applyPreparedMergeFaces` and one document command, with source identity/revision/settings guards. Tool switches, Escape, history and New/Open use the common cancellation boundary. The operation adds no worker protocol or persistent format; explicit size/intersection limits bound foreground work.

### Guarded derived mesh retessellation

`solidMeshLocal` keeps ordinary triangulation unless microscopic ears coincide with non-manifold edge incidence after the existing derived-vertex weld. Only this topology failure can select the existing stronger ear filter; valid fine features and ordinary open T-junctions keep their original path. `solidMeshRetessellation` adapts tessellator/conformance exceptions to an explicit candidate result. A candidate must conform into a closed triangle mesh, have finite positive signed volume and differ from the ordinary mesh by at most the named absolute/relative material budget (1e-8 mm3 or 1e-8 of reference volume). Float32 export additionally rejects triangles that degenerate after coordinate conversion. A rejected candidate preserves the ordinary result; existing import/export validation decides whether it is usable.

Rendering/picking, volume validation, OBJ/exchange consumers and STL export reuse the same shared derived mesh choice. Canonical vertex positions, face IDs, loops and half-edges remain unchanged. The stronger filter uses the existing 1e-5 mm2 double-area threshold; canonical welding, planarity and import tolerances are unchanged. This is geometry classification, without STL metadata, face counts or fixture-specific branches.

### Read-only object integrity inspection

`02_object_check.ts` inspects the actual runtime graph and reuses `validateSolid(..., false)` with finite-coordinate/plane and finite-volume guards. It does not serialize/reconstruct or conform seams: reconstruction could conceal the very broken links being inspected. The explicit result distinguishes passed, failed, and incomplete checks. An exception is converted at this inspection boundary to an incomplete report.

`geometryApi.checkObjectAsync(...)` exposes inspection through the existing embedded worker transport. The source graph is transferred by structured clone; the response contains a report, never replacement geometry. Cancel terminates the worker. The UI verifies source-solid identity and document revision before showing results and does not enter the command/history boundary. A successful report describes the current validator's coverage, not an exhaustive surface self-intersection test or a prediction of future operation success.

### Build-plate reference ownership

`ModelDocument.buildPlates` stores up to 128 named, axis-aligned rectangular printing footprints with stable IDs, width/depth, center X/Y, color, opacity and visibility. Z is always zero. They are visual references, never `ModelObject`, `EntityRef`, construction guides, B-rep faces or export geometry. `04_build_plates.ts` owns validation and Add/Edit/Delete document commands. Snap candidate collection, SceneGeometry picking/BVHs, camera Fit and exchange export lists consume model objects independently of these references.

`05_build_plates_render.ts` derives disposable fill/outline buffers from visible references and caches their values. The renderer uses alpha blending, draws references before model solids, disables depth writes for those reference draws and restores blend/depth/opacity state afterward. Even references crossing an object cannot hide its visible faces or modify visibility-based snapping. Hidden plates and opacity-zero plates produce no draw calls.

`06_build_plates_ui.ts` owns a native modal dialog and transient plate/form selection, separate from modeling selection and tool state. Add places the first plate at the origin and later plates beside the rightmost footprint by the named placement policy. Apply validates all fields before one command; unchanged settings add no history. Opening uses the shared document-change teardown to restore unfinished transform previews and cancel transient tool steps while retaining the chosen/source tool, before any plate command captures history. Busy guards prohibit mutation during worker operations. Plate-only documents receive New replacement confirmation.

Format 7 writes optional `references.buildPlates` only when nonempty. Missing references are compatible empty data; malformed or duplicate IDs, invalid finite bounds or properties, and over-capacity arrays are rejected before project replacement. Snapshots include references and ID allocation for rollback/Undo/Redo, including ordinary model commands. New clears references; Open replaces them. Photo AI append preserves the destination references and appends only its documented modeling entities. Geometry export never serializes footprints. References add no kernel or worker protocol path.

## 2. Geometry semantics

### 2.1 `moveFace` is one operation

`moveFace` is the semantic operation for moving a planar logical face region along its normal.

- Positive distance adds swept volume.
- Negative distance subtracts swept volume.
- Concave faces, faces with holes, and faces created by previous sketches follow the same semantic operation.
- Provenance, nesting level, or the UI tool that created a face must not select a different user-visible modeling meaning.

Direct half-edge updates, neighbor-plane intersections, embedded terminal handling, and similar paths are optimizations/event resolvers. They are valid only under preconditions that make them semantically equivalent to the general sweep.

### Tapered face and ground sweeps

`03_taper_sweep.ts` owns two explicit section laws for convex/concave planar material boundaries, including holes. Proportional uses a common positive scale about the original material centroid, calibrated by the farthest outer vertex radius: `scale = 1 - abs(distance) * tan(angleDeg) / radius`. All outer/hole vertices interpolate the same factor, preserving their ratios and relative placement. Edge angle retains the earlier uniform perpendicular material-boundary offsets. Both laws share interval validation, cap triangulation, preview sections and the loft/Boolean implementation. In Edge angle, adjacent shifted edge lines intersect at the end-section corners. The setback is `abs(distance) * tan(angleDeg)` and the end section translates by the signed distance along the normal. Directed edge length, oriented area and self-intersection checks validate the end profile. Because every scaled or offset edge stays parallel, affine vertex-to-edge distances locate all nonincident boundary contacts across the complete offset interval. Hole/outer and hole/hole contacts, edge collapse and other topology-changing offset events are rejected before loft construction. A named policy bounds angle, vertex/face count and corner miter ratio. Preview wire and closed/open loft use this same layout. For combined Twist, interpolate the tapered boundary positions and rotate each section about the original material centroid using the existing angular bands. Centered four-triangle patches avoid a diagonal handedness bias. Re-triangulate the final tapered cap domain, including holes, rather than reusing concave source cap diagonals. Every new side/start-cap receives a unique face hint reserved against all source IDs; the moved end cap retains the selected face ID. Repeated pulls cannot steal source identities.

Zero taper delegates to the existing Twist operation, which delegates to ordinary `moveFace` when both angles are zero. A positive sweep from a global supporting plane lies entirely outside the source half-space, so replacing that cap with the open loft is exactly its Boolean union. Other Add/Cut operations use a closed loft through existing CSG reconstruction and validation. A negative sweep is subtraction clipped to existing material, not a deformation of the entire source. Ground Taper reuses a validated cap from `groundTwistSource`, translates its whole closed loft to z=0 and never commits the seed prism.

`geometryApi` exposes layout previews and typed `face-taper` / `ground-taper` requests through the existing worker transport. Shared Push/Pull and ground-height controllers own transient angle/draft state. Both angles may be nonzero; the existing typed Taper request carries optional `twistAngleDeg` and `taperMode` fields. Omitted modes retain `edge-angle` for legacy kernel/worker callers; the UI explicitly supplies its Proportional default. Command metadata records the chosen mode. Final validated geometry commits through the protected `move-face` or shared prepared ground command; source identity, document revision, visibility, grouping, locks and captured settings guard stale results. Face Taper also snapshots the object transform; ground sweeps check profile contents before committing. Pattern results are accumulated sequentially and committed atomically. The existing splitter/reference mapping handles separated results. Modes and angles are command metadata and transient settings; canonical format-7 geometry remains the persistent representation.

### Twisted face sweeps

`03_twist_sweep.ts` owns the rotational sweep of an arbitrary planar face region, including concave boundaries and hole loops. The face's signed area centroid fixes the local rotation axis. Every sampled section applies the same rotation about the outward face normal plus linear translation along that normal. A named policy bounds angular band size, total angle, and generated geometry. Centered four-triangle side patches avoid a diagonal choice causing handedness/volume bias. The same layout and point transform generate the lightweight wire preview and final facets.

Zero twist delegates to the existing ordinary sweep. For a positive sweep whose starting face plane is a global supporting plane of the source, all added material lies outside the source half-space. Replacing the selected cap with the open loft and its end cap is therefore equivalent to Boolean union. Original face identities are retained; new facet hints reserve all source IDs, including the moved cap, so repeated twists cannot steal an existing ID. R165 compares this attachment with Boolean union on identical facets. General Add and negative Cut use the existing CSG/reconstruction/validation boundary. Twisted requests do not reuse the straight sweep's clamping/event classifications or silently alter the angle/distance.

`geometryApi` exposes synchronous kernel access, wire preview, and a cancellable embedded worker job. The Push/Pull controller and panel Apply use the same worker/commit helper for nonzero twist. A source-identity-guarded prepared document command commits the validated result once; worker failures and cancellation never enter history. The wire preview depicts the requested sweep, not a claim that the final Boolean already validates. Existing solid-preview behavior is preserved for zero twist. The persistent model remains the canonical faceted B-rep, with twist parameters recorded in command history rather than a separate feature system.

Ground sketches reuse the face sweep’s cap triangulation, signed area centroid, angular bands, point transform and side facets. `groundTwistSource` provides a validated planar cap; `buildGroundTwist` translates the closed loft to z=0 and commits none of the seed prism. A dedicated ground-twist request uses the existing embedded worker result/cancellation transport. Ground ToolController preview exposes the same transformed sections through geometryApi; zero angle retains the ordinary ground prism path. Pattern profiles are generated sequentially, then one prepared document command commits every validated solid under a document-revision guard. Cancellation, failure or changed draft settings preserve the uncommitted draft; completion clears the busy state before returning to the source drawing tool. Twist angle is transient UI state and command metadata, not a new persistent feature representation.

### Keyboard modifier routing

`handleApplicationKeyDown` owns global routing. Explicit Ctrl/Cmd document commands are matched before tool input (Save/Open and Duplicate/Redo without Shift/Alt; Undo/Redo with Z permits the documented Shift form). Unhandled Ctrl/Cmd/Alt combinations return before numeric and controller dispatch. Numeric input may consume Shift-required symbols/separators; other shifted letters cannot select tools, Move axes or Fit. Uppercase keys from Caps Lock remain valid unmodified letters. Composing text events are ignored. Existing focus/dialog/busy/Escape ownership remains unchanged. These transitions do not mutate document geometry or create command history.

### Gesture-relative numeric distances

Move Object/Group and Point derive a signed world-axis direction from the current delta; XY normalizes the current vector. A locked axis with no meaningful delta keeps its positive world direction. Numeric seed stores this unit vector and axis on the transient pointer, and preview/commit multiply the typed distance by that fixed vector. Ordinary mouse updates discard the cache; numeric mouse updates preserve the typed candidate. Point uses the same direction derivation before its existing prepared reconstruction.

Face Push/Pull captures a numeric sign from `requestedDistance`, falling back to `distance` only when no request exists. The requested value is important when a live candidate is unavailable and the last drawable candidate is on another side. Direct numeric preview/commit multiply by the captured sign before calling the existing canonical signed-distance path. The sign stays fixed during number editing and camera navigation; a new entry reseeds it. The panel's absolute signed face distance, positive ground height, Guide offsets and rotation/twist angles retain their separate contracts. All direction fields are transient; commands record final world transforms or actual signed face displacement. Geometry, tolerances, worker protocol and format 7 are unchanged.

Rotate stores a transient numeric sign when entry begins, using the current signed angle or the raw pointer angle when angular snapping still displays zero. World-plane gestures now retain their raw angle alongside face-plane accumulation. A last meaningful pointer sign survives camera rebasing when snapping still displays zero. Direct numeric preview/commit applies the captured sign through `previewRotateAngle`; the absolute panel and underlying rigid transform command retain their existing semantics. Mouse updates discard the sign cache, numeric updates preserve it, and a new entry reseeds. Camera suspension carries the same pointer/sign; cancellation and plane changes drop it. No sign fields are serialized.

`rotationDisplayAngle` derives a signed one-turn remainder for status, inactive angle field and the face-plane marker only. `rawAngle`/`numericAngle`, rigid transforms and numeric-direction seed retain their accumulated totals. Focused input and the direct-entry buffer remain literal. Multi-turn camera rebasing, commit and history therefore keep their existing paths.

`moveGridDelta` quantizes mouse displacement using the existing `snapValue`/`gridSnapValue` adapter and selected mm step. World axes are already constrained before rounding; XY rounds components independently. Object/Group and Point call it only for ordinary mouse motion. Feature snaps return their exact target first; numeric preview/commit use exact input. A last meaningful raw delta supplies the numeric direction when a grid step still displays zero. Off-grid origins and group-member spacing are preserved. Point receives the snapped world target before its existing prepared reconstruction; no canonical rounding or geometric tolerance changes occur.

### Object selection frames

`06_tool_selection.ts` owns model selection click/drag/release state, filtering, modifiers and cancellation through ToolController. “Objects and Groups” is the default filter; “Objects” and “Groups” are the two alternatives. Dedicated editing tools retain explicit face/edge/point picking. A five CSS-pixel drag threshold distinguishes a click from a frame. A frame queries once on release; pointer motion draws a translucent overlay without repeatedly querying complex geometry. Selection changes are transient and do not create modeling commands.

`04_scene_selection.ts` owns the derived screen-area query. It consumes cached world meshes from `sceneGeometry.mesh`, clips crossing triangles to the camera near/far planes before projection and intersects convex screen polygons with the viewport-clamped rectangle. Triangle intersections, rather than object bounding boxes or frontmost ray hits, define through-selection membership. Deliberately hidden objects are filtered before querying. Render caches and canonical solids are unchanged.

Click and frame targets follow the same filter. Objects retains explicit individual references and visible IDs; the other modes expand any hit group to its complete membership, including hidden members, and Groups-only excludes ungrouped objects. Modifier clicks toggle complete target units; modifier frames add units. A filter change cancels a frame before reinterpreting the retained model selection. The filter is transient UI state. Hover uses the same object/group resolver and bypasses automatic group promotion only for explicit Objects-mode feedback; editing tools retain their existing guards. History uses the existing reference/ID fields and native project versions are unchanged.

`removeSelectedObjects` in `04_model.ts` owns one `delete-objects` document command for the committed exact IDs. It removes referencing dimensions and selected IDs from memberships, discards groups with fewer than two surviving members, and clears the completed selection. `removeSelectedEntity` cancels transient gestures before reading selection/history and routes multiple object IDs, explicit single frame members, and group-plus-extra selections to that command. Ordinary single-object/group and conservative topology deletion retain their paths. The separate sidebar selection-action row stays visible while single-object properties are hidden. Undo/Redo snapshots include membership and selection; geometry, persistent format and worker payloads are unchanged.

Selected display colors are derived from the object's own color with named white-lightening and cool-tint policies. Selected surfaces use higher ambient brightness and blue edges. Stored object colors and unselected render colors are untouched.

### Object edit locks

`04_object_lock.ts` owns edit protection independently of visibility and organizational membership. The optional `locked` boolean is serialized only when true in native format 7; missing flags deserialize to false and malformed flags reject the incoming document. Snapshot cloning/history and native addition preserve it. Duplication deliberately clears it on new copies.

Command preflight refuses known edit targets before execution; a second invariant compares every previously locked object's existence, name, color, transform and canonical geometry contents before references/history can be applied. Unknown future command types therefore cannot bypass protection. Only the explicit lock command changes existing lock flags. New/Open replace document contents intentionally; Undo/Redo restore document state using private geometry versions. Organizational group/visibility edits leave protected object fields unchanged. A retained locked cutter is read-only; target edits and consumed cutter deletion are guarded.

The Objects panel exposes per-object/member padlocks and an all-members group toggle with a mixed state. Lock changes cancel transient gestures and restore temporary transform previews before taking the command snapshot. Move/Rotate pointer and numeric entry, geometry-edit dispatch/hover, Delete targets and background starts enforce the lock before preview or computation. Locked geometry remains an ordinary visible B-rep for selection, measurement, snapping, rendering and export. Whole-group edits reject any locked member; exact frame-selected ID deletion does not include unselected locked siblings.

### 2.2 Sweep control-flow boundary

General sweep candidate construction is separated from event resolution. A successfully built requested candidate is classified as:

- `alive` — the logical moving face still exists,
- `shell-ahead` — the cap is temporarily absent but the original shell still contains material farther along the sweep,
- `terminal` — no shell remains ahead and terminal-event resolution is required.

Expected candidate rejection is represented with explicit attempt/result values. Higher-level event classification, regularization, snapping, and clamping must not use broad exceptions as ordinary control flow.

One narrow exception adapter currently exists around the lower-level CSG → B-rep candidate builder because those lower layers still throw on some rejected constructions. New sweep logic should not spread that exception behavior upward.

Search limits, numerical multipliers, probe distances, and preview thresholds used by this operation family belong in `SWEEP_POLICY` or named sweep tolerance helpers.

### 2.3 Topology events are geometric

A sweep meeting existing shell/void topology must be interpreted from geometry rather than shape names. Useful reusable event concepts include:

- terminal shell contact,
- crossing an existing void,
- re-entry into material,
- overlap with non-coplanar shell topology,
- receiving-cap removal,
- outer-shell collapse,
- invalid/degenerate candidate.

The exact implementation can evolve. The contract is that event categories describe reusable geometry and do not depend on whether a Circle, Rectangle, or another UI tool created the region.

### 2.4 CSG is a fallback representation

Transient polyhedral CSG/BSP is allowed as a general construction mechanism. It is not persisted and does not become a second modeling representation.

After CSG, the result must be reconstructed as B-rep and validated before commit.

The kernel exposes normal non-destructive CSG wrappers and internal owned variants. Owned variants may mutate transient polygon winding/plane objects and are permitted only when the caller created fresh disposable polygon lists and does not retain them after the Boolean. Callers that retain/reuse CSG input must use the normal wrappers, which preserve independent input data. This is an allocation optimization only; both paths implement the same Boolean semantics and must remain regression-equivalent.

### 2.5 Preview and commit share semantics

Preview may use cheaper paths than exact commit, but it must preserve the user's requested operation and distance. A preview optimization may decline to produce a candidate; it may not silently reinterpret the request.

Live preview can render a validated transient solid. Committed document state changes only through the command boundary.
A Straight Chamfer hover may retain that exact validated transient result and reuse it when the user clicks, provided the source-solid identity and preview key still match. The commit still enters the normal command boundary and is validated there; the optimization removes duplicate geometry generation, not command semantics.

Chamfer geometry uses the two face-interior rays perpendicular to a selected
edge as its local material wedge. Convexity and the supported included-angle
range are explicit admission policies. The base setback and tan(bias) setback
are measured within their respective face planes. Equal-setback Rounded
Chamfer samples a Euclidean circle tangent to both rays; unequal setbacks
apply an affine scale in this wedge basis. The orthogonal profile retains its
existing quarter-circle/ellipse segment coordinates.

A closed hole/circular outer rim is recognized from canonical loop geometry.
Its planar rim face is the base support, and all incident sides must have a
consistent inclination. The base inset comes from intersecting offset rim
lines in that plane; collinear subdivisions use their shared offset line.
The second inset intersects both neighboring side planes
with the required support-normal depth. Both physical side setbacks and all
plane residuals are checked against the existing budgets before assembling
cutters. Ordinary and Rounded Chamfer share this frame; unsupported rims reject
instead of assuming an axial cut. Curve profiles, frames and cutters are
transient, with the final Boolean rebuilt and validated as canonical B-rep.



### 2.6 Boolean union produces one connected solid

Object Combine is a geometric Boolean union. `03_boolean_union.ts` preflights every solid and finite rigid transform, transforms inputs into the first visible selected object's local reference, accumulates owned transient CSG unions and reconstructs one canonical B-rep at the end. Connection is checked only on final material: intermediate disconnected pieces may be bridged by later inputs. Named input and volume policies bound the project count and detect invalid volume growth/loss; canonical validation and closed export checks remain authoritative. The existing pair-level union API remains available for compatibility.

The operation is valid only when the regularized result contains one connected material body, including any contained sealed cavity shells. Volumetric overlap and finite shared surface-area contact are supported. Disconnected final material is rejected. Edge-only or point-only contact is also rejected because it does not form one regular manifold solid.

`04_object_combine.ts` captures exact selection, source-solid identity, revision, rigid placement, visibility and affected group snapshots. Full group selection includes all hidden members; explicit frame members remain exact subsets. A typed union request runs through the existing worker bridge. Source, selection, grouping and locks are rechecked before one `combine-objects` command consumes all selected inputs except the first visible primary. The result retains its identity/appearance/placement and is detached from its old group. Unselected group siblings survive; records with fewer than two survivors dissolve. Selected dimension anchors become world fallbacks. The synchronous document API and `06_object_combine.ts` worker controller share capture and commit. Cancel, errors and stale replies cannot mutate the document; native format remains 7.

Boolean Combine must not be used as an implementation shortcut for grouping. Group is a separate document/UI concept that references multiple disconnected objects without changing their solids. Groups are deliberately flat: an object belongs to at most one group and a group cannot contain another group. Move/Rotate capture the full selected object ID set before preview, including multiple groups and extra objects. Clicking a selected target retains that set; an unselected target chooses its object/group through the ordinary selection path. Partial through-frame groups stay partial. Preview always uses the captured original transforms; all snap targets belonging to the moving set are excluded. World rotation pivots use the complete selected bounds center; picked-face pivots use the clicked face center/normal for every target. Single objects and pure groups retain their existing command types; mixed/multiple selections commit through `move-objects` / `rotate-objects` with exact target IDs and preserved selection/membership. All previews restore original poses before command/history capture and on cancellation. Every selected lock is checked before any preview or mutation; these rigid commands remain surface-aware. Uniform Scale is a true common transform: every member's local geometry is scaled from its object origin and every member origin is repositioned by the same factor around either the group-bounds center or a selected member origin. This preserves proportional spacing exactly and permits one member origin to act as a fixed scale anchor. Individual topology editing is unavailable while the group is selected.

Because general CSG reconstruction does not provide a trustworthy vertex/edge identity map, passive dimension anchors that reference either Combine input are detached to their current world-space positions before the old topology is replaced. This preserves the visible measurement deterministically without pretending that an arbitrary new Boolean vertex is the same persistent entity. Undo restores the original anchored references from the document snapshot.

### 2.7 Object subtraction preserves the remaining target material

Object/group subtraction means target minus the union of all cutter volumes in the target's local coordinates. `03_boolean_subtract.ts` preflights the target and every cutter graph and finite transform, including non-intersecting members and cutters after early full removal. It preclassifies the convex boundary operation described below; other inputs use sequential `csgSubtractOwned` differences to fresh transient polygons. Only the final result is reconstructed through the existing CSG-to-B-rep adapter. This does not combine group members into a persistent solid; disconnected/overlapping cutters remain legal read-only inputs. The named cutter budget matches the 300-object project limit. Its explicit outcomes are changed, empty, unchanged and invalid. Named absolute/relative volume policy distinguishes no material removal from arithmetic noise. Changed results are separated into material components; every resulting solid must validate and generate a closed export mesh.

`03_convex_subtract.ts` derives supporting planes only when every target vertex lies inside every outward target half-space. `CONVEX_SUBTRACT_POLICY.maximumTargetFaces` is 256 to bound classification and cap work. For groups, cutter bounding boxes must be pairwise separated by the existing `TOL.minimumEdge`; overlapping/touching bounds select BSP before computation. Each canonical cutter boundary triangle is clipped against the target planes. Oriented cut edges cancel their reverse and form closed cap contours; existing loop classification and constrained triangulation retain nested holes. Shared boundary positions and source face planes are retained with the existing rebuild weld radius. The result boundary consists of original target surfaces minus intersection caps, plus inverted cutter skins inside the target. Negative caps retain their target plane normal for the oriented coplanar boundary sum; cutter face groups retain source face identity. This avoids fragmenting a simple target through thousands of nearly parallel cutter BSP planes.

Each clipped intersection volume must be finite and within the target volume, using the existing Subtract absolute/relative noise policy. The rebuilt removed volume must match the intersection sum within that same allowance. The canonical validator, material-component/cavity splitter and closed export checks remain authoritative. This is a preclassified mathematical operation, not a retry after reconstruction failure. Shared B-rep/CSG reconstruction, tolerance values, worker messages and native encoding are unchanged.

Subtraction retains every remaining material component as a separate canonical B-rep. The shared `splitConnectedSolidShells` first identifies connected face surfaces. Positive signed-volume shells define material components; negative cavity shells stay with the smallest enclosing positive shell, using bounds and generalized winding containment. This is the same splitter exposed through `geometryApi.splitConnectedShells` for Push/Pull. It copies the canonical graph subsets and keeps each face exactly once. The shell containment rule also serves OBJ import. No cavity is turned into a positive solid and no material component is dropped.

The existing embedded worker transport gains a typed subtraction request/result and returns geometry without document mutation. The UI dialog makes direction and cutter consumption explicit before starting a cancellable background job. `04_object_subtract.ts` owns source capture and the shared commit. Revision, all source-solid identities, transforms, exact group identity/name/membership and member visibility are checked before committing through `subtract-objects`. The target must be visible and ungrouped; a cutter group contributes every member, including hidden members. Target-first additive selection works for both an individual cutter and a complete cutter group. Adding a group through a viewport member or the Objects panel retains already selected ungrouped objects as group extras. The group is always the cutter; the earlier group-first order remains accepted. Individual pairs retain Swap. Consuming a group removes all members and its record in one command, freezing their dimension anchors; Keep preserves the group and its anchors. All consumed members and the target pass edit-lock guards; retained locked cutters are read-only inputs. An unchanged result makes no command and consumes neither object. An empty result removes the target; consuming the cutter remains a separate user option. The worker returns independently validated solids. The shared `replaceObjectWithSplitSolids` document helper, also used by Push/Pull, keeps the primary target identity and creates numbered objects for additional pieces with copied appearance/placement and unique object/solid IDs. Subtraction selects all result pieces, excluding a kept cutter. The net project object limit includes cutter consumption and is checked before any commit. Project format 7 is unchanged.

Reconstructed target references cannot be mapped reliably, so dimension anchors referencing the target are frozen to their resolved world points. Cutter anchors are frozen only if it is consumed. Kept cutters retain their solid and anchors. One history snapshot restores objects, dimensions and selection exactly on Undo. Cancellation, transport errors, invalid geometry and stale results cannot commit.

### 2.8 Parametric creation produces ordinary solids

`03_primitives.ts` defines the supported forms, parameter labels/defaults and named dimension/detail policy. Sphere, affine Ellipsoid, Cone, Frustum, Torus, Capsule and Cylinder use a common oriented surface-of-revolution rule. It closes poles/caps and periodic torus seams, then uses the existing polygon-to-B-rep builder and validation. Box uses the existing prism builder. Coplanar facets may merge into logical faces, including an annular torus face at odd profile counts. All forms have their local base at Z=0 and expose only canonical planar faces.

`geometryApi.createPrimitive` is the sole application-facing creation boundary. `06_tool_primitives.ts` owns transient settings, a parameter-keyed validated preview/edge cache and ground placement; changing placement does not rebuild geometry. The normal `ToolController` dispatch provides click/release and drag/release through one commit helper, shared ground snapping, cancellation and busy guards. The Shapes panel follows the shared option-panel map and contextual help mechanism. Exact X/Y/Z creation uses the same model command as viewport placement.

`addParametricObject` checks finite placement and the shared document object limit, then creates/selects one independent object in an `add-parametric-object` transaction. The first-generation parameter values are command metadata, not persistent shape owners. Canonical project format 7 stays unchanged; created faces participate in normal editing/export without a parametric regeneration graph. Preview and commit use identical settings/generation, and Undo/Redo use document snapshots. Curved shapes remain faceted approximations. Generation is synchronous and bounded by the named 64-around, 32-profile, 2,112-face policy; measured generation plus repeated validation/export checks takes approximately 70–110 ms for default curved forms and 300–350 ms for maximum curved forms in this execution environment. No runtime dependency or worker protocol changes are introduced.

### 2.9 Tool workflow is transient interaction state

Tools remain active after completion/rejection. Surface-sketch commits retain their drawing tool; predefined Shapes and completed Texture/Carve Out retain their tool while clearing consumed targets. Import/Subtract panel actions also retain the explicitly chosen tool after cancelling incompatible previews. New/Open starts a new document context in Select.

Ground profiles use the existing extrusion geometry/command path, with a typed transient pointer carrying its source `returnTool`. The toolbar temporarily selects Push/Pull and the active controller exposes one Height numeric parameter plus the height panel. Both single profiles and multi-profile patterns commit via the same height helpers and return to their source tool. Invalid/rejected height commits retain their draft for retry. No persistent tool stack or parametric profile owner is introduced; explicit tool changes discard the draft and return destination.

`handleToolEscape` owns cancellation ordering: direct numeric entry, suspended camera navigation, temporary ground height, controller `cancelStep` partial state, pointer gesture, then idle Select. Non-pointer partial state declares a consumed step through `ToolController.cancelStep`; full `cancel` remains the teardown contract for tool changes/history. Texture uses origin pick then selected area; Measure and Carve Out declare their own staged state. Native dialogs and worker Cancel retain their existing higher-priority boundaries. Focused inputs release focus and use the same Escape policy.

Camera pointers suspend the current tool pointer rather than replacing it. Release/Escape restores it; ground height's screen frame is rebased while preserving current height. Direct face Push/Pull rebases after wheel zoom and resumed orbit/pan, using current camera scale and preserving requested distance; stale snap feedback is cleared. A full tool change unwraps the suspended pointer before cancellation, so transient Move/Rotate/plane previews restore their original state. Undo/Redo calls the shared document-change teardown before restoring snapshots, retaining the chosen/source tool and dropping stale references. Busy jobs block history navigation. These transitions change transient UI state only and add no commands. Project format 7 and geometry semantics stay unchanged.

## 3. Face subdivision and sketch geometry

Planar drawing tools produce regions that are clipped to the selected face domain and committed as ordinary B-rep topology.

There is no persistent parametric sketch graph. A Rectangle, Circle, Contour, or Arc may use different transient interaction state, but once committed the region participates in normal face/topology operations.

Local half-edge subdivision and general rebuild/subdivision paths may coexist when they implement the same final contract.

## 4. Document boundary

`ModelDocument` owns persistent application state:

- model objects,
- flat object groups and their member IDs,
- construction geometry,
- passive dimensions/annotations,
- persistent selection identity.

Selection and hover identity use `EntityRef` variants. Object selection additionally keeps an ordered transient set of selected `ObjectId`s so multi-object commands can operate without inventing tool-specific selection state. The primary `EntityRef` remains the current object/entity for single-entity tools and property editing. Temporary ray-hit coordinates and gesture data are not persistent identity.

Construction geometry and annotations live outside the solid B-rep.

## 5. Command boundary
`src/04_object_color.ts` owns appearance mutation through the existing `set-object-color` command. A single target retains `objectId`; multiple targets use a deduplicated sorted `objectIds` list already supported by edit-lock preflight. All requested targets, even ones already using the color, must be editable. No-op batches create no command. Colors are changed atomically without validating or rebuilding unchanged solids; render caches and document revision follow ordinary command invalidation. Single and batch helpers share this implementation. Pending tools are cancelled before the snapshot so a color change cannot commit a transient transform.

The batch palette uses `selectedObjectIds()` directly. Full group selection includes hidden members and extras; explicit object/frame selections remain exact subsets. Its session records target identity, revision and the current history entry. Continuous input coalesces only within that session; selection changes invalidate the picker, while unrelated commands and Undo/Redo prevent cross-entry merging. Closing/changing/blur starts the next color interaction separately. This session is transient UI state; native color encoding and geometry truth remain unchanged.


Every persistent mutation enters through `executeDocumentCommand(...)`.

The command boundary owns:

- atomic execution and rollback,
- before/after history snapshots,
- undo/redo,
- dirty state,
- selection normalization and topology remapping,
- SceneGeometry invalidation,
- document/UI refresh.

A command is not allowed to leave an invalid replacement solid in committed state. The boundary compares solid object identities before/after execution and validates every new/replaced solid before the command is recorded. If validation fails, the complete before-state is restored.

A narrowly scoped exception exists for prepared asynchronous geometry results such as Thread and Rounded Chamfer. `geometryApi` may compute and validate a replacement solid in a dedicated worker before the document command starts. The commit command may then skip the duplicate main-thread validation only when it receives that already-validated result through the API boundary and verifies that the source solid identity has not changed while the worker was running. Cancellation or worker failure must not enter the command boundary or history.

This validation is intentionally limited to replaced solids; pure transform, rename, guide, or annotation commands do not re-triangulate unchanged solids.

Undo/redo currently uses complete document snapshots. Keep this simple implementation until profiling demonstrates a real problem.

Project persistence is explicit file I/O through Save Project/Open. Dirty state controls the unsaved-close warning independently of saving. No background recovery snapshot is serialized or stored, and startup never reads browser storage; legacy recovery copies are ignored. In-memory Undo/Redo snapshots remain session history.

## 6. Geometry API boundary

`geometryApi` is the application-facing boundary around the low-level B-rep and geometry operators.

Polygon reconstruction uses plane-normal/offset similarity only to select
candidate coplanar groups. Each incoming polygon's vertices must also lie
within the existing `TOL.plane` budget of that group's fixed representative
plane. The offset-bucket index preserves first-compatible-group creation order;
it never overrides this geometric test. Small angular differences can exceed
the planarity budget at distant vertices, and parallel offsets can pass the
candidate budget while failing planarity. Incompatible polygons retain separate
supporting-plane groups; reconstruction does not move their coordinates or
weaken final validation. This rule applies to every kernel rebuild, including
Boolean and Texture results.

Surface Texture uses the existing worker diagnostic event transport, with an
optional callback on `surfaceTextureFacesAsync`. Kernel events describe per-face
layout and cutter generation, combined Boolean counts/timing and the existing
CSG-to-B-rep reconstruction/seam/validation stages. Diagnostics do not modify
geometry or relax validation. `06_texture_diagnostics.ts` owns bounded transient
run records; `06_ui.ts` presents/downloads them inside Debug. Each Apply stores a
detached runtime source snapshot plus actual Map traversal order, exact input and
projection, preview counts and document revision/recent command context. The
last four attempts survive Undo/Redo; document snapshots and project format 7
never contain these records. Each run retains at most 2,000 events and reports
any dropped events explicitly. Clear releases retained runs; page closure loses
them. Source snapshots are diagnostic evidence, not another editable model.

The Debug popover is bounded by the viewport height and scrolls vertically. Its focusable container supports keyboard scrolling; overscroll containment keeps wheel input inside the panel, and stable scrollbar space prevents layout shifts.

Normal model, command, UI, and tool code should use this boundary for geometry queries and edits rather than reconstructing topology rules locally.

Low-level B-rep and operator files (`02_brep.ts`, `03_csg.ts`, `03_edge_feature_shared.ts`, `03_planar_query.ts`, `03_face_regions.ts`, `03_chamfer.ts`, `03_texture.ts`, `03_thread.ts`, and `03_sweep.ts`) may cooperate directly because they constitute the geometry kernel. Debug-only inspection may deliberately inspect raw topology.

A new app-layer feature should not call low-level split, CSG, normalization, or topology surgery helpers directly merely because the helper is accessible in the global bundle.

Heavy edge-feature calculations are exposed through asynchronous `geometryApi` methods such as `threadEdgeAsync(...)` and `roundedChamferEdgeAsync(...)`. The standalone build embeds one worker-only edge-feature kernel bundle and starts a fresh local Blob worker for each job, so these operations have no network/runtime-server dependency. The worker receives a structured clone of the source B-rep, returns a validated replacement B-rep, and may be terminated for cancellation. Tool controllers own only progress/cancel interaction; they do not perform kernel work directly. Prepared Thread and Rounded Chamfer results share the same guarded command-commit helper, which verifies source-solid identity before replacing document geometry.

Polygon plane reconstruction uses the complete signed-area vector around a translated origin, preserving winding for concave boundaries and cyclic starting vertices. The same rule reconstructs planes in canonical project reads.

Planar triangulation is derived from face loops. The constrained bridge triangulator keeps ordinary faces compact. A single adapter resolves its existing weak-boundary rejection through a vertex-coordinate slab sweep: edge ordering is fixed inside each slab, and only intervals inside the outer loop and outside all holes become triangles. The former independently simplified subtraction-fragment fallback is removed. Shared slab-edge T-junctions are resolved by the existing conforming mesh boundary; triangulation does not edit canonical topology.

## 7. Tool-controller boundary

Interactive tooling is split by responsibility:

- `06_tool_input.ts` — shared numeric-entry behavior, camera pointer override, and transient transform cancellation,
- `06_tool_selection.ts` — Select click/through-frame controller,
- `06_tool_select_push.ts` — Push/Pull controller,
- `04_scene_selection.ts` — derived screen-triangle frame queries,
- `06_tool_sketch_basic.ts`, `06_tool_sketch_profiles.ts`, and `06_tool_sketch_contours.ts` — planar sketch/placement controllers,
- `06_tool_guides_measure.ts` — construction guides and measurement controllers,
- `03_delete_point.ts` — explicit point deletion and planar closure,
- `06_tool_delete_point.ts` — checked cached point-delete hover preview,
- `03_move_point.ts` — checked local point deformation,
- `06_tool_move_point.ts` — exclusive Move target state and transient Point controller helpers,
- `06_tool_transform.ts` — target routing, complete-selection Move and Rotate controllers,
- `06_tool_edge_features.ts` — Chamfer, Rounded Chamfer, and Thread controllers,
- `06_tool_texture.ts` — transient multi-face Surface Texture area selection and preview/commit controller,
- `06_tool_delete_navigation.ts` — Delete and Orbit controllers,
- `06_tools.ts` — controller registry plus shared pointer/key dispatch,
- `06_ui.ts` — DOM/UI presentation and non-gesture UI actions.

A `ToolController` owns its gesture lifecycle and transient preview state. Persistent edits are still commands.

Surface Texture follows the same boundary: pattern layout/face clipping lives in `03_texture.ts`, including repeated closed motifs and piecewise planar height-field relief on a shared square grid, the read/execute boundary is exposed by `geometryApi`, `06_tool_texture.ts` owns transient face-area selection and preview UI state, and the persistent replacement solid is committed by the model command layer. In Planar patch, all selected faces share the first face’s projection axes/direction. Each face retains its own planar clipping domain, while edge margin excludes edges internal to the selected area. Preview and commit use the same source-solid layouts. Convex hole-free domains use exact inward half-plane clipping for a complete perimeter margin, or their unshifted boundaries for zero margin. No fragment is simplified between those clipping planes; oriented boundary assembly separates disconnected concave motif pieces. Partial perimeters and holes use the finite-edge keep-out path. Its half-plane splitter retains intersections and small intermediate partitions without normalization or per-fragment area rejection. Oriented boundaries are assembled first, redundant collinear points are removed with the existing B-rep policy, and the minimum-area check applies to whole material regions. This prevents face triangulation from introducing cracks or noisy subdivided sweep walls. Combined Add/Cut tooling is swept in the common projection direction and committed as one validated, undoable replacement. Known prism planes are transformed with the affine sweep, and BSP clipping retains each source polygon’s supporting plane even for thin fragments. Relief facets form a closed full cell with a variable-height roof. That cell intersects the same closed clipped column used by flat patterns, so existing Boolean clipping owns roof/wall/perimeter/hole junctions. Relief wire lines derive from that same height field. Apply executes in the embedded modeling worker, with staged progress and termination on Cancel. Only a completed, worker-validated result commits through the prepared Texture command; its source-solid identity guard protects against stale results. Preview display budgets are shared across the entire patch and explicitly report sampling while keeping full layout counts. Candidate-range preflight and total instance/region/geometry budgets bound work. Face selection, relief profiles, and the projection frame are not new persistent feature state. Planar patch supports local forward-facing areas.

Wrapped band layout and local surface construction live in `03_texture_band.ts`.
The frame fits one perpendicular centre from canonical vertices with an
independent radius intercept at each axial level. Selected side faces use
periodic angle and axial height; ray/plane intersections follow each actual
supporting plane. Integer repeats close the angular chart. Motif boundaries
are clipped/assembled in UV before nonlinear mapping, adaptively approximated
within the named chord budget, clipped to the physical face and reconciled at
canonical source boundaries within the existing topology-coordinate budget.

The band operation requires concentric side rings with compatible radial/axial
miter offsets. Incident source-side normals determine shared vertex offsets,
including for a partial selection. Axial miter interpolation plus the exact
face-normal constraint preserves angular phase through depth. Face complements
are oriented boundary differences; caps and side walls form one replacement
surface, without artificial internal selected seam walls. Retained-surface
intersection and source-material winding checks reject depth that leaves the
surface layer. Crosshatch and sloped top motifs are explicitly outside this
operation's current domain. Expected unsupported inputs have clear parameter
feedback; failed construction/validation never commits.

Frame, face field, selected rows and candidate contours remain disposable.
geometryApi exposes selection/layout/generation; the existing embedded worker,
termination-on-Cancel, source identity guard and one prepared Texture command
own execution and persistence. Debug retains exact source/parameters and the
new construction stages. Project format remains 7.

Coplanar boundary simplification removes one point at a time and recomputes
neighbours, avoiding simultaneous removal of a corner and its nearby subdivision.
A queue rechecks only the two affected neighbours, bounding work by the initial
vertices plus two entries per removal.
Derived render/export tessellation uses the canonical boundary option of
`triangulateFaceLocal`: original vertex coordinates are retained and slab points
interpolate actual source edges. A small named UV roundoff budget identifies
these boundary coordinates; it does not widen geometry/planarity tolerances.
The existing candidate-range index resolves canonical boundary coordinates
without comparing every generated point with every source edge. Kernel
construction uses the explicit plane-boundary option. Both meshes and
plane triangulations remain derived from the canonical B-rep.


Tools that share a user interaction pattern should share the same lifecycle contract. In particular, click → move → click and press-drag-release variants of one operation should converge on one preview/commit helper and one command path; `Esc`/cancel must restore the same pre-gesture state. Rectangle, Circle, Move, and Push/Pull regressions protect this interaction consistency where those patterns apply.

Direct numeric input is transient operation input, not a persistent dimensional constraint system.

The right sidebar follows the same separation of concerns. Its **Tool** section is contextual to the active `ToolController` and may expose only that tool’s relevant controls. The **Object** section is selection/document state and remains independent of the active tool. Persistent tutorial copy must not be used as a substitute for tool state; concise transient guidance belongs in the status bar and detailed instructions in Help.

All tool-option containers belong to the Tool section. Static prose is stored in hidden `sidebar-help-source` elements in the HTML template, separate from controls and live status. Three native buttons open one labeled, scrollable `sidebarHelpDialog`: Tool uses the existing tool-panel mapping and summary; Object selects solid/group/plane guidance; Objects explains selection and visibility. The UI copies only paragraph text into new elements, never controls, source IDs or document geometry. Closing returns focus to the triggering button. Native dialog keyboard handling and the existing modal shortcut guard isolate help from modeling commands; modeling-busy guards prevent opening during a job.

The sidebar uses the active tool name as its settings heading, with plain tool-control backgrounds. Selected object and Objects - N share larger uppercase headings; object names remain in their editable fields. The count shows all solids, including hidden ones, while hidden-object status appears below the visibility controls. Long instructional hints are shown on demand; concise counts, current selections, operation errors and the short Thread approximation notice remain visible. Empty multi-selection/visibility hints are hidden. This is presentation state only, with no serialization or geometry changes.

## 8. Snapping and construction geometry

`SnapEngine` is the shared ranking boundary for model geometry, construction geometry, and optional direction hints.

Discrete model/guide point candidates (corners, intersections, centers, guide points, and midpoints) take priority over direction hints. Continuous line snaps such as On edge and On guide line yield to an active direction hint so approaching a line does not break a parallel/perpendicular lock. Direction inference must not silently change the selected support face.

Construction geometry is document-owned and serialized separately from B-rep solids. Guide Points and Guide Planes remain supported document entities even when no standalone creation tool is exposed; Guide Line is the current user-facing guide creation workflow.


### Visible snap targets

Viewport snap adapters pass a candidate predicate to SnapEngine. After plane/radius eligibility and before deduplication/ranking, it rejects points outside viewport/near/far clipping or behind a displayed solid. SceneGeometry owns the ray-segment occlusion query, reusing canonical derived BVHs and a disposable preview BVH when Live solid preview is displayed. Hidden objects do not occlude; the source object's front surfaces do. Surface depth uncertainty uses the named SNAP_VISIBILITY_POLICY, without weakening topology tolerances. SnapEngine remains independent of camera/DOM/B-rep internals; pure geometric callers need no visibility predicate. Direct Push/Pull composes the viewport predicate with source-sketch exclusion. Show guides and the explicit through-solids display option determine guide eligibility. No persistent state or document commands are added.


### Object visibility

Optional `ModelObject.hidden` is document metadata independent of the canonical B-rep. `src/04_object_visibility.ts` owns visibility commands, visible-object queries and read-time boolean validation. Missing metadata means visible for existing format-7 files. History cloning and project serialization retain hidden state. Hide/show and isolation execute through one document command, leave solids/transforms unchanged, normalize hidden primary selections, and avoid no-op history entries. Group membership remains authoritative: a selected partially visible group still contains every member, and isolation reveals the full selection.

The UI cancels gestures and clears cached tool/hover previews before changing visibility, and guards actions during a modeling job. Object and group eye buttons are sibling buttons with explicit labels and pressed/mixed states. Hidden selection rows remain listed but are disabled until shown.

The renderer and scene-wide snap collectors use visible objects. SceneGeometry picking excludes hidden objects even if the supplied list includes them. Fit filters its input, while general bounds/mesh services retain geometry semantics for group transforms and exports. Anchored dimension visibility follows its referenced objects; guides and world-only dimensions are independent. Full-model exports retain every object and expose that behavior in the UI. No render cache or preview becomes document truth.

## 9. SceneGeometry and derived data

`SceneGeometry` owns derived world-space geometry used by rendering/picking:

- render mesh,
- bounds,
- BVH,
- triangle → `FaceId` mapping,
- preview mesh derivation.

Renderer, pointer picking, document bounds, and export code consume this service instead of maintaining parallel caches.

The cache is transform/solid aware and disposable. No SceneGeometry data is project-file model truth.

`SceneGeometry.appearance(mesh)` owns a WeakMap cache of triangle normals, angle-weighted corner normals and logical-edge adjacency/crease classification. Corner smoothing joins only across a shared triangle edge incident at the same vertex and below the named 30° crease threshold. It cannot use an unrelated path around the shell to smooth a local sharp join. Canonical topology, BVHs, face ownership and geometry exports do not depend on a display style.

`src/05_render_styles.ts` contains pure camera-frame/projection helpers, shared model shader sources and display-only appearance policy. Modeling uses the existing flat lighting and all logical edges. Illustration uses smoothed corner lighting, sharp logical edges and view-dependent silhouettes, including the camera in its buffer key. Presentation uses smoothed diffuse lighting without drawn model edges and evaluates view-dependent gloss per fragment from camera uniforms. Style controls are transient session state and do not enter native persistence.

Presentation specular lighting uses the six world-fixed directions in `PRESENTATION_GLOSS_POLICY`: the existing key/fill plus left, rear, right and underside accents. This policy generates unrolled fragment shader constants and also drives the CPU reference. Diffuse shading and the existing single shadow pass keep their original key/fill policy. Zero shininess exits before specular work, and Modeling/Illustration supply zero fragment shininess. Additional lights require no geometry changes, new buffers, uniforms, render passes or shadow maps. Viewport and PNG use the same shader; orbit updates camera uniforms without rebuilding Presentation geometry/material buffers.


Camera presets and projection belong to `src/05_render.ts`. Top looks from +Z, Front from -Y and Right from +X; Perspective uses the orbit camera. Axis presets retain a small pole-avoidance tilt and use orthographic projection. Positive camera-forward distance must map to increasing clip depth under WebGL LEQUAL so visible surfaces agree with nearest-ray picking. `CAMERA_PROJECTION_POLICY` defines a 0.1 mm close-up near plane and minimum 10 m far plane. `sceneCameraClipRange` expands these limits from the current eye distance and conservative bounds of visible meshes so multi-metre models remain visible beyond 10 m while the distant near plane rises enough to preserve depth precision. The viewport shader, guide clipping, snap visibility, rectangle selection and PNG renderer use the same computed range. Perspective and orthographic near/far map to -1/+1. View changes and active-button state are transient and do not mutate B-rep geometry or enter document history.

## 10. Selection, Delete, and dissolve

Selection filters can target object, face, edge, or vertex entities using normal `EntityRef` values.

Default Delete is conservative. It may remove an entity only when the model can preserve its intended geometry without implicitly opening or deforming the solid. Examples include:

- object deletion,
- construction geometry deletion,
- passive dimension deletion,
- dissolving a coplanar sketch boundary,
- dissolving a coplanar edge,
- dissolving a geometrically redundant collinear vertex.

Shape-changing face/edge/vertex editing must be a separate explicit modeling operation.

The direct-click Delete tool classifies dimensions, guide lines/circles, groups, recognized straight-walled hole/pocket/protrusion rims, flat face sketches and whole objects, in that priority order. `resolveDeleteToolTarget` is shared by hover and click; target classification precedes the category filter. A disabled target suppresses both highlight and deletion, without falling through to an enclosing object. Existing commands own all mutations and Undo/Redo. Checkbox settings are transient UI state, retained across tool switches and absent from project serialization/history. Objects, Groups and Edges · flatten / trim default off; the remaining supported categories are on. Group deletion removes all members independently of the individual-object option. Keyboard Delete and explicit property actions retain selected-entity semantics.

### Explicit edge trimming in the Delete tool

The opt-in **Edges · flatten / trim** category inserts picked edges after dimension/guide/group classification and before ordinary feature/sketch/object targeting. Unsupported edges remain edge targets, so failure never becomes feature healing or whole-object deletion. The default path and selected-entity keyboard/property operations retain conservative semantics.

`03_edge_trim.ts` owns the separate geometric operation. Coplanar pairs use fixed-point selected-face merging. A non-coplanar convex ridge requires one shared edge, no holes in its two faces and one surrounding face at each endpoint. Its retained indexed boundary must form one plane, facing the original material side. Remove the ridge endpoints from all incident cap loops; retain all other vertex coordinates, face properties and identities. Reject material-adding concavity, collapsed loops, local boundary crossing/touch, engulfed holes and failed canonical/closed-export checks. This is a local ridge edit; it does not promise arbitrary edge collapse or exhaustive global self-intersection detection.

`geometryApi.trimEdge` provides typed acceptance/rejection and stable retained vertex, edge and face mappings. Removed anchors use existing world-point fallback. `applyPreparedEdgeTrim` commits the exact checked solid through one `trim-edge` command. No persistent feature representation, native format or tolerance changes are introduced.

The Delete controller defers a bounded foreground calculation until the hover can paint, caches one source/edge candidate and guards tool, option, revision, source identity, visibility, group and busy state. A pending or invalid preview cannot commit. Source picking remains canonical; `SceneGeometry.previewMesh` derives green/amber render buffers from the candidate without swapping the document solid. Settings, tool changes and Undo/Redo cancel transient results; navigation preserves a valid result. Work is bounded to 2,000 source faces, 20,000 half-edges and 100,000 affected boundary segment-pair checks. The modeling worker and its protocol are unchanged.

## 11. Persistence

Current project format:

- version: `7`,
- format ID: `lamjacraft-3d`,
- canonical solid schema: `poly-brep-1`,
- default extension: `.lamjacraft.json`.
- Open loader compatibility: legacy format ID `doodlelab-3d` / `.doodlelab.json` and earlier `formverk` format-7 files are accepted.

Canonical project solids persist stable `VertexId` positions and stable `FaceId` outer/hole vertex loops. Runtime half-edge and loop records are reconstructed deterministically during load.

Runtime `HalfEdgeId` and `LoopId` values are implementation details. Durable edge references should use stable endpoint identity such as canonical vertex-pair keys.

Import accepts only the current `lamjacraft-3d` identity. The Open loader retains explicit compatibility for the previous alpha.44 format-7 identity and for supported legacy system labels. Compatibility logic must remain isolated in serialization/deserialization migration code.

Do not persist render caches, BVHs, previews, hover/selection visuals, or undo history.

### Manual Photo AI and native project addition

`07_photo_ai_format.ts` owns the manual handoff prompt with descriptive native filenames, canonical example and narrow single-fence JSON compatibility. It calls the native format-7 reader, whose geometryApi Object Check adapter also guards finite derived planes/volume, and rejects non-finite optional guide/dimension coordinates. No generated code is evaluated; there is no photo reconstruction kernel or remote AI integration. `07_photo_ai.ts` owns the transient dialog, clipboard and staged result. The photo is attached directly to the external AI; the dialog contains no local image chooser/decoder. Closing drops staged geometry and result text. Native dialogs retain browser Escape semantics. Opening cancels unfinished gestures through the shared document-change teardown while retaining the chosen/source tool.

Checking is read-only: it yields once for status rendering, then uses the ordinary synchronous native reader and canonical validation. It checks combined document capacity and records source token/text and document revision. File reads are token guarded; changed/closed sources cannot resurrect a staged result. Addition requires that exact checked source and revision. Very large native files retain the native reader's synchronous validation cost; the prompt recommends moderate geometry. The reader's check is not exhaustive self-intersection detection.

`04_project_merge.ts` owns the append transaction. It clones canonical solids and all supported native document entities, allocates fresh object/group/guide/dimension IDs, remaps group membership and imported geometry anchors, and keeps topology IDs local to each solid. Unresolved anchors become explicit world fallback points rather than attaching to an unrelated existing ID. Existing contents/name, source transforms/appearance/visibility and relative placement are preserved. Combined capacity is checked before mutation; the command boundary validates every added solid and restores the complete before-state on failure. One snapshot command owns Undo/Redo and manual-save dirtiness. Format 7 and the geometryApi/kernel boundaries remain unchanged.

### Native Import versus Open

`07_import.ts` owns a discriminated staged source/result: mesh bytes and worker conversion, or native JSON and native validation. `07_native_import.ts` reads one selected JSON file under the native file budget, restores pending tool previews through the shared document-change teardown and stages **Check project → Import project**. Mesh scaling/repair controls are hidden and ignored for native data. Validation yields once for status rendering, then uses `validateProject` without a new format or geometric reconstruction path. Shared `validateProjectReferenceCoordinates` keeps finite guide/dimension checks identical to Photo AI. Native validation remains synchronous within the check; cancellation/replaced sources discard results before commit.

Native mode of `addImportedProject` appends supported modeling entities and build plates with fresh document IDs. Imported groups and anchors reference imported objects, never coincident destination IDs. Unresolved anchors use explicit world fallback. Plate dimensions, placement, appearance and visibility are preserved. Native mode permits reference-only files and preserves selection/camera when no objects are added; Photo AI's default mode requires objects and preserves destination plates without importing source plates. Combined capacity is checked before mutation and again at commit. One `import-project` transaction owns rollback/Undo/Redo. Destination name/content is preserved. The checked source token/revision must still match after tool teardown. Open continues to replace the entire document through its existing reader/command. Native format 7, serialization, snapshots and geometry/worker protocols are unchanged.

## 12. Passive annotations

Linear dimensions are passive annotations outside the B-rep. Anchors may reference world points, stable vertices, or canonical edge endpoints plus interpolation parameter.

Annotations display/reference geometry; they do not regenerate or constrain geometry. When topology removes an anchor target, fallback behavior must be deterministic rather than guessing a new dependency. Topology-preserving edits use explicit topology maps where available; general rebuilds that cannot map identity safely must detach affected anchors to their current/stored world fallback instead of silently retargeting them.

## 13. Geometry exchange

### 13.1 Import is a conversion boundary

`src/03_stl_import.ts` owns STL syntax and shared triangle reconstruction helpers. `src/03_obj_import.ts` owns OBJ/MTL syntax, finite scaling, material/name interpretation and mesh-import preparation. All resulting geometry is ordinary canonical B-rep; no imported mesh is retained as a second persistent truth.

Both formats reuse spatial welding, edge incidence checks, consistent orientation, conservative planar-face merging, triangle-preserving fallback and canonical validation. Complete triangle preservation uses `buildSolidFromIndexedTriangles` in the B-rep kernel, reusing the canonical loop constructor/validator without proximity-based polygon cuts. This preserves already conforming edge ownership rather than repeating boundary simplification/splitting. Partial planar preservation still uses the polygon path. Canonical validation, exportability and source-volume guards remain authoritative. `03_stl_open_surfaces.ts` first classifies whole edge-connected source components before global deduplication, using the existing source welding predicate and actual edge incidence. Detached manifold components with open edges become limited B-rep surfaces by default for OBJ and STL, preserving source coordinates; coplanar triangle regions are merged when indexed boundary ownership and surface validation allow it, otherwise original triangles are retained. The optional `ignoreIsolatedOpenSurfaces` flag omits classified open components and reports counts for both formats. OBJ classifies within each named part, retains original triangle indices to keep MTL ownership through the split, and sends only closed components to shell-containment classification. An omitted entirely open named part does not reject another closed part; a check with no remaining geometry is rejected. Open surfaces use the existing format-9 reader and document commands without a new persistent mesh representation. For OBJ only, a branching component is partitioned along its ordinary two-incidence edges; every resulting candidate must independently prove closed two-incidence topology before conversion. Each candidate then passes canonical orientation/volume/B-rep checks. Open branches, duplicated faces and unproven partitions remain on the strict rejection path. The STL classifier remains unchanged. No cap or artificial thickness is added. Requested planar-opening repair may convert an eligible open component to a full solid, otherwise it remains limited. Closed components retain their original source triangle order, source-batch/contact reconstruction and volume/export checks. `03_stl_source_batches.ts` then classifies complete ordered closed source batches when separate mode is requested. It shares the exact `stlSourceVertexIndex` bucket/distance predicate with welding, retains collinear source facets for closure evidence, requires exactly two opposite incidences for each noncollapsed edge, nonzero signed source volume and coverage of every retained triangle. All batches must qualify before conversion starts. Each converts independently through the existing STL adapter with opening repair disabled, validates/export-checks and matches its source material volume inside the existing contact-volume policy. Aggregated shells/triangles retain existing ceilings. This avoids globally deduplicating a contact/exterior face owned by two source parts. Batch boundaries are topology proofs in source traversal order, not persistent identities or STL object metadata; interleaved/inconsistently wound sources remain on the existing contact path. Zero-volume opposite sheets do not qualify as solids and are not eligible for open-sheet omission unless they are actually open, manifold and coherently oriented. Combined mode is unchanged and may reject overlapping assemblies. STL contact classification partitions planar sheets at branch edges before normalizing winding, cancels complete opposite patches or a single sheet whose entire perimeter is already covered twice by the remaining surface, and requires a closed exterior after seam conformity. With `keepTouchingPartsSeparate`, the adapter cuts exterior adjacency only along these proven contact rims and restores one original interface copy to each of exactly two adjacent parts. Each result must independently close, validate, export and preserve summed material volume. Classification/separation work and output triangles are bounded by `STL_IMPORT_POLICY`; ambiguous partitions are rejected rather than replaced by a combined result. Opening repair cannot conceal an unrelated missing surface during contact cleanup. The explicitly requested planar-opening repair reuses the existing bounded cap adapter and is off by default in the UI. OBJ triangulates polygons and classifies closed shell nesting with a bounded set of components, bounding-box rejection and generalized winding-number containment. Odd-depth shells are reversed into void boundaries; even-depth material components become individual solids. Object boundaries in the source are respected. For group-only OBJ files, declared group regions are processed independently before positional welding. Repeated group names collect checked limited sheets into one surface object; serialized sheet vertex/face identities are remapped without welding coincident parts together. Original positions, polygon loops and face counts survive this collection. Group surface colours use the original source triangles/material indices for dominant diffuse ownership. Source regions and final OBJ objects are capped at 1,000; destination capacity is independently checked before commit. The legacy STL converter continues to treat each closed shell as a separate outward solid.

MTL contributes diffuse RGB object colours. Because the current model/rendering contract has one colour per object, mixed face materials select the surface-area-dominant material and produce a visible note. UVs, smoothing/shader data, image textures and per-vertex colours never become canonical state. Unsupported geometric records are rejected rather than silently disappearing. Source axis orientation is retained, and scaling happens before reconstruction.

`src/07_import.ts` stages OBJ/STL browser-selected bytes, units and optional repair, separately from the native-project branch. It requests `geometryApi.prepareImportAsync`, whose cancellable transport uses the embedded modeling worker. Checking is read-only and has progress. A token and document revision protect completed results; settings or document changes require a new check. Successful validation enables commit, which calls `addImportedMeshItems` and creates one `import-obj` or `import-stl` document command. Cancellation terminates the worker, rejects its promise and releases its Blob URL. No partial candidate reaches document state. The UI reads only explicitly selected geometry/material files, with per-file/combined budgets; referenced paths are never fetched.

`06_import_diagnostics.ts` owns transient mesh-check logs, independently of document snapshots and native serialization. Optional observers in the STL/OBJ adapters report stage entry/completion, bounded problem-edge/rim samples, contact candidate/comparison counts, actual work ceilings, ambiguous component adjacency and existing reconstruction/fallback outcomes. The import transport forwards the existing `diagnostic` message variant, including the worker's original failure stack, through an optional callback. Results, requests, acceptance rules, numerical tolerances and canonical geometry remain unchanged.

Each log identifies the selected source filename/byte size/material names and exact unit/scale/repair/contact settings plus document revision/history depths. Worker `elapsedMs` values are relative to mesh preparation (or the worker request for its outer error); UI check/cancel/commit events are relative to the check start. Within-worker stage intervals can be obtained from consecutive elapsed values. Logs retain four runs, bounded strings/arrays, and the first 24 plus a rolling tail up to 1,000 events, with a dropped-event count. This preserves late failure evidence without retaining the complete input or output geometry. Downloads require the original source file alongside the JSON to reproduce a failure. Checks/diagnostics never create a document command. Cancel terminates the worker and ignores late messages; stale or rejected results cannot commit. Native project import retains its separate validator and is not recorded as a mesh diagnostic.

Named import policies admit up to 1,000,000 source triangles and 1,000,000 editable faces/vertices per shell. Selected files are bounded at 256 MB each and 512 MB combined. Project reading reuses the import face/vertex ceilings, allows 8,000,000 boundary segments per object and bounds the JSON file at 512 MB, so accepted detail does not immediately hit an older reopening guard. These ceilings are resource guards rather than latency or memory guarantees; increasing them does not relax geometric validation.

The validator checks closed topology, planarity, triangulation and positive volume; it does not exhaustively prove freedom from self-intersections. Reconstruction preserves polyhedral geometry rather than recognizing analytic cylinders or other surfaces. Planar merging is an optimization: a valid triangle shell remains importable when larger merged faces violate canonical planarity.

The build emits readable standalone HTML and an identical index alias, embedding the app and worker source directly. It does not generate a compressed payload or compact HTML alternative.

The standalone build embeds only the project modeling worker. `build/modeling-worker-bundle.js` is its plain runtime alias. There is no embedded CAD reader or STEP import path; STEP export is a separate project-owned writer. Existing imported solids in format 7 need no reader to reopen.

### 13.2 Export remains derived

PNG captures a read-only current-view image rather than an exchange mesh. `src/07_png_export.ts` snapshots camera, CSS viewport dimensions, immutable source solids, copied transforms/colors and explicitly requested references. Visible/selected scope excludes hidden objects; dimensions require all object anchors to be included. Active Move/Rotate transform previews are rejected without cancellation; other uncommitted geometry and selection/hover/debug overlays are excluded. Native schema and worker protocols remain unchanged.

`src/05_image_renderer.ts` renders through one reusable independent alpha-capable WebGL context and shared camera/shader/appearance helpers. Clipped triangle ribbons preserve line width at scaled resolution; Canvas 2D adds annotation text. Separate alpha blending factors preserve fractional build-plate opacity on transparent backgrounds. The PNG preview is the actual full-resolution composition; download encodes that same canvas. Revision/view/settings signatures and generation tokens reject stale previews/encodes. The existing Working overlay owns encoding progress and Cancel. Image buffers are released when the dialog closes.

PNG work is bounded by named 64-megapixel/16384-side, graphics-device, triangle and guide-segment budgets. After resizing the dedicated canvas, its actual drawing-buffer dimensions and context must still match the request; failed allocations never produce an enabled download. These limits reject rather than silently resizing. Mesh preparation/raster submission and an individual Canvas encode remain synchronous/host work; yielding before capture allows the dialog to paint, and encoding cancellation prevents download rather than interrupting the browser encoder. No image operation mutates geometry, commits history or changes the viewport camera.


Export uses geometry derived from the authoritative B-rep. A stricter conforming tessellation may be used for watertight STL output even when interactive rendering uses a simpler triangulation.

Export tessellation is never an alternative topology source.

For geometry formats, the Export dialog reads inexpensive canonical bounds and a face-loop triangle estimate through `geometryApi.exportPreview`; it never triggers render/export tessellation. STL delegates to `geometryApi.exportSTLAsync` and a fresh embedded local worker. `src/04_stl_export.ts` derives the same conforming world-space mesh directly from each canonical source, validates closed edges and finite coordinates, and writes binary records under the named 750 MB budget. The worker transfers the finished ArrayBuffer without copying it back, and cancellation terminates the worker even inside synchronous tessellation. Worker success, failure and cancellation release handlers, the worker and its Blob URL. No fallback repeats heavy kernel work on the main thread.

OBJ/STEP exchange encoding lives in `src/07_export_formats.ts`. OBJ obtains conforming world-space meshes from SceneGeometry. OBJ writes globally indexed triangles and normals, one object/material per source object, and packages the OBJ and MTL in a stored ZIP with checked sizes and CRCs.

STEP reads validated local topology through `geometryApi.exportPolyhedron`, implemented by `src/04_export_geometry.ts`. The kernel owns loop traversal and connected-shell extraction; the exchange writer owns STEP entity encoding. This detached read-only view preserves vertex identity, face outer/hole loops, normals and signed shell volumes. Shared edge curves, oriented edge loops and planes become an AP203 advanced B-rep representation. Negative shells become void boundaries with reversed underlying shell orientation. Multiple positive shells with no cavities are unambiguous; multiple positive shells plus cavities are rejected pending an explicit containment classifier. Millimetre units are declared. Object transforms are baked into points/directions, and each object has its own named product/shape representation.

`src/07_native_export.ts` assembles a scoped native document with the existing format-7 serializers (`serializeProjectObject`, `serializeGroup`, guide/dimension/build-plate serializers). It does not change the project schema, native reader, Save Project or canonical object encoding. Native export preserves transforms instead of baking them into mesh coordinates. The selected object IDs are the same scope resolver as exchange formats. Groups intersect that ID set and require at least two retained members; no unselected members are added. Selected exports include object-linked dimensions only when every object anchor is included; independent guides, world-only dimensions and build plates are excluded. Entire model is semantically equivalent to `projectData()`.

The native adapter snapshots object metadata/transforms and source-solid references plus cloned group/annotation/reference metadata before yielding. JSON writes use bounded UTF-8 chunks, reject non-finite numbers and enforce the native reader's 512 MB ceiling. Cancellation is checked between metadata fields, objects and chunk flushes, with the shared Working/Error dialog and one final download. One object's canonical serialization is synchronous; no new worker protocol or alternate geometric model is introduced.

The coordinator snapshots object metadata, transforms and immutable source-solid references before yielding. It uses the existing blocking Working state, progress, cancellation and persistent error feedback. Encoding has bounded chunks and byte budgets. No export commits a command or repairs source topology. STL cancellation terminates the background computation immediately; LamjaCraft/OBJ/STEP cancellation occurs between synchronous object-preparation stages and during writing/packaging. The main thread still structured-clones the initial STL request and creates the download Blob, so very large inputs retain snapshot and memory costs. All geometry formats keep separate objects; export never performs implicit Boolean union. Project format 7 remains unchanged.

## 14. Numerical policy and tolerances

Geometry tolerances are kernel policy and must have meaningful names.

Hashing/quantization may accelerate candidate lookup, but real geometric identity must use appropriate spatial/angular tests when bucket boundaries could alter the result.

Values controlling one operation family should be grouped in a named policy object rather than spread as unrelated numeric literals. CSG polygon fragments may supply their known construction plane during B-rep reconstruction. It is used only when finite, unit-normal, and all fragment vertices fit the existing planarity budget; otherwise reconstruction derives the plane from the vertices. This avoids amplifying numerical noise in nearly collinear fragments without widening geometric tolerances. Numerical searches must have explicit termination criteria.

## 15. Error handling

Expected geometric rejection is normal data flow, not a programming failure.

Prefer typed/result values for outcomes such as success, no event, invalid candidate, clamped result, or fallback required.

Exceptions remain appropriate for corrupted structures, violated internal invariants, and unexpected failures. If a lower-level routine throws for an expected rejection, convert it at one narrow adapter boundary.

The project compiles with TypeScript `strict`, `noUnusedLocals`, and `noUnusedParameters` enabled.

## 16. Performance and Worker boundary

Optimization must be measurement-driven:

1. remove algorithmic explosions,
2. eliminate unnecessary work in hot preview paths,
3. profile again,
4. move work to a Worker only when measurements justify transfer/copy overhead.

B-rep polygon reconstruction may use acceleration indexes only as exact candidate prefilters. The final weld/split decision remains the existing geometric tolerance test; an acceleration structure must not redefine which points split an edge. The same applies to coplanar grouping and vertex welding: buckets only narrow the search, a polygon joins the first group in creation order that passes the coplanar test, and welding picks the nearest vertex within the weld radius in the same visiting order a full neighbour scan uses. Where a tolerance test breaks ties by candidate order, a prefilter must preserve that order.

The existing serializable request/result boundaries can support future Worker extraction. Worker execution must not redefine document, command, tool, or geometry semantics.

## 17. Test contract

A geometry change is not complete merely because one reported model works manually.

Required principles:

- the existing regression suite remains green,
- a bug fix normally adds a regression describing the underlying invariant,
- committed solids are validated where relevant,
- preview/commit equivalence is tested when both paths are affected,
- deterministic generated/stress coverage supplements hand-written cases for large combination spaces,
- generated failures are reproducible from fixed seed/case parameters,
- architecture-boundary tests prevent app layers from bypassing `geometryApi`/`SceneGeometry`,
- command-boundary tests verify atomic rollback and rejection of invalid replacement solids.

See `RULES.md` for the detailed development checklist.


### CSG boundary resolution

Polygon splitting preserves both exact segment endpoints. The CSG rebuild may resolve original adjacent boundary vertices below `TOL.minimumEdge`; spatially close disconnected loops are never joined by this rule. An existing endpoint is reused only if all incident construction planes fit `TOL.plane` and every original member stays strictly inside `TOL.minimumEdge`. Successful merges monotonically remove vertex roots and revisit incident edges. Degenerate loops are removed before half-edge creation. Default non-CSG rebuild callers retain their existing behavior. Final canonical topology, orientation, planarity, volume and Combine connectivity validation still apply.

Flat sketches use `geometryApi.sketchDeleteCandidate` as a read-only classifier: a split-provenance region must have a coplanar adjacent face, and a structural Support face is not itself a sketch target. A coplanar rim can resolve the region from the supporting side. Clicking uses the existing `deleteSketchBoundary` / `dissolve-face` command and topology mappings. Rendering highlights only the current sketch hover during Delete, avoiding destructive highlighting of an old selected face. The dissolve/rebuild algorithm is unchanged.

### Chamfer face-interior directions

Canonical face loops have validated orientation: outer loops are counterclockwise and holes clockwise relative to the outward normal. Both keep material on the left of every directed half-edge. Chamfer obtains each incident face-interior ray from its normal crossed with its own half-edge tangent, using the twin's opposite orientation for the other face. Pass the known half-edge at the kernel call site to avoid boundary lookup. Coordinate-only callers may resolve either endpoint order to the same oriented boundary edge.

Do not use fixed-distance domain probes to classify these rays: fuzzy point-on-segment acceptance depends on segment length and can put both probes on the accepted boundary of a short edge. This is an eligibility rule, not a change to screen picking, solid tolerances, angle admission or allowable edit distances. Preserve independent outer/hole material-side witnesses and real direct/Ctrl/Shift short-edge interaction checks. External geometry still enters through the existing validated canonical boundary.

### Chamfer side and curved-chain multi-selection

Both Chamfer controllers share transient mode, source identity/revision,
oriented edge groups and parameter state. Ctrl click uses the logical straight-side classifier. Shift click uses `geometryApi.chamferCurveCandidateEdges`: walk predecessor/successor edges on each incident face loop while neighboring directed tangents turn strictly less than the named 45-degree policy and the included profile angle remains compatible. Compare neighboring directions, not each direction with the seed. Search both incident loops to support wall picks; map the winning path back to the picked side. Prefer the longer path, retaining the original face on a tie. No world proximity search, cross-face branch jump or persistent geometry cache is introduced.

Groups share undirected half-edge membership. A fully selected requested group is removed; an overlapping incomplete group adds only missing members. Ctrl refinement removes only the requested logical side. Collinear Ctrl expansion happens before selection; the explicit API normalizer validates/deduplicates exact members and never expands a partial Shift rim. Picked setback orientation is preserved.
Straight Chamfer prepares a validated combined preview; Rounded Chamfer only
highlights source sides until release. Hover movement does not recompute the
selected geometry. The renderer draws source edges in world space.

The optional ToolController.keyUp receives shared key-up dispatch. Releasing
the last Ctrl/Shift modifier either commits the exact bevel preview or starts
one rounded worker job. Rounded requests can carry an optional explicit
oriented half-edge list, produced by the same geometryApi straight-selection
classifier. Legacy single-edge requests omit the list and still expand their
logical side/rim in the worker. Both paths use the same connected profile construction; no rounded operation is split into successive document mutations.

One guarded chamfer-edge or rounded-chamfer-edge command replaces the source
solid and owns topology mapping, reference handling and history. Rounded
results are validated by worker reconstruction; a batch commit additionally
checks the captured revision, source identity, visibility and group membership.
Empty/invalid/stale/blocked releases and worker cancellation/failure do not
commit. Controller cancel/cancelStep integrates Escape and tool/document
changes; parameter edits, focus loss and hidden documents also discard the
selection. Native format and geometry kernel policies remain unchanged.

### Connected planar Chamfer paths

The kernel partitions explicit selections by canonical endpoint connectivity. An unbranched component whose edges are consecutive on one supporting face loop uses shared miter stations, including open chains and non-circular closed outlines. Offset-line intersections solve the support setback; neighboring side planes solve the second setback with existing inclination, residual and miter checks. Uniform wall-side picks exchange physical rays/setbacks; additive rays retain the chosen free wedge. Equal-setback cuts can normalize mixed orientations symmetrically.

A station is shared by neighboring edge/profile parameters. Only the outer cutter shell and free endpoint caps are emitted: internal station triangles and radial fan sides are omitted. Classify rail reversal explicitly. Opposing convex turns exhaust material and retain the distance rejection. At a mixed convex/concave transition, a short inset segment can fold locally while both requested profiles still fit. For Cut, split at the implicated convex transition and form the Boolean envelope of the non-folding runs. Curved runs retain shared stations; there is no per-facet independent-cutter fallback. Collinear subdivisions contribute no turn. Each partition strictly reduces the selected path; preserve exact physical setbacks, bias, rounded sampling and endpoint bounds. Extend retains its previous overlap guard. Diagnostics identify the mixed-turn envelope. This construction preserves the existing miter path and its exact output whenever no rail reverses. Spatial/branched or incompatible mixed-orientation components retain their independent-corner semantics; this is not a general three-way fillet junction solver.

Subtractive open ends retain the existing minimum overrun, but must also clear every outward-facing terminal plane incident to the canonical endpoint. Walk only its half-edge vertex fan. Intersect both extreme setback rays with each end plane along the edge tangent, including a named geometric clearance; the maximum bounds the whole triangular section and every rounded profile inside it. Compute the two ends independently. Parallel planes cannot bound an endpoint and use a named division-roundoff cutoff. This prevents a fixed overrun cap from leaving a thin lip at obtuse or spatially sloped ends. Additive ends retain zero overrun. Do not replace this with an angle guess, a larger fixed multiple or a whole-model bounding box.

Each selected component is processed exactly once. A complete circular/hole component retains the existing closed-rim path; partial rims remain partial. Multiple complete rings are combined into the same cutter rather than letting the first ring consume the entire selection. Straight and rounded dispatch share this contract, while normal clicks still expand automatic rims before the explicit kernel call. Validation, topology mapping, cancellation/stale guards and atomic command history are unchanged.

### Setbacks crossing curved support facets

Independent subtractive edges on a certified constant extrusion can have a setback longer than the first incident facet. Find the canonical end-section loop and trace each physical setback along that boundary, including collinear subdivisions and smooth turns strictly below the named 45-degree support-trace policy. Preserve exact requested distances and picked-side bias. End stations and axis-parallel/perpendicular planes must certify one translated section; tapered, twisted, sloped-end or other spatial arrangements keep the existing construction. A candidate still contained in its two original planes keeps its exact old coordinates.

The actual endpoint tangents define the rounded conic; a straight cut joins the actual endpoints. The closed removal section follows both traversed source boundaries, rather than extrapolating the first face or returning to it through an artificial radial plane. Emit the prismatic cutter shell directly, with triangulated caps and boundary quads. Do not union touching fan prisms or enlarge the cutter across unrelated geometry. Self-intersecting profiles, unstable/folded tangent solutions, wrapping and sharp continuation after curved facets reject without changing the requested distance or source. Ordinary sharp two-plane candidates retain their existing path and validation outcomes. This is a constant-section construction, not a general spatial fillet solver.

A 45-degree bias still means equal physical setbacks. Once a support bends, equal traced distances need not give equal distances from the intersection of the endpoint tangent lines; the tangent profile can therefore be elliptical. Preserve independent conic/volume and endpoint witnesses when changing this rule, in addition to manifold/serialization checks. Keep additive ends, connected rim stations, Ctrl/Shift, worker transport, cancellation, prepared previews and command/history ownership shared and unchanged.

### Additive Chamfer profiles

The optional `ChamferOperation` (`cut` / `extend`) shares the existing corner frame, setback profile and rim-miter builders. Cut admits convex material wedges and subtracts the profile tool. Extend admits convex or concave corners: convex frames reverse the selected face-interior ray to continue its plane outward; concave frames use both face-interior rays to fill the free wedge. The detected profile angle governs circular tangency. Closed rims solve the signed selected-plane offset and side-plane intersection depth, keeping support ownership independent of the picked cap/wall half-edge. Additive straight tools stop at edge endpoints; only subtractive cutters overrun. Union/subtraction reconstructs the same validated canonical B-rep through existing CSG boundaries.

Geometry API, optional rounded worker fields, diagnostic input and command metadata carry the operation. Omitted fields use Cut. Operation is transient UI state; native projects persist only committed geometry. Mode changes clear previews and batches; rounded jobs capture the operation and reject stale mode results before commit.

### Chamfer UI modes and Push/Pull snap scope

The Chamfer family exposes one toolbar entry and one outer options panel. Rounded switches between the existing `chamfer` and `roundchamfer` controller/command paths. Mode changes cancel stale transient previews through `setTool`, carry distance/bias between the existing parameter fields and keep segment count specific to the rounded mode. Mode selection is transient; H/U explicitly choose each variant and the toolbar button recalls it. Busy jobs reject mode switches. The existing geometry/worker boundaries remain unchanged.

A face Push/Pull owns the snap exclusion for the face it moves. It obtains local boundary edges through `geometryApi`, excludes both half-edge orientations before guide-edge intersections are derived and excludes the same-object boundary points/midpoints/circular centers. `SnapQuery.acceptCandidate` is optional and runs before candidate deduplication; other callers preserve their previous behavior. Candidate source identity keeps independent objects and guides eligible even at an excluded coordinate. This changes gesture snapping only: numeric distance, grid snapping, canonical geometry and document-command semantics are unaffected.

## Optional display shadows (v0.9.111)

`05_shadow_renderer.ts` owns a disposable light frame, RGBA-packed depth texture, 16-bit depth renderbuffer and GPU pass. The shared fragment shader samples a 3×3 filter, retains fill light by bounded darkening and emits fractional alpha for the shadow-only ground. Caster slope/units polygon offset plus receiver texel bias avoid self-shadow acne. The light frame includes the complete projected footprint and a receiver at or below Z=0/the lowest included object. No receiver enters SceneGeometry, picking, snapping, model bounds, geometry export or persistence.

Both viewport and PNG call the same shadow renderer. Mesh identities define cache invalidation: transforms, source/preview solids, scope/order and visibility change the light map; camera, object color and output resolution do not. The viewport includes active derived editing meshes; PNG retains its immutable canonical snapshots. Reference edges/grid/guides remain unshadowed. A complete neutral sampler is supplied when disabled. GPU resources are allocated lazily, bounded by named map/triangle/device policies and released when PNG closes. Failed partial allocations are deleted; viewport failures turn off the optional control with a message, while PNG invalidates the image and asks the user to turn Shadows off. Material metadata and native format remain unchanged.

## Cone and sphere text strips

`03_text_wrap.ts` owns only the new Text geometry paths. It fits a concentric round profile to canonical vertices, verifies a straight taper or sphere and constructs a full-ring periodic chart around the selected local axis. Horizontal chart units refer to the clicked B-rep ring perimeter; vertical units are cumulative meridian chords. Affine charts on derived source triangles interpolate longitude/meridian coordinates; bounded radius-ratio refinement avoids shearing a whole conical panel along one broad diagonal. Zero-area refinement scraps are discarded before barycentric lookup without changing source geometry. Glyph material triangles clip and union on each source plane; covered chart area must equal the full glyph area. No partial-letter fallback exists.

Source-incident plane constraints define shared vertex offsets; affine interpolation gives matching roof points on source/chart edges and exact normal depth on each facet. Preview accesses the same field through `geometryApi.faceTextWrapPoint`. Roofs and exposed walls pass through the existing checked `applyTextSurfaceSkin` boundary, preserving glyph counters and canonical reconstruction. Shape, pole/cap, depth, clipping, chart and generated-face budgets belong to `ROUND_TEXT_POLICY`; common tolerances and reconstruction remain unchanged. The existing face-text request carries optional wrap settings, uses unchanged worker transport and commits through the existing prepared Text command. Native format and saved geometric truth remain unchanged.


### Wrapped text offset-boundary ownership

Round Text resolves derived clip points near source corners jointly across incident faces within sqrt(2 × canonical minimum face area), about 0.000142 mm and below the font flattening bound. This absorbs sub-minimum construction ears without changing source coordinates or requested normal depth. Preview and commit share the resolved footprint. Round Text normal offset is piecewise affine on original source triangles, so a collinear footprint subdivision can become a real roof corner. Caps triangulate the actual offset polygon, not its unoffset footprint; connecting walls use the same footprint endpoints and normal-offset field. Retained boundaries reach the canonical constructor without earlier independent collinear simplification. Hole-free retained regions enter reconstruction as whole oriented polygons, preserving microscopic intersection ears until collective boundary resolution rather than normalizing them as independent faces. The combined retained skin/roof/wall reconstruction requests existing plane-constrained short-boundary resolution. Other Text mappings keep their existing reconstruction options. No placement jitter or implicit depth change is permitted.

When `preserveBoundaryCorners` is requested, canonical reconstruction's collinear simplification before global edge splitting must not exceed the split point-to-segment distance. A corner retained by an incident wall must remain eligible for reinsertion on a simplified roof edge. `splitAllFaceEdges` uses the existing weld*4 insertion budget for that request; default reconstruction and other standalone simplifier callers retain their previous budget. This preserves more geometric detail instead of relaxing welding, validation or native precision.

### Color-only document history

`04_object_color.ts` owns the preflighted color document command. Its only persistent mutation assigns a validated hex color to resolved editable targets. It cancels pending tools before capturing history, uses `applyCommandExecution` for selection/hover normalization and records target colors plus selection as `ObjectColorHistoryState`. No callback from another tool can opt into this path. Full snapshot commands retain `executeDocumentCommand` and its existing lock/topology validation and rollback.

History restoration dispatches by the presence of the color state's `kind` discriminator; ordinary document snapshots retain their original restoration path. Color restoration pre-resolves stable object IDs before assigning colors and restores the captured selection, clearing hover and surface sketch as ordinary history does. This remains valid across interleaved snapshot commands that replace object instances. New sessions create history and clear redo; continuing the same palette session replaces only its latest after-state, including at the 100-entry cap.

Color Apply/Undo/Redo increment document revision, mark dirty and request a redraw. They retain geometry-derived cache identities because solid topology and object transforms are unchanged. `ensureScene` therefore uploads current color data without triangulating the objects again; picking, export meshes, smoothed normals and shadow-map geometry remain reusable. Native serialization and ordinary geometry command history are unchanged.

### Finite curved split guides

`03_split_surface.ts` represents a cutter as a rectangular height field with fixed local in-plane coordinates, rows/columns and signed normal heights. The two triangles per cell define both displayed and committed cut geometry; no invisible smoothing replaces the requested shape. The normal-height brush uses `(1 - distanceSquared / radiusSquared)^2` inside its influence radius and zero outside. Grid refinement is explicit. Bounds, point counts, finite heights, perpendicular unit frame axes, template byte size, source-face and material-volume budgets are named in `SPLIT_SURFACE_POLICY`.

A derived cutter extends to cover all target vertices in its local UV projection. It appends at most one coordinate beyond each grid edge and repeats the corresponding boundary heights; corner extensions repeat the corner height. The editable grid is unchanged. Extension coordinates are nonuniform, and original grid coordinates/triangulation remain exact. Two oppositely oriented watertight construction volumes enclose each side of the same triangulated sheet beyond all target/grid heights. Their artificial rim and cap lie outside the intended cut; an explicit margin beyond the projected target keeps artificial perimeter cuts outside the source. Existing CSG intersection and B-rep reconstruction return two nonempty validated solids whose summed volume matches the original. No common tolerance, reconstruction or Boolean semantics are relaxed.

`04_split_surface_model.ts` owns grid/guide commands and prepared split commit. `06_split_surface.ts` owns normal-only point picking/drag preview, brush display/session state, shape-file templates and the asynchronous split coordinator. Preview height changes are restored before commit, tool changes, Escape, document mutation and history; source capture checks the canonical solid, transform, guide shape/frame and document revision. Existing worker transport handles an additional typed request/result and Cancel terminates the job. One split command freezes affected dimension anchors, replaces the source, inserts its second side and consumes the guide.

`GuidePlane.surface` is independent construction data, never a persistent object mesh. Its exact valid frame and grid are deep-copied in history and serialization. Guide snapping exposes actual displaced points and does not offer an intersection with an imaginary flat base plane. Whole-guide transforms preserve the height grid. PNG guide snapshots use the displaced row/column paths and reject unfinished bend previews. Template format `lamjacraft-split-surface-template` version 1 stores only name and grid. Project format 8 is selected only when a curved guide is present; ordinary format-7 reading/writing remains compatible. A format-7 file carrying a surface field is rejected rather than interpreted ambiguously. Native full export/import preserves guides and thus format 8; selected-object exports omit unrelated construction and remain format 7.

### Document object capacity

`PROJECT_CAPACITY_POLICY.maximumObjects` in `04_model.ts` defines the total solid-object capacity (1,000). Counts include hidden objects and individual group members, independent of selection. Every construction/import/duplication/split boundary consults this policy before document mutation. Subtraction and detached shell replacement use the resulting net count after consumed inputs. Prepared curved splits also check the current capacity before commit, independently of revision/identity guards. Single-object and guide creation remain separate semantics; guides do not occupy the object budget.

The project reader and project-addition capacity policy use the same object maximum. Increasing this bound does not change native encodings, schema versions, topology validation, worker lifecycle or history format. Per-operation geometry budgets, group/reference counts and file/mesh limits remain separate policies. Dense height fields permit up to 30 rows/columns; their 900 signed heights remain ordinary construction-guide/template data.

Split Plane handle axes are transient UI choices. Translation applies the chosen surface or world direction to the guide origin. Rotation applies one rigid rotation to both the guide normal and stored in-plane axis, including normal-axis spin. Controller previews restore the original frame before committing through `updateGuidePlane`; surface heights and dimensions remain unchanged.

## Object clipboard and paste placement

`04_object_clipboard.ts` owns a session snapshot of independently cloned objects and flat group membership. Complete group selections retain hidden members in the existing objectSelection IDs, including secondary selected groups; partial selections copy individual objects. Copy allocates no document IDs and does not enter history. The clipboard remains outside the persisted project and survives document replacement in the same application session.

`06_object_clipboard.ts` starts the existing object Move controller with staged objects outside ModelDocument. Shared Move delta/snapping/axis/numeric logic updates their transforms; SceneGeometry derives preview meshes separately from picking/export/snap/document inputs. A preview revision invalidates the render buffers without incrementing the document model revision. Camera navigation suspends and rebases the same pending Move gesture. The renderer shows staged visible solids and optional shadows while normal persistent objects remain unchanged.

Final placement checks the captured document revision and object capacity, then one paste-objects command clones fresh object/solid IDs, remaps group members, selects the new copies and validates changed solids. Source locks are preserved and copies are unlocked. Cancellation, tool/history/New/Open transitions clear the transient preview without allocating IDs or recording history. Keyboard dispatch owns Ctrl/Cmd+C/V only outside native editing, dialogs, composition and busy workers. No system clipboard permission, serialization schema or worker transport change is introduced.

## Native Open preparation

`04_project_reader.ts` and `04_object_format.ts` own the existing native-object validation and pure codecs shared by synchronous readers and the isolated `native_open_worker.ts` build. The native Open worker has its own Blob URL and lifecycle; common modeling-worker dispatch and cancellation are unchanged. It reads/parses the selected file, checks each canonical object and derives disposable mesh/appearance data. The coordinator requests one object at a time so structured-clone delivery cannot flood the UI event loop. Reference/schema compatibility checks remain in the shared native reader.

`07_native_open.ts` stages the complete validated project, first-view caches and ordinary snapshot history outside the document. It checks cancellation and document revision between phases and captures the old document object by object. The checked Open command is the only replacement boundary: no event-loop yield occurs during mutation, and it records one ordinary before/after Undo entry. No geometry is deserialized, modified or revalidated at this boundary. The existing synchronous `loadProject` remains available to internal integration callers.

SceneGeometry installs only data generated by the local reader for its staged canonical solids/transforms; normal invalidation continues to discard it. Initial render buffers use the same generator as ordinary synchronous scene rebuilding, with bounded triangle/edge chunks and cooperative yields during Open. Rendering is suspended while preparation and the first view are staged. Cancel remains available until the atomic replacement; after replacement the final view stage completes with the busy overlay still visible. Native format versions and geometric truth are unchanged.

## Cached viewport hover feedback

`geometryApi.faceMetadata` copies only face identity, plane and provenance metadata. Labels use this read-only query rather than the complete face view; no boundary walk, area computation or triangulation belongs in label display.

SceneGeometry caches canonical topology counts in a WeakMap keyed by source solid and BVH node counts by root identity. Scene totals aggregate the current visible object set and current mesh/root on demand, so lazy BVH creation, transform-derived replacements, visibility and prepared native Open remain observable. New solids automatically miss the topology cache; garbage collection can discard unreferenced derived records.

The viewport renderer assigns disposable face keys when it rebuilds static scene buffers. Two small integer components in a vertex attribute identify each face across object-local ID collisions and scenes above 65,536 faces. Zero marks non-face vertices and explicit geometry-preview colors. Hover/selected-face fallback selects a key through uniforms; the vertex shader uses the existing lighting policy and selected-object ambient, retaining ordinary fragment shininess/shadows. Buffer identity does not depend on the focused face. Other buffer invalidation causes (document, object selection, styles and geometry previews) retain their prior behavior. These keys never enter model geometry, snapping, history, PNG snapshots or native serialization.

The shared hover feedback function owns one lazy raw hit for its ordinary queries and group/lock guards. It does not cache across events, camera changes, gesture updates or document mutation.

## Shared sketch preparation

Circular snap centers are derived from `geometryApi.faceLoops`; the complete face view and its area/triangulation are not prerequisites. Local centers remain keyed by source-solid identity and face ID. World centers are transformed from that immutable local cache for the current object, retaining existing visibility and source-reference rules.

Compatible ordinary face-feedback tools share a static-buffer mode. Uniform highlight state and overlay drawing remain tool-specific. Live Push/Pull preview keys and specialized Delete, Move Point and Merge Faces state retain independent invalidation; cancelling an active geometry preview must restore canonical buffers even when the destination tool shares the ordinary mode.

The sketch properties panel classifies provenance through metadata first. It reads boundary loops/basis only for an actual sketch region and never requests area merely to display sketch dimensions.

## Derived snap geometry

`04_snap_geometry.ts` adapts canonical `geometryApi` queries to disposable snap inputs. Returned arrays, coordinates and source references are shared read-only session data. Local circular centers use the source-solid/face cache. World face edges/centers and whole-object snapshots belong to a WeakMap keyed by ModelObject, with source-solid identity, object ID and every transform component checked on lookup. No model revision, selection or appearance value is a geometry cache key.

Global snapshots compare the ordered records of the current visible objects. A changed transform or new solid replaces only that object's record; unchanged objects retain their derived arrays. Object replacement with a reused ID cannot reuse the previous object's references. Ground filtering is derived from the actual global edge/center array identities. In-place transient transforms and their cancellation are observed without relying on a command or revision increment.

The existing immutable committed-solid contract also applies here. Cache records never modify canonical solids. Geometry commands replace their source solids, and Undo/Redo restores objects through the existing codecs. Caches are not serialized or copied into history and can be reproduced from canonical data. WeakMap records are collectible when their objects are no longer reachable; recent scene/ground snapshots retain their referenced records until the next aggregate query replaces them. The first lookup still prepares the requested data and retains additional memory. Candidate generation, guides, inference, occlusion and ranking retain their existing algorithms.

## Spatial snap broad phase

`05_snap_spatial.ts` owns disposable world-space edge/point bounds trees. The SnapEngine query explicitly opts in with a certified affine or pinhole projector and immutable edge/point snapshots. The third projection result is affine camera depth and the pinhole pole is depth zero. The application adapter opts in only for arrays registered by the derived snap-geometry service; temporary filtered or mutable caller arrays stay linear. New source/transform/visibility snapshots have new identities and therefore new trees. WeakMap caches do not persist geometry or camera state.

Each query projects the eight expanded world-bounds corners. With an affine projector, or a pinhole projector whose depth has one sign throughout the box, their screen rectangle conservatively encloses the box projection. A depth-zero crossing or non-finite projection prevents culling. World and screen padding account for arithmetic roundoff. Small lists and invalid query radii retain the linear path. Invalid item bounds are always processed by the exact path. Tree construction uses deterministic median partitioning; shortlist indices are sorted into original input order before candidate math, source-dependent acceptance, deduplication and ranking. The tree does not cache projected coordinates and therefore survives camera changes without a projection revision key.

This broad phase applies only to geometry candidates. Guide crossings still inspect every accepted edge: remote crossings can bound a guide span whose midpoint is near the cursor. Inference keeps its complete reference directions/anchors. `SnapQuery.acceptEdge` applies identically to geometry candidates and guide/edge intersections; it is equivalent to filtering the input list before the query. It does not filter independent center or guide points.

Push/Pull caches its source-boundary exclusion by the immutable face-edge snapshot and center snapshot. Excluded point membership uses a tolerance-sized spatial grid, conservative neighbor cells and the original Euclidean-distance predicate. Large/invalid bucket coordinates and small point sets retain the linear membership test. Source-object ownership checks remain outside membership, so independent coincident objects remain eligible. The viewport visibility callback remains authoritative after broad-phase filtering. No geometry preview, commit, tolerance or history behavior changes.

## Query-local snap visibility

The viewport adapter `createSnapVisibilityCheck` wraps the existing `snapCandidateVisible` function for one synchronous SnapEngine call. Its two maps key exact world-number coordinates; they never use snap-tolerance quantization or screen XY. One map serves ordinary geometry and one serves guide-display sources, whose Show Guides/Through Solids policy differs. The current visibility rule depends on point coordinates and that policy class, not endpoint kind or owning object. If that rule gains other source-dependent inputs, its memoization key/contract must be updated accordingly.

Each adapter creates a fresh wrapper per query. No result survives a pointer event, camera update, object hide/show, setting change, geometry/preview update or document command. The wrapper captures the physical visibility function for that query and retains both true and false results. Push/Pull ownership/source-boundary exclusion runs before physical visibility, so rejection of one owning source cannot suppress an independent coincident source. Generic SnapEngine collection, candidate deduplication, source selection, spatial shortlisting and ranking are unchanged. This wrapper must not be used as a cache for arbitrary tool acceptance predicates.

## Shared history geometry

`04_history.ts` owns internal `HistoryDocumentState` records separately from independent serialized `DocumentSnapshot` values used by debugging/compatibility. Each internal object copies its properties but references an opaque `HistorySolidVersion`. The geometry API creates the owning `SolidHistoryStore`; its detached canonical maps, arrays and metadata never leave the private store. Weak source/version maps permit reclamation after sources and retained history entries disappear. Versions are shared only after exact canonical field, metadata, provenance and map-order comparison; identity alone is insufficient. This detects in-place edits without exposing a historical copy to later document mutation.

History capture does not sort or serialize unchanged topology. Restoration compares live geometry with the private version, retains matching object/solid identities, and deep-copies only changed/missing geometry. A private version was captured from internal document state; its restore copies a known state rather than accepting an external file or rerunning geometry algorithms. File readers and new changed-solid command validation retain their existing checks. Unknown/foreign handles reject. Legacy serialized history still uses its fully checked restore path.

Ordinary command completion invalidates only changed/removed geometry and transformed objects. History restoration does the same, preserving unaffected scene meshes, bounds, triangle BVHs and snap caches. Failure rollback uses the private before-state and restores in-place geometry changes, properties, organization, counters and references without touching history stacks. The existing document-change tool teardown, selection normalization, dirty/revision/render notifications, 100-entry retention and redo branching are retained. Native Open captures the same versions while yielding between objects; its checked worker transport and initial prepared display installation remain unchanged.

Content comparison still scans unchanged topology, so history capture/restore is linear in model size and is not constant-time. A new geometry version requires a detached copy; changed/missing geometry must be copied on restore and may require fresh display derivation. History sharing changes neither canonical geometry nor native serialization.

SceneGeometry additionally retains recent history meshes/bounds/BVHs/export meshes in a disposable LRU cache. It stores at most 1,500,000 retained triangles, 2,000 records and two world transforms per geometry version. Oversized or evicted records use ordinary mesh derivation. Retained records contain derived data only, not canonical solid references or version handles; active private geometry versions are weak keys. Capture remembers an already-derived matching view without forcing work; traversal remembers the outgoing view before changes and rebinds a retained incoming view to the restored canonical solid. Exact geometry-version and world-transform matching prevents stale views. A scene record already tagged with a different geometry version cannot be remembered under a newly changed version. The budget counts triangles, not bytes, and is separate from active scene cache memory.

## Conservative triangulation point search

Compact hole triangulation builds a static bounds tree only for large bridged boundary-node lists. Linked-list clipping and duplicate bridge ownership remain authoritative. Removed nodes become inactive in the index; surviving node neighbors still determine the original reflex predicate. Candidate order within the search is immaterial because the rejection predicate is pure; clipping visits ears in its original order. Small inputs and uncertain queries use the original full linked-list scan. No topology, coordinates, winding or ear tolerance is changed.

The original point-in-triangle test admits three oriented half-planes down to -1e-12. For a positive-area triangle, an accepted point has barycentric weights bounded below by -delta. A rectangle expanded by twice delta times each coordinate span contains those points. The search uses a larger margin, a conservative orientation-roundoff bound based on the maximum coordinate magnitude of all indexed nodes, an area lower bound and coordinate-roundoff padding. Near-degenerate area, non-finite bounds and possible cross-product overflow fail open to linear search. The tree never replaces exact ear tests. Existing compact failure classification and planar-slab fallback are unchanged. The tree is local to one triangulation call and is not persistent model data.

## Face-edit preparation and validated display data

`planarFaceReceivingEvent` applies the existing opposing-normal, signed-distance and requested-range tests before building the unchanged full boundary/triangle-centroid witness set. If no receiving plane qualifies, no domain witnesses are needed. Once a plane qualifies, every original witness and domain test remains authoritative. No sweep distance, event type or tolerance changes.

The face-move command explicitly opts into reuse of a result with one connected face component. It already commits that original result when splitting yields one solid, so an independent clone/validation was unused. Default `splitConnectedShells` callers still receive detached geometry; multiple components/cavities retain their existing splitting/validation path.

`validateWithMesh` observes the exact mesh computed by the existing complete solid validator; it does not replace or weaken validation. The command collects valid local meshes without touching scene state. After all changed solids validate, history is captured and stale geometry is invalidated; SceneGeometry transforms/installs these meshes with the committed object transforms. Bounds and future appearance/BVH state remain owned by SceneGeometry. Failed validation rolls back before any prepared mesh is installed. Public validation report shape, external readers, worker transport, canonical B-rep and file/history formats are unchanged.

## Mirror

`04_mirror_model.ts` owns the Mirror document command; `06_tool_mirror.ts` owns plane selection and transient state. A reference face is read-only and independent of selected target objects. Mirror calls `geometryApi.reflectThroughOrigin` with the world plane normal transformed into each object's local frame, keeps its proper rotation, and reflects its world position. The kernel adapter returns a detached canonical solid, reflects vertices/face normals and reverses every outer/hole half-edge cycle while retaining IDs and twins. This restores outward winding after the determinant-negative reflection. Vertex and endpoint-based dimension anchors retain their identities. Copy mode assigns new object/solid IDs and copies complete groups; partial groups remain individual copies. Native geometry and transform schemas are unchanged.

The normal command path validates all changed solids completely before history/display installation; no Mirror validation bypass exists. Selected targets must be unlocked closed solids. The plane reference may be a locked object. Plane drafts depend on document/selection revisions, source object/solid identities, exact transforms, and the visible reference identity/transform. They are disposable, outside the document/history and cleared through controller cancellation. Hover only uses shared picking/highlight feedback; stored outlines show the infinite plane without generating mirrored geometry.

### Carve Out planar inset events and guide ownership

`carveInsetConcaveProfiles2` owns the planar erosion used by both the same-face guide and the certified concave-prism cavity. The wall is a union of finite inward side strips and reflex miter joins. Clip their oriented inner boundary segments against every strip/join and the original source; trace the remaining closed directed boundaries. This single construction handles local edge loss and nonadjacent contacts without retaining reversed segments, extrapolating an obsolete edge or clamping the requested thickness. Coincident endpoints are matched by actual distance in neighboring buckets. Roundoff-collinear subdivisions are removed before coordinate normalization. The trace requires closed nonbranching positive simple loops; degenerate contacts and exhausted regions remain unavailable. Preserve complete-segment source clearance, triangulability and normal final-solid validation. No triangulated solid or heavyweight CSG is generated for the guide.

Keep every surviving pocket, including small ones. A temporary split is a valid planar erosion: generate each pocket with the same floor depth and opening extension, then subtract all cavities through the existing checked CSG path. The surrounding result still must be one connected valid solid. Do not silently keep the largest pocket, discard small regions by a new arbitrary threshold, or reverse collapsed outlines into phantom cavities. The planar solver is specific to constant extrusions; nonprismatic concave sources use the separately certified 3D path below. Holed source openings remain excluded. Convex committed shells retain the existing half-space builder. Diagnostics count surviving prismatic inner planes.

`05_render.ts` owns at most one disposable opening guide containing the complete set of inset loops. Its key contains the exact object/solid identities, face ID, wall value and world transform; null results are cached too. Camera-only frames reuse it. Tool cancellation and successful consumption release it; source, face, thickness and transform changes derive again. It never enters native files, history or authoritative geometry. Draw every surviving pocket without array-index connectors; an inset can have fewer edges and more regions than the source.

### Certified concave 3D Carve Out offsets

`03_carve_offset_3d.ts` owns the tool-local nonprismatic path. It does not change common B-rep reconstruction, tolerances, worker transport or native storage. The normal convex classifier returns a geometric result; concave prisms retain their planar erosion path. Other concave sources may use exact incident-plane offsets only when the resulting shell retains compatible topology.

Use a private detached source clone. Normalize each original face plane, inset nonopening planes by the requested wall plus the existing conservative detail inset, and leave the opening plane at its original level while certifying the interior. Source-plane groups retain all member face IDs so repeated-facet protection/detail suppression maps to the correct faces without changing their actual normals. Solve rank-three incident constraints exactly; compatible rank-two/one fans use the minimum normal displacement. Every incident plane must satisfy the same residual bound, including higher-valence vertices. Do not replace inconsistent intersections with least-squares fits, move only selected faces, clamp thickness, or reuse an approximate mesh as canonical geometry.

Certification requires one connected source boundary and a simple outer supporting opening. Reject vertex merging, edge collapse/reversal, crossing/touching face rings and invalid candidate topology. Reuse the mesh produced by normal validation for complete source/candidate surface checks. Triangle contacts may coincide only with their canonical shared boundary; within one face, derived triangulation may meet along zero-area seams but may not overlap in area. Check minimum whole-triangle distance to every potentially close nonopening source triangle. Include vertex/face, interior edge/edge and piercing witnesses; vertex sampling alone is insufficient. Broad-phase padding is the actual wall distance and cannot omit a closer pair. Explicit triangle/work bounds reject rather than skip remaining checks. Finally require the closed candidate minus the source to be empty using the existing exact CSG implementation. The final hollow still receives complete normal validation, one connected result-shell enforcement and the ordinary checked document command.

Only after certification replace the candidate opening cap with its outward normal extrusion. The source is entirely behind the supporting plane, so the added cap extension cannot alter the certified cavity inside the source. Every surviving source feature follows its actual offset planes: the cavity may enter a boss or wrap around a recess. This path deliberately rejects offsets requiring changed corner incidence, consumed 3D features or nonlocal topology changes; it is not an unrestricted concave shell solver. Those outcomes must never become an unchecked fallback or a largest-component choice. The prismatic solver still resolves its supported topology events separately.

For nonperpendicular opening walls, `carveSpatialOpeningGuide` visits only the opening vertex fans and solves the uniform-wall rim at the original opening plane. This remains a lightweight opening cue, without whole-solid validation, containment or CSG on hover. Perpendicular rims continue using the shared planar guide, including its split/consumed-edge handling. Cache ownership/dependencies remain exact object/solid/face/wall/transform with one disposable record; camera frames derive no new corner intersections. The ordinary worker owns full 3D preparation, progress, cancellation, stale-source rejection and one-command history. No new worker message type or persisted schema is introduced.
