// Read-only exchange input. Workers derive disposable meshes from canonical solids.
type StlExportObject=Pick<ModelObject,'id'|'name'|'solid'|'transform'>;
type StlExportRequest={type:'stl-export';objects:StlExportObject[]};
const STL_EXPORT_POLICY=Object.freeze({maximumBytes:750_000_000,progressTriangles:2048});

// A preview must not tessellate or validate whole solids on the UI thread.
// Euler's triangle estimate includes holes; export-only edge conformance may add triangles.
function solidExportPreview(object:StlExportObject):{bounds:Bounds3;triangles:number;faces:number}{
  const bounds:Bounds3={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
  for(const vertex of object.solid.vertices.values()){
    const point=transformPoint(vertex.position,object.transform);
    if(point.some(n=>!Number.isFinite(n)))throw Error(`“${object.name}” contains a non-finite export coordinate.`);
    for(let axis=0;axis<3;axis++){bounds.min[axis]=Math.min(bounds.min[axis],point[axis]);bounds.max[axis]=Math.max(bounds.max[axis],point[axis]);}
  }
  if(!object.solid.vertices.size)throw Error(`“${object.name}” contains no export vertices.`);
  let triangles=0;
  for(const face of object.solid.faces.values()){
    const loops=faceLoopPoints(object.solid,face.id);
    triangles+=Math.max(0,loops.outer.length+loops.holes.reduce((n,h)=>n+h.length,0)+2*loops.holes.length-2);
  }
  return {bounds,triangles,faces:object.solid.faces.size};
}

function prepareBinarySTL(list:readonly StlExportObject[],report:(update:ModelingProgressUpdate)=>void=()=>{}):ArrayBuffer{
  if(!list.length)throw Error('There are no objects to export.');
  const meshes:{object:StlExportObject;mesh:Mesh}[]=[];
  for(let i=0;i<list.length;i++){
    report({progress:2+33*i/list.length,message:`Preparing STL mesh · object ${i+1} of ${list.length}`});
    const object=list[i],mesh=solidMeshExportWorld(object);
    if(!mesh.triangles.length)throw Error(`“${object.name}” produced no STL triangles.`);
    if(mesh.vertices.some(p=>p.some(n=>!Number.isFinite(n))))throw Error(`“${object.name}” contains a non-finite STL coordinate.`);
    const stats=triangleMeshEdgeStats(mesh);
    if(stats.boundary||stats.nonManifold)throw Error(`“${object.name}” is not a closed STL mesh (open edges: ${stats.boundary}, non-manifold edges: ${stats.nonManifold}).`);
    meshes.push({object,mesh});
    report({progress:2+33*(i+1)/list.length,message:`Validated ${i+1} of ${list.length} object${list.length===1?'':'s'}`});
  }
  const count=meshes.reduce((n,x)=>n+x.mesh.triangles.length,0);
  if(!count)throw Error('The STL contains no triangles.');
  const byteLength=84+count*50;
  if(!Number.isSafeInteger(byteLength)||byteLength>STL_EXPORT_POLICY.maximumBytes)throw Error('The STL is too large for a reliable in-browser export. Reduce model complexity or export fewer objects.');
  const bytes=new ArrayBuffer(byteLength),view=new DataView(bytes),header='LamjaCraft 3D | polyhedral B-rep | coordinates in millimetres (mm)';
  for(let i=0;i<header.length&&i<80;i++)view.setUint8(i,header.charCodeAt(i));
  view.setUint32(80,count,true);
  let offset=84,written=0,sinceReport=0;
  for(const {object,mesh} of meshes){
    for(let triangleIndex=0;triangleIndex<mesh.triangles.length;triangleIndex++){
      const t=mesh.triangles[triangleIndex],a=mesh.vertices[t[0]],b=mesh.vertices[t[1]],c=mesh.vertices[t[2]];
      if(!a||!b||!c)throw Error(`“${object.name}” contains an invalid triangle index.`);
      const normal=V.unit(V.cross(V.sub(b,a),V.sub(c,a)));
      for(const p of [normal,a,b,c])for(const n of p){if(!Number.isFinite(n))throw Error(`“${object.name}” produced an invalid STL value.`);view.setFloat32(offset,n,true);offset+=4;}
      view.setUint16(offset,0,true);offset+=2;written++;sinceReport++;
      if(sinceReport>=STL_EXPORT_POLICY.progressTriangles){
        report({progress:35+63*written/count,message:`Writing STL · ${written.toLocaleString('en-US')} / ${count.toLocaleString('en-US')} triangles`});
        sinceReport=0;
      }
    }
  }
  if(offset!==byteLength)throw Error(`STL byte count mismatch (${offset} written, ${byteLength} expected).`);
  report({progress:100,message:`STL ready · ${count.toLocaleString('en-US')} triangles`});
  return bytes;
}
