# Transient Sketch Editor

Sketch Editor starts from a selected planar solid face, or asks for a face after
Editor is selected under Sketch. Its modal workspace draws in millimetres in a
face-local plane. Drafts are intentionally not saved. Return validates closed,
non-intersecting contours and stages mouse placement of their origin on the
source plane. A placement click inserts ordinary B-rep face boundaries in one
atomic document command. The native format and solid representation are unchanged.

Lines can be drawn in separate chains and joined through endpoint snapping.
Rectangle, Circle and three-point Arc create polylines. Select can drag shared
points or delete a stroke. Guide and Measure are temporary construction aids and
are excluded from contour validation and insertion. Exact entry provides deltas
for Line/Guide/Measure, width/height for Rectangle and radius for Circle. Choose
the first point before Add exact. Wheel zoom and middle/right pan affect only
the editor; the model camera is retained. Show face outline provides an optional
read-only reference. The red/green axis intersection is the mouse placement anchor.

Editor Undo/Redo is local and bounded to 100 entries. One model Undo removes the
complete insertion. Escape ends the innermost editor gesture before cancelling
the workspace; Escape during placement returns to editing. Explicit tool changes,
document replacement and model history navigation discard the transient draft.
Changed, hidden, grouped or locked source objects cannot receive a stale draft.

Contours use existing face clipping and subdivision semantics. Placement shows
the requested outlines; portions outside the receiving face are clipped on
insertion. Nested loops become ordinary inner and annular faces; they do not
cut material until a later modeling operation. Crossings, touching contours,
branches and duplicate edges are rejected rather than automatically trimmed.
The validator joins endpoints only within the existing geometric snap tolerance
and accepts at most 4096 segments. Curve quality is 64 segments per full circle.

Draft/history ownership belongs to the tool controller, snapping to SnapEngine,
contour validation to geometryApi, and insertion to a document command. Command
failure rolls back all loops and preserves the draft for correction or retry.
Placement reuses the prepared support frame and shared immutable snap arrays;
hover never requests full face views, boundary copies, areas or triangulation.
Changed solids receive normal complete validation. A subdivision rebuild freezes
affected model dimensions at their pre-edit positions rather than guessing new
topology identities. No render mesh or editor draft becomes canonical geometry.

There is no constraint solver, persistent sketch storage or live dependency
between a draft and the resulting solid. R271 in `tests/sketch-editor.mjs`
exercises the geometry and interaction boundaries. Run `npm run test:sketch-editor`
for its focused regression; the full suite also includes it.
