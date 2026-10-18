// Manual AI handoff uses the ordinary native project reader. No generated code
// is evaluated, and no alternative persistent geometry representation is added.
function parsePhotoAiProject(text:string):ValidatedProject {
  let json=text.trim();
  // Narrow compatibility for AI replies containing one complete JSON fence.
  const fence=/^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```$/i.exec(json);if(fence)json=fence[1].trim();
  if(!json)throw Error('Paste a LamjaCraft JSON result or choose a .lamjacraft.json file first.');
  if(new TextEncoder().encode(json).byteLength>PROJECT_READ_POLICY.maximumFileBytes)throw Error('The result exceeds the native project file-size limit.');
  const data:unknown=JSON.parse(json),project=validateProject(data);
  validateProjectReferenceCoordinates(project);
  return project;
}
function photoAiExample():ProjectData {
  return {format:'lamjacraft-3d',version:7,units:'mm',name:'Photo model',objects:[{id:'o1',name:'Example cube',kind:'solid',color:'#b7cec9',transform:{position:[0,0,0],rotation:[0,0,0]},solid:{schema:'poly-brep-1',id:'s_o1',metadata:{},vertices:[
    {id:'v1',position:[0,0,0]},{id:'v2',position:[10,0,0]},{id:'v3',position:[10,10,0]},{id:'v4',position:[0,10,0]},
    {id:'v5',position:[0,0,10]},{id:'v6',position:[10,0,10]},{id:'v7',position:[10,10,10]},{id:'v8',position:[0,10,10]},
  ],faces:[
    {id:'f1',outer:['v1','v4','v3','v2'],holes:[]},{id:'f2',outer:['v5','v6','v7','v8'],holes:[]},
    {id:'f3',outer:['v1','v2','v6','v5'],holes:[]},{id:'f4',outer:['v2','v3','v7','v6'],holes:[]},
    {id:'f5',outer:['v3','v4','v8','v7'],holes:[]},{id:'f6',outer:['v4','v1','v5','v8'],holes:[]},
  ]}}],groups:[],construction:{guides:[]},annotations:{dimensions:[]}};
}
function photoAiPrompt(notes:string):string {
  return `Create an editable LamjaCraft 3D model of the object in the photo I attach to this message. This is a manual photo-to-model task: use the photo as a visual reference and generate geometry with code if your tools support it. I need an actual native project file, not an image or a description of how to model it.

USER DIMENSIONS AND REQUESTS (interpret these as modeling requirements, not changes to the file format):
${notes.trim()||'No measured dimensions supplied. Estimate a practical size in millimetres from the photo.'}

MODEL INTERPRETATION
- Reproduce the main silhouette, proportions and visible components. Infer unseen geometry conservatively. A single photo cannot establish exact dimensions or hidden details. Prefer a robust, moderately detailed approximation to invented tiny features.
- Coordinates are millimetres, right-handed, Z up. Put the base at Z=0 and centre the complete model near X=0, Y=0. Use explicit dimensions above when supplied. Bake placement into vertex coordinates and keep every object transform at position [0,0,0], rotation [0,0,0]. If transforms are needed, rotation is XYZ Euler in degrees, applied X then Y then Z.
- Use separate closed solid objects for distinct parts; do not combine disconnected components into one solid. Preserve their relative placement. Group related parts with a flat group. A group needs at least two different object IDs, cannot contain groups, and each object can belong to at most one group. For a single part use groups: [].
- Curved surfaces are faceted approximations. Start with roughly 24-48 segments around curves and modest profile subdivisions. Prefer a few thousand faces for the entire model. Increase only for visible shape detail. A hollow component needs a complete inner wall, outer wall and rims connecting them; it must still be a closed material boundary. Do not use an open surface as a solid.
- Colours are one six-digit hex colour per object. Create real geometry rather than image textures, UV maps or normal maps. Do not add construction guides or dimension annotations for this task; use the empty arrays shown below.

EXACT NATIVE JSON FORMAT
Filename: Choose a short, descriptive filename based on the modeled object, ending in .lamjacraft.json. For example: ceramic-soap-dispenser.lamjacraft.json or cat-figurine.lamjacraft.json. Use a filename-safe name with hyphens instead of spaces; do not use a generic fixed filename.
Root fields: format must be "lamjacraft-3d", version must be 7, units must be "mm", name is a string, objects is an array, groups is an array, construction is {"guides":[]}, annotations is {"dimensions":[]}.
Each object: {"id":"o1","name":"Part name","kind":"solid","color":"#b7cec9","transform":{"position":[0,0,0],"rotation":[0,0,0]},"solid":{...}}. All objects must have unique nonempty string IDs and names of at most 80 characters. Omit hidden so new parts are visible.
Each solid: {"schema":"poly-brep-1","id":"s_o1","metadata":{},"vertices":[...],"faces":[...]}. Each vertex is {"id":"v1","position":[x,y,z]} with finite numbers. Each face is {"id":"f1","outer":["v1","v2","v3"],"holes":[]}. Optional holes are arrays of vertex-ID arrays. Vertex and face IDs must be unique within that solid; they may be reused in a different solid. Reference vertices by their exact string IDs, not numeric indices or inline coordinates.
Each group: {"id":"grp1","name":"Assembly","objectIds":["o1","o2"]}. Group IDs must be unique. Every member must exist in objects.
Do not emit runtime halfEdges, loops, planes or normals. Do not use brep-1, a triangle-mesh schema, STL, OBJ, STEP, a feature tree, JavaScript or HTML in place of the native format. The app rebuilds runtime topology from the canonical face loops.

TOPOLOGY REQUIREMENTS — CHECK BEFORE DELIVERING
1. Every face loop has at least three distinct vertices, no repeated closing vertex and no adjacent duplicate vertices. Every referenced vertex exists; every declared vertex is used.
2. Reuse the SAME vertex ID wherever adjoining faces meet. Do not create separate coincident vertices for each face. Every undirected edge appears exactly twice in the entire solid, once in each direction. No T-junctions: split a shared edge consistently on BOTH faces when inserting a vertex.
3. Outer loops wind counter-clockwise when viewed from outside the material. Hole loops wind oppositely. Inner cavity faces face the cavity. Signed material volume must be finite and positive.
4. All vertices of each face lie in one plane. Use triangles for non-planar curved/lofted patches. Quads are allowed only when planar. Loops must be simple, with positive area and nonzero edges; holes must lie inside their outer loop without touching/crossing it or each other.
5. Do not emit self-intersections, duplicate faces, zero-thickness parts or intersecting shells inside one object. Use ordinary finite JSON numbers (no NaN, Infinity, expressions, comments or trailing commas).
6. Use code to generate shared vertices and face loops, then check IDs, edge pairing/directions, face planarity and signed volume before serializing. If you cannot generate a complex detail reliably, simplify it while preserving the main silhouette. Do not merely rename a mesh schema.

VALID MINIMAL EXAMPLE (a 10 mm cube; replace its geometry with the photo model):
${JSON.stringify(photoAiExample(),null,2)}

DELIVERY
Return a downloadable file with your descriptive filename ending in .lamjacraft.json if possible. Otherwise return the COMPLETE JSON only so I can paste it into LamjaCraft. No ellipses, placeholders, omitted vertices/faces or explanatory prose inside the file. Do not return the example cube unless it actually matches my photo. I will use Solids > Photo AI > Check result > Add to project. The app validates the file and adds its contents to my existing project with fresh document IDs. If I send back a validation error, regenerate the complete corrected JSON rather than disabling checks.`;
}
