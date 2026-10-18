# Photo AI native handoff

Photo AI is a manual workflow. LamjaCraft prepares text and validates a returned
file; the chosen AI receives the photo only when the user attaches it there.
The photo is attached directly to the chosen AI; LamjaCraft has no local photo
chooser or preview. No account, API key, remote request or runtime library is added.

## Workflow

1. Open **Solids → Photo AI**, optionally enter known dimensions/requests, then
   copy the English prompt into your chosen AI and attach your reference photo
   there. The prompt requests a descriptive filename based on the object, such
   as `ceramic-soap-dispenser.lamjacraft.json` or `cat-figurine.lamjacraft.json`.
2. Load the returned `.lamjacraft.json` file or paste the complete JSON, choose
   **Check result**, then **Add to project**. Save the project manually. A single
   complete JSON code fence is accepted; prose and executable code are not.

Checking does not modify the model. Addition appends all supported native
entities with fresh document IDs; it never replaces the current project name
or contents. Placement is preserved and may overlap existing geometry. One
Undo removes the complete addition. Closing the dialog clears the staged
result; modeling requests remain only as transient UI text during this session.

## Required format

The prompt in `07_photo_ai_format.ts` is the authoritative generated handoff.
It includes a validated 10 mm cube with eight shared vertices and six faces.

| Entity | Required representation |
| --- | --- |
| Root | `format: "lamjacraft-3d"`, `version: 7`, `units: "mm"`, name, objects, groups, `construction: {guides: []}`, `annotations: {dimensions: []}` |
| Object | Unique string id, name, `kind: "solid"`, hex colour, transform position/rotation, solid |
| Solid | `schema: "poly-brep-1"`, id, metadata, vertices, faces |
| Vertex | String id and finite `[x,y,z]` position in mm |
| Face | String id, outer array of vertex IDs, holes array of vertex-ID arrays |
| Group | Unique id, name and at least two existing objectIds; flat membership only |

Coordinates are right-handed with Z up. The prompt requests placement baked
into vertices and identity transforms; stored XYZ Euler rotations are radians,
applied X then Y then Z. Curves remain faceted. Runtime half-edges/loops/planes
are rebuilt by the native reader and do not belong in the project JSON.

Adjacent faces must share vertex IDs. Every edge must appear exactly twice,
in opposite directions. Outer loops face outward; cavity walls face the void.
No duplicated closing vertex, unused vertex, non-planar face, zero edge/area,
open surface or zero-thickness component is acceptable. Prefer triangles on
non-planar lofts and modest detail. Distinct parts are separate solids organized
with flat groups. Hollow parts need complete inner/outer walls and connecting
rims. Object colour does not provide image or UV texture mapping.

## Checks and correction

The native reader validates solids and group membership, reusing the existing
Object Check inspection for finite derived face planes and volume. The dialog
also verifies finite optional annotation coordinates and combined document
capacity before enabling Add. It retains the ordinary native file-size and
geometry limits; large files can take time in synchronous native validation.
The check does not exhaustively detect surface self-intersections or establish
dimensional accuracy from an image.

If validation fails, copy the shown error to the AI and request a complete
corrected file. Missing vertices/edges, reversed face loops, non-planar quads
and duplicate group membership must be corrected at their source. Code and
images cannot be pasted in place of native JSON. Checks are never disabled to
accept a malformed result.

Additional native guides and dimensions are preserved if a returned project
contains them, although the prompt asks for empty arrays. Imported dimension
object IDs are remapped only to imported objects. Unresolved vertex/edge
targets become their explicit world fallback point, avoiding accidental links
to an existing unrelated object.
