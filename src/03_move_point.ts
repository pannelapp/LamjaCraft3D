// Move one canonical corner. Retained points stay exact; a warped logical face
// becomes indexed planar triangles from its original, boundary-conforming mesh.
const POINT_MOVE_POLICY=Object.freeze({maximumFaces:2000,maximumVertices:1000,maximumHalfEdges:12000,maximumTriangles:2000,maximumTrianglePairs:100000,minimumMovement:1e-9});
interface PreparedPointMove {source:Solid;vertexId:VertexId;volume:number;incident:Map<FaceId,VertexId[][]>;stationaryTriangles:Vec3[][];}
interface PointMoveEdit {solid:Solid;vertexId:VertexId;position:Vec3;affectedFaceIds:FaceId[];splitFaceIds:FaceId[];volumeBefore:number;volumeAfter:number;noChange:boolean;}
type PointMoveFailure={ok:false;reason:'selection'|'limit'|'boundary'|'invalid';message:string};
type PointMovePreparation={ok:true;prepared:PreparedPointMove}|PointMoveFailure;
type PointMoveResult={ok:true;result:PointMoveEdit}|PointMoveFailure;
function preparePointMoveSolid(s:Solid,vertexId:VertexId):PointMovePreparation {
  const reject=(reason:PointMoveFailure['reason'],message:string):PointMoveFailure=>({ok:false,reason,message});
  if(!s.vertices.has(vertexId))return reject('selection','Pick an existing corner on the model.');
  if(s.vertices.size>POINT_MOVE_POLICY.maximumVertices||s.faces.size>POINT_MOVE_POLICY.maximumFaces||s.halfEdges.size>POINT_MOVE_POLICY.maximumHalfEdges)return reject('limit','This object is too large for the live point-edit preview.');
  const incident=new Map<FaceId,VertexId[][]>(),stationaryTriangles:Vec3[][]=[];let count=0;
  try{
    for(const f of s.faces.values()){
      const boundary=[f.outerLoop,...f.innerLoops].flatMap(l=>loopVertexIds(s,l)),triangles=triangulateFaceLocal(s,f.id,undefined,'canonical');
      if(!boundary.includes(vertexId)){stationaryTriangles.push(...triangles);count+=triangles.length;continue;}
      const lookup=new Map<string,VertexId>();for(const id of boundary){const key=JSON.stringify(s.vertices.get(id)!.position);if(lookup.has(key)&&lookup.get(key)!==id)return reject('boundary','This face has ambiguous coincident corners.');lookup.set(key,id);}
      const indexed:VertexId[][]=[];
      for(const triangle of triangles){
        const ids=triangle.map(p=>lookup.get(JSON.stringify(p)));if(ids.some(id=>!id))return reject('boundary','This face requires extra boundary points before it can be edited.');
        let pieces:VertexId[][]=[ids as VertexId[]];
        // Ear clipping may omit collinear corners. Reinsert them into triangle
        // boundary edges so neighboring face loops retain identical ownership.
        for(const id of boundary){const point=s.vertices.get(id)!.position,next:VertexId[][]=[];
          for(const piece of pieces){if(piece.includes(id)){next.push(piece);continue;}let split=false;
            for(let i=0;i<3;i++){const a=s.vertices.get(piece[i])!.position,b=s.vertices.get(piece[(i+1)%3])!.position,d=V.sub(b,a),length=V.dot(d,d),t=length?V.dot(V.sub(point,a),d)/length:0;
              if(t>0&&t<1&&V.len(V.sub(point,V.lerp(a,b,t)))<=TOL.topologyKey){const c=piece[(i+2)%3];next.push([piece[i],id,c],[id,piece[(i+1)%3],c]);split=true;break;}}
            if(!split)next.push(piece);
          }pieces=next;
        }indexed.push(...pieces);
      }
      incident.set(f.id,indexed);count+=indexed.length;
      if(count>POINT_MOVE_POLICY.maximumTriangles)return reject('limit','This point edit exceeds the live-preview triangle limit.');
    }
    if(count>POINT_MOVE_POLICY.maximumTriangles)return reject('limit','This point edit exceeds the live-preview triangle limit.');
    if(!incident.size)return reject('selection','The point is not used by a model face.');
    return {ok:true,prepared:{source:s,vertexId,volume:validateSolid(s).volume,incident,stationaryTriangles}};
  }catch(error){return reject('invalid',`The point could not be prepared: ${errorMessage(error)}`);}
}
function pointMoveTrianglesCross(a:Vec3[],b:Vec3[]):boolean {
  for(let i=0;i<3;i++)if(textureBandCrossesTriangle(a[i],a[(i+1)%3],b)||textureBandCrossesTriangle(b[i],b[(i+1)%3],a))return true;
  const plane=planeFromPoints(a);if(b.some(p=>Math.abs(V.dot(plane.normal,p)-plane.offset)>TOL.plane))return false;
  const basis=planeBasis(plane,a[0]),aa=a.map(p=>toPlane2(p,basis)),bb=b.map(p=>toPlane2(p,basis));
  for(let i=0;i<3;i++)for(let j=0;j<3;j++)if(segmentIntersection2(aa[i],aa[(i+1)%3],bb[j],bb[(j+1)%3]))return true;
  const inside=(p:Vec2,t:Vec2[])=>{const sign=Math.sign(v2.area(t));return t.every((q,i)=>sign*v2.cross(q,t[(i+1)%3],p)>TOL.topologyKey*v2.dist(q,t[(i+1)%3]));};
  return aa.some(p=>inside(p,bb))||bb.some(p=>inside(p,aa));
}
function movePointSolid(prepared:PreparedPointMove,position:Vec3):PointMoveResult {
  const reject=(reason:PointMoveFailure['reason'],message:string):PointMoveFailure=>({ok:false,reason,message}),s=prepared.source,id=prepared.vertexId;
  if(position.length!==3||position.some(n=>!Number.isFinite(n)))return reject('invalid','Point coordinates must be finite.');
  if(V.len(V.sub(position,s.vertices.get(id)!.position))<=POINT_MOVE_POLICY.minimumMovement)return {ok:true,result:{solid:s,vertexId:id,position:[...s.vertices.get(id)!.position],affectedFaceIds:[],splitFaceIds:[],volumeBefore:prepared.volume,volumeAfter:prepared.volume,noChange:true}};
  for(const v of s.vertices.values())if(v.id!==id&&V.len(V.sub(v.position,position))<=TOL.minimumEdge)return reject('boundary','This move would merge distinct corners. Choose a different position.');
  const point=(v:VertexId):Vec3=>v===id?position:s.vertices.get(v)!.position,faces:ProjectSolid['faces']=[],splitFaceIds:FaceId[]=[],allTriangles:Vec3[][]=[...prepared.stationaryTriangles],changed:Vec3[][]=[];
  const usedFaceIds=new Set(s.faces.keys());let nextFace=Math.max(0,...[...s.faces.keys()].map(fid=>Number(/^f(\d+)$/.exec(fid)?.[1]||0)))+1;
  const allocate=()=>{while(usedFaceIds.has(`f${nextFace}`))nextFace++;const fid=`f${nextFace++}`;usedFaceIds.add(fid);return fid;};
  for(const f of s.faces.values()){
    const outer=loopVertexIds(s,f.outerLoop),holes=f.innerLoops.map(l=>loopVertexIds(s,l)),triangles=prepared.incident.get(f.id);
    if(!triangles){faces.push({id:f.id,outer,holes,material:f.material,provenance:f.provenance,boundaryGroup:f.boundaryGroup});continue;}
    const points=outer.map(point),plane=planeFromPoints(points),planar=[outer,...holes].every(loop=>loop.every(v=>Math.abs(V.dot(plane.normal,point(v))-plane.offset)<=TOL.plane));
    for(const vertices of triangles){const tri=vertices.map(point),old=vertices.map(v=>s.vertices.get(v)!.position),area=V.cross(V.sub(tri[1],tri[0]),V.sub(tri[2],tri[0])),oldArea=V.cross(V.sub(old[1],old[0]),V.sub(old[2],old[0]));
      if(V.len(area)/2<=TOL.minimumFaceArea||V.dot(area,oldArea)<=0)return reject('boundary','This move would collapse or reverse a surface triangle.');
      allTriangles.push(tri);if(vertices.includes(id))changed.push(tri);
    }
    if(planar)faces.push({id:f.id,outer,holes,material:f.material,provenance:f.provenance,boundaryGroup:f.boundaryGroup});
    else{splitFaceIds.push(f.id);for(let i=0;i<triangles.length;i++)faces.push({id:i===0?f.id:allocate(),outer:triangles[i],holes:[],material:f.material,provenance:{kind:'boolean',label:'Move point'},boundaryGroup:f.boundaryGroup});}
  }
  let comparisons=0;
  for(const tri of changed){const bounds=textureBandBounds3(tri);for(const other of allTriangles){if(tri===other)continue;
      if(++comparisons>POINT_MOVE_POLICY.maximumTrianglePairs)return reject('limit','This point preview exceeds the surface-check limit.');
      const ob=textureBandBounds3(other);if(bounds.min.some((v,i)=>v>ob.max[i]+TOL.plane||bounds.max[i]<ob.min[i]-TOL.plane))continue;
      if(pointMoveTrianglesCross(tri,other))return reject('boundary','This move would make model surfaces cross. Choose a smaller movement.');
    }}
  try{
    const solid=deserializeProjectSolid({schema:'poly-brep-1',id:s.id,metadata:structuredClone(s.metadata),vertices:[...s.vertices.values()].map(v=>({id:v.id,position:[...point(v.id)] as Vec3})),faces});
    solidMeshExportLocal(solid);const after=validateSolid(solid);
    return {ok:true,result:{solid,vertexId:id,position:[...position],affectedFaceIds:[...prepared.incident.keys()],splitFaceIds,volumeBefore:prepared.volume,volumeAfter:after.volume,noChange:false}};
  }catch(error){return reject('invalid',`The moved point failed geometry/export checks: ${errorMessage(error)}`);}
}
