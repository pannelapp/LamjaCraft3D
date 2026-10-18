# LamjaCraft native file format

LamjaCraft projects are editable UTF-8 JSON documents with the filename extension `.lamjacraft.json` and MIME type `application/json`. This specification describes the field types, required values and geometric constraints for compatible readers and writers.

## 1. Encoding and data types

The file is one UTF-8 JSON document. Comments, trailing commas, executable code, placeholders and Markdown fences are not part of the file format.

Type terminology:

- `string`: JSON text.
- `number`: a finite JSON number, allowing integer or decimal values. Numbers must remain finite when parsed as IEEE-754 binary64.
- `integer`: a JSON number with no fractional value.
- `boolean`: JSON `true` or `false`.
- `Vec3`: an array of exactly three finite numbers in XYZ order.
- `array<T>`: a JSON array whose elements have type T.

Do not encode numbers or booleans as strings. Do not use `null` for optional fields; omit them instead. All identifiers are nonempty strings, including identifiers that contain digits.

This specifies the canonical writer contract: emit the required fields described below even where the current reader provides permissive defaults.

## 2. Root document

The root is an object with these fields:

| Field | Type | Requirement |
| --- | --- | --- |
| `format` | string | Required; exactly `"lamjacraft-3d"`. |
| `version` | integer | Required; 7, 8, 9 or 10. |
| `units` | string | Required; exactly `"mm"`. |
| `name` | string | Required; project name, at most 80 characters. |
| `objects` | array of polygon-based solid or open-surface objects | Required. |
| `groups` | array of groups | Emit this field; use an empty array when unused. |
| `construction` | object | Required; contains `guides`, an array of construction guides. |
| `annotations` | object | Emit this field; contains `dimensions`, an array of dimension annotations. |
| `references` | object | Optional; contains `buildPlates`, an array of build plate references. |

An empty project can be opened, but importing a project requires at least one object or reference to add.

Use version 7 for solid-only projects, version 8 when a construction plane includes a `surface` height grid, and version 9 whenever the project contains open surface objects. Use version 10 whenever any object has a nonzero `shininess`. All four versions use polygon-based geometry. File-format versions are independent of application release numbers.

Do not invent additional persistent fields. Camera state, selections, tools, clipboard contents, undo history and rendering caches are not part of this format.

## 3. Coordinates and transforms

Use right-handed XYZ coordinates with Z pointing upward. All positions, lengths and distances are in millimetres.

Solid vertex positions are object-local. Each object has a rigid transform:

- `position`: Vec3; world translation in millimetres.
- `rotation`: Vec3; XYZ Euler angles in **degrees**, not radians.

Rotate local coordinates around the local origin in this order: X, then Y, then Z. Apply translation last. For column vectors, the convention is `world = Rz × Ry × Rx × local + position`.

There is no scale or pivot field. Bake scaling into vertex coordinates. For simpler generated files, bake placement into vertices and use zero translation and rotation.

Construction guides, build plates, dimension world points and dimension fallback positions use world coordinates.

## 4. Solid objects

Every element of `objects` has these fields:

| Field | Type | Requirement |
| --- | --- | --- |
| `id` | string | Required; unique across all objects. |
| `name` | string | Required; at most 80 characters. |
| `kind` | string | Required; `"solid"` for closed editable material geometry, or `"surface"` for limited open polygon geometry (format 9 or later). |
| `color` | string | Required; a six-digit hexadecimal color beginning with `#`. |
| `shininess` | number | Optional in format 10; finite value from 0 (matte) to 100 (glossy). Defaults to 0; canonical writers omit zero. |
| `transform` | object | Required; contains required `position` and `rotation`, both Vec3. |
| `solid` | canonical solid object | Required; described below. |
| `hidden` | boolean | Optional; default false. |
| `locked` | boolean | Optional; default false. |

Color and shininess belong to the whole object. Groups apply appearance edits to their members; groups carry no separate material. Shininess changes the view-dependent specular highlight in Presentation rendering and Presentation PNG exports. Hidden and locked objects still contain ordinary persistent geometry.

Each canonical solid has:

| Field | Type | Requirement |
| --- | --- | --- |
| `schema` | string | Required; exactly `"poly-brep-1"`. |
| `id` | string | Required for generated files; solid identifier. |
| `metadata` | object | Required for generated files; may be empty. Its supported optional descriptive field is `name`, a string. |
| `vertices` | array of vertices | Required. |
| `faces` | array of faces | Required. |

Each vertex has:

- `id`: string, required and unique within that solid’s vertices.
- `position`: Vec3, required and expressed in object-local coordinates.

Each face has:

- `id`: string, required and unique within that solid’s faces.
- `outer`: array of strings, required; ordered vertex IDs defining its outer boundary.
- `holes`: array of arrays of strings; emit an empty array when the face has no holes. Each inner array defines one hole boundary.
- `material`: optional string tag.
- `boundaryGroup`: optional string identifying related face boundaries.
- `provenance`: optional object with required string `kind` and optional string `label`. Allowed kinds are `"primitive"`, `"pushpull"`, `"split"`, `"import"` and `"boolean"`.

Optional face tags can be omitted when generating new geometry. Preserve existing tags when editing existing files faithfully.

Vertex and face IDs are local to a solid and may be reused in different solids. References are vertex IDs, never numeric array indices or embedded coordinates. Array order does not establish identity.

Do not write runtime half-edges, topology loops, face planes or normals. LamjaCraft reconstructs them from the face boundaries. The internal `"brep-1"` representation is not the native file schema.

## 5. Mandatory geometry rules

Objects with `kind: "solid"` must represent a valid closed material boundary. Use separate objects for disconnected solid parts. Objects with `kind: "surface"` may contain open polygon sheets and are not editable with solid modeling tools; they are movable, rotatable, copyable, recolorable and persistable. In open surfaces a boundary edge may occur only once and face winding need not enclose a volume. Every polygon must still be planar, valid and triangulable; open surfaces cannot participate in solid boolean operations or solid-only exports.

All face boundaries must satisfy these rules:

1. Each boundary contains at least three distinct vertices. Closure is implicit: do not repeat the first vertex at the end.
2. Boundaries are simple, without repeated vertices, crossing edges or zero-length edges.
3. Every referenced vertex exists, and every declared vertex is used by a face boundary.
4. Adjacent faces share the same vertex IDs. Separate coincident vertices do not establish shared topology.
5. Every undirected edge appears exactly twice across the solid’s boundaries, once in each direction.
6. No T-junctions are allowed. If an edge is subdivided, subdivide it consistently on both adjoining faces.
7. Outer boundaries wind counter-clockwise when viewed from outside the material. Hole boundaries wind oppositely. Faces around an internal cavity point into that cavity.
8. Every face is planar, including all its hole vertices. Triangulate non-planar patches.
9. Hole boundaries lie strictly inside their outer boundary and do not touch or intersect it or other holes.
10. Faces and edges have usable nonzero area and length, and total signed material volume is finite and positive.

A face hole alone does not create a complete hollow solid. Include the inner walls and connecting faces needed to close the material boundary.

Avoid duplicate faces, self-intersecting surfaces, overlapping shells and zero-thickness material. Do not assume the native reader will weld, repair or reorient invalid geometry.

Curved solid surfaces are faceted approximations made from planar polygons or triangles. The solid schema does not store analytic cylinders, spheres, splines or NURBS surfaces.

The importer checks topology, edge pairing, coordinates, planarity, loop orientation, triangulation and positive volume. It does not exhaustively detect every surface self-intersection or guarantee that later Boolean operations will succeed. Validate generated geometry independently.

## 6. Groups

Each group has:

- `id`: string, required and unique across groups.
- `name`: string, required for generated files; at most 80 characters.
- `objectIds`: array of strings, required; at least two different existing object IDs.

A group cannot contain groups. Each object can belong to at most one group. Groups organize objects without changing geometry or adding a transform.

## 7. Construction guides

Every guide has a required nonempty string `id`, unique across guides, and a required string `kind`. All guide kinds support an optional string `label`.

The supported kinds and their fields are:

- `"point"`: required `point`, Vec3.
- `"line"`: required `point`, Vec3, and `direction`, Vec3. Optional `planeNormal`, Vec3, describes a support plane and must be perpendicular to the direction.
- `"circle"`: required `center`, Vec3; `normal`, Vec3; and `radius`, number. Radius must be at least 0.00001 mm.
- `"plane"`: required `origin`, Vec3, and `normal`, Vec3. Optional `axis`, Vec3, specifies an in-plane direction. Optional `surface`, a height-grid object, requires file version 8.

Emit unit-length direction and normal vectors. A plane axis must be perpendicular to its normal. Lines and flat planes are infinite references. Guides do not themselves create solid geometry.

For a plane containing `surface`, both `normal` and `axis` are required perpendicular unit vectors, with length and perpendicularity errors no greater than 1e-7.

The `surface` object has:

- `width`: number, required; from 1 to 10,000 mm.
- `height`: number, required; from 1 to 10,000 mm.
- `columns`: integer, required; from 2 to 30 grid points.
- `rows`: integer, required; from 2 to 30 grid points.
- `heights`: array of numbers, required; exactly `columns × rows` entries, each from -10,000 to 10,000 mm.

Grid heights are stored in row-major order, with column varying fastest. Let `u = axis`, `n = normal` and `v = cross(n,u)`.

For zero-based column `c` and row `r`, entry index is `r × columns + c`. Its world position is:

`origin + u × (c × width / (columns−1) − width/2) + v × (r × height / (rows−1) − height/2) + n × heights[index]`.

Each grid cell is divided along the diagonal from its lower-left to upper-right corner. Its triangles are lower-left/lower-right/upper-right and lower-left/upper-right/upper-left. This creates a piecewise planar height field. Outside the grid footprint, edge heights continue along the in-plane axes; corner heights remain constant.

## 8. Dimension annotations

Each dimension has:

- `id`: string, required and unique across dimensions.
- `kind`: string, required; exactly `"linear"`.
- `a`: required endpoint anchor.
- `b`: required endpoint anchor.
- `label`: optional string, at most 80 characters.

Do not store a separate numeric dimension value. The application computes the world-space distance between the resolved endpoints.

Each endpoint anchor has one of these forms:

- World anchor: `kind` is `"world"`; required `point` is Vec3.
- Vertex anchor: `kind` is `"vertex"`; required `objectId` and `vertexId` are strings; required `fallback` is Vec3.
- Edge anchor: `kind` is `"edge"`; required `objectId`, `vertexA` and `vertexB` are strings; required `t` is a number in [0,1]; required `fallback` is Vec3.

Vertex anchors resolve a local vertex through its object transform. Edge anchors interpolate from vertexA to vertexB using t, then apply the object transform.

For generated files, reference existing objects and vertices; edge endpoints should belong to an actual edge. Always provide a finite world-space fallback for object-linked anchors. Missing identities resolve to the fallback; Import converts unresolved object-linked anchors into world anchors.

Do not reference runtime half-edge IDs.

## 9. Build plate references

The optional root `references` object contains `buildPlates`, an array. Each plate has:

- `id`: string, required and unique across plates.
- `name`: optional string, at most 80 characters; defaults to `"Build plate"`.
- `width`: number, required and greater than zero.
- `depth`: number, required and greater than zero.
- `x`: number, required.
- `y`: number, required.
- `color`: string, required; six-digit hexadecimal color beginning with `#`.
- `opacity`: number, required; in [0,1].
- `visible`: optional boolean; defaults to true.

A plate is a visual rectangle on world Z=0, centered at x/y. Its dimensions and position use millimetres. Its bounds must remain finite when converted to IEEE-754 float32. It is not solid geometry and cannot be a group member.

## 10. Size limits and interoperability

Current limits are:

- File size: 512 MiB.
- Objects: 1,000.
- Groups: 300.
- Construction guides: 20,000.
- Dimensions: 20,000.
- Build plates: 128.
- Per solid: 1,000,000 vertices, 1,000,000 faces and 8,000,000 total boundary segments, including hole boundaries.

These are implementation ceilings, not recommended target sizes. Prefer moderate geometry and avoid excessive faceting.

Before saving or exporting, validate field types, required fields, identifier uniqueness, references, array lengths, version requirements and all geometry rules.

Open validates and replaces the current document. Import validates and appends contents using fresh document IDs, remapping group members and object-linked dimension anchors while preserving placement. Local vertex and face IDs remain local to their solids. An import may overlap existing objects.

Save Project and Entire model native Export preserve objects, groups, guides, dimensions and build plates. Selected native Export keeps selected objects, groups with at least two included members, and dimensions with at least one included object-linked anchor and all their object-linked anchors included. It omits guides, build plates and unrelated world-only dimensions and chooses version 7 for solids only, format 9 if the selected objects include open surfaces, or format 10 if any selected object has nonzero shininess.

## 12. Small complete example

This format 7 file describes a 10 mm cube from Z=0 to Z=10, with eight shared vertices and six outward-facing planar faces. The example is a complete importable project.

```json
{
  "format":"lamjacraft-3d", "version":7, "units":"mm",
  "name":"Native format sample",
  "objects":[{
    "id":"o1", "name":"10 mm cube", "kind":"solid", "color":"#b7cec9",
    "transform":{"position":[0,0,0],"rotation":[0,0,0]},
    "solid":{
      "schema":"poly-brep-1", "id":"s_o1", "metadata":{},
      "vertices":[
        {"id":"v1","position":[0,0,0]},
        {"id":"v2","position":[10,0,0]},
        {"id":"v3","position":[10,10,0]},
        {"id":"v4","position":[0,10,0]},
        {"id":"v5","position":[0,0,10]},
        {"id":"v6","position":[10,0,10]},
        {"id":"v7","position":[10,10,10]},
        {"id":"v8","position":[0,10,10]}
      ],
      "faces":[
        {"id":"f1","outer":["v1","v4","v3","v2"],"holes":[]},
        {"id":"f2","outer":["v5","v6","v7","v8"],"holes":[]},
        {"id":"f3","outer":["v1","v2","v6","v5"],"holes":[]},
        {"id":"f4","outer":["v2","v3","v7","v6"],"holes":[]},
        {"id":"f5","outer":["v3","v4","v8","v7"],"holes":[]},
        {"id":"f6","outer":["v4","v1","v5","v8"],"holes":[]}
      ]
    }
  }],
  "groups":[], "construction":{"guides":[]}, "annotations":{"dimensions":[]}
}
```
