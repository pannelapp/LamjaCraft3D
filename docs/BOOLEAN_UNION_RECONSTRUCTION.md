# Boolean union boundary reconstruction

The supplied `sbhd` objects overlap and both input solids validate. BSP creates very short fragments near their intersection. Two reconstruction rules matter: edge-split deduplication must retain the exact original endpoint, and subresolution adjacent fragments must be resolved consistently before half-edge creation.

Keeping a near-end candidate instead of the exact endpoint can change the rounded cancellation key and leave a coplanar boundary open. The split now explicitly retains the original endpoint. The CSG rebuild optionally collapses short original boundary edges while preserving every incident plane and every original member displacement budget. It selects an existing endpoint, without averaging or projecting. Unresolvable sharp details remain rejected. Zero-area loops after resolution are dropped; nonzero loop orientation and all final validation remain mandatory.

This is a general shared CSG reconstruction rule, not an object-specific exception. It also serves CSG-backed subtraction, Texture, Chamfer, Thread, Carve Out and sweeps. No geometric tolerance was increased. Face contact remains accepted; edge/point-only contact, gaps and disconnected shells remain unsuitable for Combine.

`tests/boolean-union.mjs` covers both supplied selection orders, nearby offsets and common rigid transforms, known cube union volumes, closed manifold exports, exact format-7 round trips, unchanged sources, contact rejection, endpoint-key boundaries, plane constraints, cluster displacement limits and command dimensions/history/Undo/Redo. The original source bytes are retained in `tests/fixtures/sbhd-union.lamjacraft.json.gz`.
