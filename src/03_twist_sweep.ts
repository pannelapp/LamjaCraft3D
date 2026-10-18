const TWIST_SWEEP_POLICY={maximumAngleDeg:360,maximumStepDeg:2,maximumGeneratedTriangles:60000};
interface TwistSweepLayout { face:Face; center:Vec3; loops:Vec3[][]; bands:number; distance:number; angleDeg:number; }
interface TwistSweepPreview { paths:Vec3[][]; center:Vec3; bands:number; }
// A ground profile uses the same cap, centroid, angular bands and side facets
// as face Push/Pull. Translate the swept cap back to z=0 and omit the seed
// prism entirely: the requested height is twisted from bottom to top.
function groundTwistSource(outer:Vec2[],holes:Vec2[][],height:number):{solid:Solid;faceId:FaceId} {
  const solid=prismRegion(outer,holes,height,'ground_twist_source');
  const face=[...solid.faces.values()].find(f=>f.plane.normal[2]>1-TOL.coplanarAngle&&Math.abs(f.plane.offset-height)<=TOL.plane);
  if(!face)throw Error('Could not find the ground profile cap.');return {solid,faceId:face.id};
}
function previewGroundTwist(s:Solid,faceId:FaceId,height:number,angleDeg:number):TwistSweepPreview {
  const preview=previewTwistSweep(s,faceId,height,angleDeg),offset=s.faces.get(faceId)!.plane.offset;
  return {...preview,paths:preview.paths.map(path=>path.map(p=>[p[0],p[1],p[2]-offset] as Vec3)),center:[preview.center[0],preview.center[1],preview.center[2]-offset]};
}
function buildGroundTwist(s:Solid,faceId:FaceId,height:number,angleDeg:number,report?:(update:ModelingProgressUpdate)=>void):Solid {
  if(!Number.isFinite(height)||height<=TOL.minimumEdge)throw Error('Ground twist height must be greater than 0.');
  const layout=twistSweepLayout(s,faceId,height,angleDeg),offset=layout.face.plane.offset;
  report?.({progress:20,message:'Building twisted ground profile…'});
  const inputs=twistSweepFaces(s,layout,true).map(input=>({...input,points:input.points.map(p=>[p[0],p[1],p[2]-offset] as Vec3),planeHint:input.planeHint?{normal:input.planeHint.normal,offset:input.planeHint.offset-offset*input.planeHint.normal[2]}:undefined}));
  report?.({progress:70,message:'Validating twisted ground solid…'});
  const solid=buildSolidFromPolygons(inputs,'ground_twist');validateSolid(solid);report?.({progress:100,message:'Twisted ground solid complete.'});return solid;
}
function twistSweepLayout(s:Solid,faceId:FaceId,distance:number,angleDeg:number):TwistSweepLayout {
  if(!Number.isFinite(distance)||Math.abs(distance)<TOL.minimumEdge)throw Error('Twist requires a nonzero Push/Pull distance.');
  if(!Number.isFinite(angleDeg)||Math.abs(angleDeg)>TWIST_SWEEP_POLICY.maximumAngleDeg)throw Error('Twist angle must be between -360° and 360°.');
  const face=s.faces.get(faceId);if(!face)throw Error('The face does not exist.');
  const points=faceLoopPoints(s,faceId),loops=[points.outer,...points.holes],basis=planeBasis(face.plane,points.outer[0]);
  let twiceArea=0,mx=0,my=0;
  for(const loop of loops){const uv=loop.map(p=>toPlane2(p,basis));for(let i=0;i<uv.length;i++){const a=uv[i],b=uv[(i+1)%uv.length],cross=a[0]*b[1]-b[0]*a[1];twiceArea+=cross;mx+=(a[0]+b[0])*cross;my+=(a[1]+b[1])*cross;}}
  if(twiceArea<=TOL.minimumFaceArea)throw Error('Twist requires a nondegenerate planar face.');
  const center=fromPlane2([mx/(3*twiceArea),my/(3*twiceArea)],basis),bands=Math.max(1,Math.ceil(Math.abs(angleDeg)/TWIST_SWEEP_POLICY.maximumStepDeg)),vertices=loops.reduce((n,loop)=>n+loop.length,0);
  // Four triangles per boundary edge/band; the extra boundary allowance bounds
  // both triangulated caps including hole bridges before allocating the loft.
  if(vertices*(4*bands+4)>TWIST_SWEEP_POLICY.maximumGeneratedTriangles)throw Error('Twist exceeds the geometry budget. Reduce the angle or profile detail.');
  return {face,center,loops,bands,distance,angleDeg};
}
function twistSweepPoint(p:Vec3,layout:TwistSweepLayout,fraction:number):Vec3 {
  if(fraction===0)return [...p] as Vec3;
  const n=layout.face.plane.normal,q=V.sub(p,layout.center),a=layout.angleDeg*Math.PI/180*fraction,c=Math.cos(a),sn=Math.sin(a);
  return V.add(layout.center,V.add(V.add(V.mul(q,c),V.mul(V.cross(n,q),sn)),V.mul(n,V.dot(n,q)*(1-c)+layout.distance*fraction)));
}
function previewTwistSweep(s:Solid,faceId:FaceId,distance:number,angleDeg:number):TwistSweepPreview {
  const layout=twistSweepLayout(s,faceId,distance,angleDeg),paths:Vec3[][]=[];
  for(const loop of layout.loops){
    const top=loop.map(p=>twistSweepPoint(p,layout,1));paths.push([...top,top[0]]);
    for(const p of loop)paths.push(Array.from({length:layout.bands+1},(_,i)=>twistSweepPoint(p,layout,i/layout.bands)));
  }
  return {paths,center:twistSweepPoint(layout.center,layout,1),bands:layout.bands};
}
function twistSweepFaces(s:Solid,layout:TwistSweepLayout,includeStart:boolean):PolyFaceInput[] {
  const inputs:PolyFaceInput[]=[],positive=layout.distance>0;
  const reservedIds=new Set(s.faces.keys());
  const triangle=(points:Vec3[],group:string)=>{
    let faceId=group,suffix=1;while(reservedIds.has(faceId))faceId=group+':'+suffix++;
    reservedIds.add(faceId);
    inputs.push({points:positive?points:[...points].reverse(),group,faceIdHint:faceId,provenance:{kind:'pushpull',label:'Twist'}});
  };
  for(const [loopIndex,loop] of layout.loops.entries())for(let band=0;band<layout.bands;band++)for(let i=0;i<loop.length;i++){
    const j=(i+1)%loop.length,a=twistSweepPoint(loop[i],layout,band/layout.bands),b=twistSweepPoint(loop[j],layout,band/layout.bands),c=twistSweepPoint(loop[j],layout,(band+1)/layout.bands),d=twistSweepPoint(loop[i],layout,(band+1)/layout.bands),group=`twist:${layout.face.id}:${loopIndex}:${band}:${i}`;
    // A centered four-triangle patch avoids the handedness/volume bias of
    // choosing one diagonal across a warped rotational side quad.
    const mid=V.mul(V.add(V.add(a,b),V.add(c,d)),.25);
    triangle([a,b,mid],group+':a');triangle([b,c,mid],group+':b');triangle([c,d,mid],group+':c');triangle([d,a,mid],group+':d');
  }
  const caps=triangulateFaceLocal(s,layout.face.id);
  for(const [i,cap] of caps.entries()){
    if(includeStart)triangle([...cap].reverse(),`twist-start:${layout.face.id}`);
    const points=cap.map(p=>twistSweepPoint(p,layout,1)),normal=positive?layout.face.plane.normal:V.mul(layout.face.plane.normal,-1),offset=(layout.face.plane.offset+layout.distance)*(positive?1:-1);
    inputs.push({points:positive?points:points.reverse(),planeHint:{normal,offset},group:`twist-end:${layout.face.id}`,faceIdHint:i===0?layout.face.id:undefined,provenance:layout.face.provenance});
  }
  return inputs;
}
function twistFaceSweep(s:Solid,faceId:FaceId,distance:number,angleDeg:number,report?:(update:ModelingProgressUpdate)=>void):Omit<SolidEditResult,'topology'> {
  if(angleDeg===0)return moveFace(s,faceId,distance);
  const layout=twistSweepLayout(s,faceId,distance,angleDeg);
  report?.({progress:5,message:'Preparing twisted face sweep…'});
  // A global supporting plane separates all source material from a positive
  // sweep. Under this geometric precondition, attaching the open loft boundary
  // is exactly the union, without BSP re-fragmenting thousands of helical facets.
  const supporting=distance>0&&[...s.vertices.values()].every(vertex=>V.dot(layout.face.plane.normal,vertex.position)-layout.face.plane.offset<=TOL.plane);
  const swept=twistSweepFaces(s,layout,!supporting);report?.({progress:30,message:'Building twisted sweep facets…'});
  let solid:Solid;
  if(supporting){
    const inputs:PolyFaceInput[]=[];
    for(const face of s.faces.values())if(face.id!==faceId)for(const [i,points] of triangulateFaceLocal(s,face.id).entries())inputs.push({points,planeHint:face.plane,group:`twist-source:${face.id}`,faceIdHint:i===0?face.id:undefined,provenance:face.provenance});
    inputs.push(...swept);report?.({progress:60,message:'Reconstructing the attached twisted sweep…'});
    solid=buildSolidFromPolygons(inputs,s.id);validateSolid(solid);
  }else{
    const tool=swept.map(input=>{
      const polygon=csgPolygon(input.points);
      if(input.planeHint)polygon.plane={normal:[...input.planeHint.normal] as Vec3,offset:input.planeHint.offset};
      return {...polygon,group:input.group,faceIdHint:input.faceIdHint,provenance:input.provenance};
    }),base=solidToCsg(s,true);
    report?.({progress:50,message:distance>0?'Adding the twisted sweep…':'Cutting the twisted sweep…'});
    const polygons=distance>0?csgUnionOwned(base,tool):csgSubtractOwned(base,tool);
    solid=csgToSolid(polygons,s.id,{kind:'pushpull',label:'Twist'},true);
  }
  solid.metadata={...s.metadata};
  report?.({progress:100,message:'Twisted sweep complete.'});
  return {solid,distance,limited:false};
}
