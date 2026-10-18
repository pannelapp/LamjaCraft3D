// For a convex target and separated cutters, A minus their union has two
// boundary parts: the target surface minus each intersection cap, and each
// inverted cutter skin inside A. Clip against A's supporting planes so a dense
// cutter does not fragment A through every nearly parallel cutter plane.
// This is a preclassified operation path, not a reconstruction retry.
const CONVEX_SUBTRACT_POLICY=Object.freeze({
  // Bound half-space classification and cap work without changing tolerances.
  maximumTargetFaces:256,
  capWeldRadius:BREP_REBUILD_POLICY.canonicalVertexWeldRadius
});
type ConvexSubtractResult={status:'not-applicable'}|{status:'unchanged'}|{status:'empty';removedVolume:number}|{status:'polygons';polygons:CSGPolygon[];intersectionVolume:number};
function convexSubtractPlanes(target:Solid):Plane[]|null {
  if(target.faces.size>CONVEX_SUBTRACT_POLICY.maximumTargetFaces)return null;
  const points=[...target.vertices.values()].map(vertex=>vertex.position),planes:Plane[]=[];
  for(const face of target.faces.values()){
    if(points.some(point=>V.dot(face.plane.normal,point)-face.plane.offset>TOL.plane))return null;
    if(!planes.some(plane=>V.dot(plane.normal,face.plane.normal)>1-TOL.coplanarAngle&&Math.abs(plane.offset-face.plane.offset)<=TOL.coplanarDistance))planes.push(face.plane);
  }
  return planes;
}
function convexSubtractCapLoops(polygons:CSGPolygon[],plane:Plane):Vec3[][] {
  const radius=CONVEX_SUBTRACT_POLICY.capWeldRadius,grid=weldGrid<Vec3>(radius),nearby:Vec3[]=[],points:Vec3[]=[],ids=new Map<Vec3,string>();
  const canonical=(point:Vec3):Vec3=>{
    const cell=grid.cell(point);let best:Vec3|undefined,distance=Infinity;
    for(const candidate of grid.near(cell,nearby)){const d=V.len(V.sub(point,candidate));if(d<=radius&&d<distance){best=candidate;distance=d;}}
    if(best)return best;ids.set(point,String(points.length));points.push(point);grid.add(cell,point);return point;
  };
  const segments:[Vec3,Vec3][]=[];
  for(const polygon of polygons)for(let i=0;i<polygon.vs.length;i++){
    const a=polygon.vs[i],b=polygon.vs[(i+1)%polygon.vs.length];
    if(Math.abs(V.dot(plane.normal,a)-plane.offset)<=TOL.csg&&Math.abs(V.dot(plane.normal,b)-plane.offset)<=TOL.csg)segments.push([canonical(a),canonical(b)]);
  }
  type Edge={a:Vec3;b:Vec3;ka:string;kb:string;count:number};const sums=new Map<string,Edge>();
  for(const [a,b] of segments){const cuts=splitEdgePoints(a,b,points);for(let i=0;i<cuts.length-1;i++){
    const a=cuts[i],b=cuts[i+1],ka=ids.get(a)!,kb=ids.get(b)!;if(ka===kb)continue;const key=ka<kb?ka+'|'+kb:kb+'|'+ka,edge=sums.get(key);
    if(!edge)sums.set(key,{a,b,ka,kb,count:1});else{edge.count+=edge.ka===ka?1:-1;if(!edge.count)sums.delete(key);}
  }}
  const edges:Edge[]=[];for(const edge of sums.values())for(let n=0;n<Math.abs(edge.count);n++)edges.push(edge.count>0?edge:{a:edge.b,b:edge.a,ka:edge.kb,kb:edge.ka,count:1});
  const outgoing=new Map<string,number[]>();edges.forEach((edge,i)=>{const list=outgoing.get(edge.ka)||[];list.push(i);outgoing.set(edge.ka,list);});
  const used=new Set<number>(),loops:Vec3[][]=[];
  for(let seed=0;seed<edges.length;seed++){
    if(used.has(seed))continue;let current=seed;const loop:Vec3[]=[];let closed=false;
    for(let step=0;step<=edges.length;step++){
      const edge=edges[current];used.add(current);loop.push(edge.a);if(edge.kb===edges[seed].ka){closed=true;break;}
      const candidates=(outgoing.get(edge.kb)||[]).filter(i=>!used.has(i));if(!candidates.length)break;
      if(candidates.length===1)current=candidates[0];else{
        const direction=V.unit(V.sub(edge.b,edge.a));current=candidates.sort((a,b)=>{const turn=(i:number)=>{const next=V.unit(V.sub(edges[i].b,edges[i].a));return Math.atan2(V.dot(plane.normal,V.cross(direction,next)),V.dot(direction,next));};return turn(b)-turn(a);})[0];
      }
    }
    if(!closed)throw Error('The cutter intersection could not form a closed cap contour.');
    if(loop.length>=3)loops.push(loop.reverse());
  }
  return loops;
}
function convexSubtractCapPolygons(loops:Vec3[][],plane:Plane,group:string):CSGPolygon[] {
  const polygons:CSGPolygon[]=[];
  for(const region of classifyPlaneLoops(loops,plane)){
    const rings=[region.outer,...region.holes],basis=planeBasis(plane,region.outer[0]),flat=rings.map(ring=>ring.map(point=>toPlane2(point,basis))),boundary=rings.flat(),uv=flat.flat();
    const triangulation=triangulatePolygonWithHoles2(flat[0],flat.slice(1));
    const positions=triangulation.points.map(point=>{
      const vertex=uv.findIndex(candidate=>v2.dist(point,candidate)<=FACE_TESSELLATION_POLICY.boundaryCoordinateRoundoff);if(vertex>=0)return boundary[vertex];
      for(let r=0;r<flat.length;r++)for(let i=0;i<flat[r].length;i++){
        const j=(i+1)%flat[r].length,a=flat[r][i],b=flat[r][j];if(!pointOnSegment2(point,a,b,FACE_TESSELLATION_POLICY.boundaryCoordinateRoundoff))continue;
        const dx=b[0]-a[0],dy=b[1]-a[1],lengthSquared=dx*dx+dy*dy;
        if(lengthSquared)return V.lerp(rings[r][i],rings[r][j],clamp(((point[0]-a[0])*dx+(point[1]-a[1])*dy)/lengthSquared,0,1));
      }
      return fromPlane2(point,basis);
    });
    for(const triangle of triangulation.triangles)polygons.push({vs:triangle.map(i=>positions[i]),plane:{normal:[...plane.normal] as Vec3,offset:plane.offset},group,provenance:{kind:'boolean',label:'Subtract'}});
  }
  return polygons;
}
function convexSubtractSeparated(target:Solid,targetTransform:Transform,cutters:SolidCutter[],originalVolume:number,volumeNoise:number,report?:(update:ModelingProgressUpdate)=>void):ConvexSubtractResult {
  const planes=convexSubtractPlanes(target);if(!planes)return {status:'not-applicable'};
  const bounds=cutters.map(cutter=>{
    const min:Vec3=[Infinity,Infinity,Infinity],max:Vec3=[-Infinity,-Infinity,-Infinity];
    for(const vertex of cutter.solid.vertices.values()){
      const point=inverseTransformPoint(transformPoint(vertex.position,cutter.transform),targetTransform);
      for(let axis=0;axis<3;axis++){min[axis]=Math.min(min[axis],point[axis]);max[axis]=Math.max(max[axis],point[axis]);}
    }
    return {min,max};
  });
  // Strictly separated bounds prove cutter volumes cannot overlap or share a
  // contact wall. Other interactions belong to the existing BSP difference.
  for(let i=0;i<bounds.length;i++)for(let j=i+1;j<bounds.length;j++)if(![0,1,2].some(axis=>bounds[i].max[axis]+TOL.minimumEdge<=bounds[j].min[axis]||bounds[j].max[axis]+TOL.minimumEdge<=bounds[i].min[axis]))return {status:'not-applicable'};
  const clippedCuts:CSGPolygon[]=[],origin=[...target.vertices.values()][0].position;let intersectionVolume=0;
  for(let cutterIndex=0;cutterIndex<cutters.length;cutterIndex++){
    const cutter=cutters[cutterIndex],map=(point:Vec3)=>inverseTransformPoint(transformPoint(point,cutter.transform),targetTransform);
    let clipped:CSGPolygon[]=[];
    for(const face of cutter.solid.faces.values()){
      const normal=inverseRotate(rotate(face.plane.normal,cutter.transform.rotation),targetTransform.rotation),anchor=map(V.mul(face.plane.normal,face.plane.offset)),plane={normal,offset:V.dot(normal,anchor)};
      for(const triangle of triangulateFaceLocal(cutter.solid,face.id,undefined,'canonical'))clipped.push({vs:triangle.map(map),plane,group:'cutter:'+cutterIndex+':'+face.id,provenance:{kind:'boolean',label:'Subtract'}});
    }
    for(let index=0;index<planes.length&&clipped.length;index++){
      const plane=planes[index],clipper=new CSGPlane(plane.normal,plane.offset),inside:CSGPolygon[]=[],coplanar:CSGPolygon[]=[];
      for(const polygon of clipped)clipper.splitPolygon(polygon,coplanar,coplanar,[],inside);
      const capGroup='target-cap:'+index;
      for(const polygon of coplanar){polygon.group=capGroup;polygon.plane={normal:[...plane.normal] as Vec3,offset:plane.offset};}
      clipped=[...inside,...coplanar];const loops=convexSubtractCapLoops(clipped,plane);
      if(loops.length)clipped.push(...convexSubtractCapPolygons(loops,plane,capGroup));
      report?.({progress:20+50*(cutterIndex+(index+1)/planes.length)/cutters.length,message:`Clipping cutter ${cutterIndex+1} of ${cutters.length} against target plane ${index+1} of ${planes.length}…`});
    }
    let cutVolume=0;
    for(const polygon of clipped)for(let i=1;i<polygon.vs.length-1;i++)cutVolume+=V.dot(V.sub(polygon.vs[0],origin),V.cross(V.sub(polygon.vs[i],origin),V.sub(polygon.vs[i+1],origin)))/6;
    if(!Number.isFinite(cutVolume)||cutVolume < -volumeNoise||cutVolume>originalVolume+volumeNoise)throw Error('The clipped cutter produced inconsistent intersection volume.');
    if(cutVolume>0){intersectionVolume+=cutVolume;clippedCuts.push(...clipped);}
    report?.({progress:20+50*(cutterIndex+1)/cutters.length,message:`Clipping cutter ${cutterIndex+1} of ${cutters.length} complete.`});
  }
  if(!Number.isFinite(intersectionVolume)||intersectionVolume < -volumeNoise||intersectionVolume>originalVolume+volumeNoise)throw Error('The clipped cutter produced inconsistent intersection volume.');
  if(intersectionVolume<=volumeNoise)return {status:'unchanged'};
  if(originalVolume-intersectionVolume<=volumeNoise)return {status:'empty',removedVolume:originalVolume};
  const polygons:CSGPolygon[]=[];
  for(const face of target.faces.values()){
    const index=planes.findIndex(plane=>V.dot(plane.normal,face.plane.normal)>1-TOL.coplanarAngle&&Math.abs(plane.offset-face.plane.offset)<=TOL.coplanarDistance);
    for(const triangle of triangulateFaceLocal(target,face.id,undefined,'canonical'))polygons.push({vs:triangle,plane:face.plane,group:'target-cap:'+index,provenance:{kind:'boolean',label:'Subtract'}});
  }
  // Negative caps retain their target plane for the oriented coplanar boundary
  // sum; other cutter faces reverse their plane as well as their winding.
  for(const polygon of clippedCuts){polygon.vs.reverse();if(!polygon.group?.startsWith('target-cap:'))polygon.plane={normal:V.mul(polygon.plane.normal,-1),offset:-polygon.plane.offset};polygons.push(polygon);}
  return {status:'polygons',polygons,intersectionVolume};
}
