// Read-only topology views for exchange writers. No export view becomes document state.
interface PolyhedralExportFace { outer:number[]; holes:number[][]; normal:Vec3; }
interface PolyhedralExportShell { faces:number[]; signedVolume:number; }
interface PolyhedralExportView { vertices:Vec3[]; faces:PolyhedralExportFace[]; shells:PolyhedralExportShell[]; }
function polyhedralExportView(s:Solid):PolyhedralExportView {
  validateSolid(s);
  const vertexIndices=new Map<VertexId,number>(),vertices:Vec3[]=[];
  for(const vertex of s.vertices.values()){vertexIndices.set(vertex.id,vertices.length);vertices.push([...vertex.position] as Vec3);}
  const faceIndices=new Map<FaceId,number>(),faces:PolyhedralExportFace[]=[];
  const indices=(loopId:LoopId)=>loopVertexIds(s,loopId).map(id=>{const index=vertexIndices.get(id);if(index===undefined)throw Error('Export loop references a missing vertex.');return index;});
  for(const face of s.faces.values()){
    faceIndices.set(face.id,faces.length);
    faces.push({outer:indices(face.outerLoop),holes:face.innerLoops.map(indices),normal:[...face.plane.normal] as Vec3});
  }
  const shells=connectedSolidFaceComponents(s).map(ids=>{
    // Use a shell-local origin so large world translations cannot spoil the volume sign.
    const reference=faceLoopPoints(s,ids[0]).outer[0];
    const signedVolume=ids.reduce((total,id)=>{const face=s.faces.get(id)!;return total+faceAreaLocal(s,id)*V.dot(face.plane.normal,V.sub(faceLoopPoints(s,id).outer[0],reference))/3;},0);
    if(!Number.isFinite(signedVolume)||Math.abs(signedVolume)<=TOL.minimumFaceArea)throw Error('Export shell has zero or invalid signed volume.');
    return {faces:ids.map(id=>faceIndices.get(id)!),signedVolume};
  });
  return {vertices,faces,shells};
}
