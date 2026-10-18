// Two explicit boundary laws share the same validated sweep and loft.
// Proportional scaling preserves hole/profile ratios; edge angle offsets material.
type TaperMode = 'proportional' | 'edge-angle';
const TAPER_SWEEP_POLICY=Object.freeze({maximumAngleDeg:85,maximumProfileVertices:512,maximumInputFaces:20000,maximumCornerMiterRatio:128});
interface TaperSweepPreview {paths:Vec3[][];center:Vec3;}
interface TaperSweepLayout {face:Face;loops:Vec3[][];endLoops:Vec3[][];center:Vec3;bands:number;distance:number;angleDeg:number;twistAngleDeg:number;}
function taperSweepLayout(s:Solid,faceId:FaceId,distance:number,angleDeg:number,twistAngleDeg=0,taperMode:TaperMode='edge-angle'):TaperSweepLayout {
  if(taperMode!=='proportional'&&taperMode!=='edge-angle')throw Error('Choose Proportional or Edge angle for Taper.');
  if(!Number.isFinite(angleDeg)||Math.abs(angleDeg)>TAPER_SWEEP_POLICY.maximumAngleDeg)throw Error('Taper angle must be between -85° and 85°.');
  if(s.faces.size>TAPER_SWEEP_POLICY.maximumInputFaces)throw Error('Taper exceeds the object face budget. Simplify the object first.');
  const twist=twistSweepLayout(s,faceId,distance,twistAngleDeg),{face,loops,center,bands}=twist;
  if(loops.reduce((sum,loop)=>sum+loop.length,0)>TAPER_SWEEP_POLICY.maximumProfileVertices)throw Error('Taper requires a profile with at most 512 boundary vertices, including holes.');
  const basis=planeBasis(face.plane,loops[0][0]),rings=loops.map(loop=>loop.map(p=>toPlane2(p,basis))),setback=Math.abs(distance)*Math.tan(angleDeg*Math.PI/180);
  const directions=rings.map(ring=>ring.map((p,i)=>{const q=ring[(i+1)%ring.length],length=v2.dist(p,q);if(length<=TOL.minimumEdge)throw Error('Taper profile contains a short edge.');return [(q[0]-p[0])/length,(q[1]-p[1])/length] as Vec2;}));
  // Calibrate the angle at the farthest outer point from the original
  // material centroid. All boundaries share the resulting positive scale.
  const center2=toPlane2(center,basis),referenceRadius=Math.max(...rings[0].map(p=>v2.dist(p,center2)));
  const scale=1-setback/referenceRadius;
  if(taperMode==='proportional'&&(!Number.isFinite(scale)||referenceRadius<=TOL.minimumEdge||scale<=0))throw Error('Proportional Taper collapses the profile. Reduce the angle or distance.');
  const offsets=rings.map((ring,k)=>ring.map((p,i)=>{
    if(taperMode==='proportional')return [(p[0]-center2[0])*(scale-1),(p[1]-center2[1])*(scale-1)] as Vec2;
    const previous=(i+ring.length-1)%ring.length,d0=directions[k][previous],d1=directions[k][i],n0=[-d0[1],d0[0]] as Vec2,n1=[-d1[1],d1[0]] as Vec2;
    const q=lineIntersection2([p[0]+n0[0],p[1]+n0[1]],d0,[p[0]+n1[0],p[1]+n1[1]],d1);
    const sameDirection=d0[0]*d1[0]+d0[1]*d1[1]>1-TOL.coplanarAngle;
    const result=q? [q[0]-p[0],q[1]-p[1]] as Vec2:sameDirection?n1:null;
    if(!result||result.some(v=>!Number.isFinite(v))||Math.hypot(...result)>TAPER_SWEEP_POLICY.maximumCornerMiterRatio)throw Error('The Taper corner is unstable or too sharp. Choose a less acute profile.');
    return result.map(v=>v*setback) as Vec2;
  }));
  const at=(k:number,i:number,t:number):Vec2=>[rings[k][i][0]+offsets[k][i][0]*t,rings[k][i][1]+offsets[k][i][1]*t];
  for(let k=0;k<rings.length;k++){
    const ring=rings[k],end=ring.map((_,i)=>at(k,i,1));
    if(ring.some((_,i)=>loops[k][i].some(v=>!Number.isFinite(v))||Math.abs(V.dot(face.plane.normal,loops[k][i])-face.plane.offset)>TOL.plane)||polygonSelfIntersects(ring)||Math.sign(v2.area(ring))!==(k===0?1:-1))throw Error('Taper requires simple planar outer and hole boundaries.');
    if(Math.abs(v2.area(end))<=TOL.minimumFaceArea||Math.sign(v2.area(end))!==Math.sign(v2.area(ring))||polygonSelfIntersects(end))throw Error('Taper collapses or crosses the profile. Reduce the angle or distance.');
    for(let i=0;i<ring.length;i++){const p=end[i],q=end[(i+1)%ring.length],d=directions[k][i];if((q[0]-p[0])*d[0]+(q[1]-p[1])*d[1]<=TOL.minimumEdge)throw Error('Taper collapses a profile edge. Reduce the angle or distance.');}
  }
  // Boundary edges remain parallel during the offset. Their first contact is
  // therefore a moving vertex on a nonincident moving edge, solvable exactly
  // with an affine signed distance. Check the entire interval, not just its end.
  for(let k=0;k<rings.length;k++)for(let i=0;i<rings[k].length;i++)for(let l=0;l<rings.length;l++)for(let j=0;j<rings[l].length;j++){
    const next=(j+1)%rings[l].length;if(k===l&&(i===j||i===next))continue;
    const d=directions[l][j],n=[-d[1],d[0]],delta=[rings[k][i][0]-rings[l][j][0],rings[k][i][1]-rings[l][j][1]],velocity=[offsets[k][i][0]-offsets[l][j][0],offsets[k][i][1]-offsets[l][j][1]];
    const start=n[0]*delta[0]+n[1]*delta[1],speed=n[0]*velocity[0]+n[1]*velocity[1];
    const candidates=Math.abs(speed)>TOL.minimumEdge?[0,1,-start/speed]:[0,1];
    for(const t of candidates)if(t>=0&&t<=1&&pointOnSegment2(at(k,i,t),at(l,j,t),at(l,next,t),TOL.plane))throw Error('Taper reaches a boundary or hole contact. Reduce the angle or distance.');
  }
  for(let k=1;k<rings.length;k++)if(!pointInPolygon2(rings[k][0],rings[0])||rings.some((ring,j)=>j>0&&j!==k&&pointInPolygon2(rings[k][0],ring)))throw Error('Taper holes must be separate and contained by the outer boundary.');
  const endLoops=rings.map((ring,k)=>ring.map((_,i)=>fromPlane2(at(k,i,1),basis)));
  return {face,loops,endLoops,center,bands,distance,angleDeg,twistAngleDeg};
}
function taperSweepPoint(layout:TaperSweepLayout,loop:number,index:number,fraction:number):Vec3 {
  const p=V.add(layout.loops[loop][index],V.mul(V.sub(layout.endLoops[loop][index],layout.loops[loop][index]),fraction));
  return twistSweepPoint(p,{face:layout.face,center:layout.center,loops:layout.loops,bands:layout.bands,distance:layout.distance,angleDeg:layout.twistAngleDeg},fraction);
}
function taperSweepWire(layout:TaperSweepLayout):TaperSweepPreview {
  const paths:Vec3[][]=[];
  for(const [k,loop] of layout.loops.entries()){
    const top=loop.map((_,i)=>taperSweepPoint(layout,k,i,1));paths.push([...top,top[0]]);
    for(let i=0;i<loop.length;i++)paths.push(Array.from({length:layout.bands+1},(_,band)=>taperSweepPoint(layout,k,i,band/layout.bands)));
  }
  return {paths,center:V.add(layout.center,V.mul(layout.face.plane.normal,layout.distance))};
}
function previewTaperSweep(s:Solid,faceId:FaceId,distance:number,angleDeg:number,twistAngleDeg=0,taperMode:TaperMode='edge-angle'):TaperSweepPreview{return taperSweepWire(taperSweepLayout(s,faceId,distance,angleDeg,twistAngleDeg,taperMode));}
function taperSweepFaces(s:Solid,layout:TaperSweepLayout,includeStart:boolean):PolyFaceInput[] {
  const inputs:PolyFaceInput[]=[],positive=layout.distance>0,reservedIds=new Set(s.faces.keys());
  const newFaceId=(group:string):FaceId=>{let id=group,suffix=1;while(reservedIds.has(id))id=group+':'+suffix++;reservedIds.add(id);return id;};
  const side=(points:Vec3[],group:string)=>inputs.push({points:positive?points:[...points].reverse(),group,faceIdHint:newFaceId(group),provenance:{kind:'pushpull',label:layout.twistAngleDeg?'Twist + Taper':'Taper'}});
  for(const [k,loop] of layout.loops.entries())for(let band=0;band<layout.bands;band++)for(let i=0;i<loop.length;i++){
    const j=(i+1)%loop.length,a=taperSweepPoint(layout,k,i,band/layout.bands),b=taperSweepPoint(layout,k,j,band/layout.bands),c=taperSweepPoint(layout,k,j,(band+1)/layout.bands),d=taperSweepPoint(layout,k,i,(band+1)/layout.bands),group=`taper:${layout.face.id}:${k}:${band}:${i}`;
    if(layout.twistAngleDeg===0)side([a,b,c,d],group);
    else {const mid=V.mul(V.add(V.add(a,b),V.add(c,d)),.25);side([a,b,mid],group+':a');side([b,c,mid],group+':b');side([c,d,mid],group+':c');side([d,a,mid],group+':d');}
  }
  if(includeStart)for(const points of triangulateFaceLocal(s,layout.face.id))side([...points].reverse(),`taper-start:${layout.face.id}`);
  // Re-triangulate the offset cap: a concave profile's old diagonals need not
  // remain inside the offset region. Rotation is applied to that final domain.
  const basis=planeBasis(layout.face.plane,layout.loops[0][0]),rings=layout.endLoops.map(loop=>loop.map(p=>toPlane2(p,basis))),cap=triangulatePolygonWithHoles2(rings[0],rings.slice(1));
  for(const [i,triangle] of cap.triangles.entries()){
    const points=triangle.map(index=>twistSweepPoint(fromPlane2(cap.points[index],basis),{face:layout.face,center:layout.center,loops:layout.loops,bands:layout.bands,distance:layout.distance,angleDeg:layout.twistAngleDeg},1));
    inputs.push({points:positive?points:points.reverse(),planeHint:{normal:positive?layout.face.plane.normal:V.mul(layout.face.plane.normal,-1),offset:(layout.face.plane.offset+layout.distance)*(positive?1:-1)},group:`taper-end:${layout.face.id}`,faceIdHint:i===0?layout.face.id:undefined,provenance:layout.face.provenance});
  }
  return inputs;
}
function taperFaceSweep(s:Solid,faceId:FaceId,distance:number,angleDeg:number,report?:(update:ModelingProgressUpdate)=>void,twistAngleDeg=0,taperMode:TaperMode='edge-angle'):Omit<SolidEditResult,'topology'> {
  if(angleDeg===0)return twistFaceSweep(s,faceId,distance,twistAngleDeg,report);
  report?.({progress:5,message:'Checking the tapered profile…'});const layout=taperSweepLayout(s,faceId,distance,angleDeg,twistAngleDeg,taperMode);
  const supporting=distance>0&&[...s.vertices.values()].every(v=>V.dot(layout.face.plane.normal,v.position)-layout.face.plane.offset<=TOL.plane);
  const swept=taperSweepFaces(s,layout,!supporting);report?.({progress:30,message:'Building tapered sweep sides…'});let solid:Solid;
  if(supporting){
    const inputs:PolyFaceInput[]=[];
    for(const face of s.faces.values())if(face.id!==faceId)for(const [i,points] of triangulateFaceLocal(s,face.id).entries())inputs.push({points,planeHint:face.plane,group:`taper-source:${face.id}`,faceIdHint:i===0?face.id:undefined,provenance:face.provenance});
    inputs.push(...swept);report?.({progress:65,message:'Attaching the tapered section…'});solid=buildSolidFromPolygons(inputs,s.id);validateSolid(solid);
  }else{
    const cutter=swept.map(input=>{const poly=csgPolygon(input.points);if(input.planeHint)poly.plane={normal:[...input.planeHint.normal] as Vec3,offset:input.planeHint.offset};return {...poly,group:input.group,faceIdHint:input.faceIdHint,provenance:input.provenance};});
    report?.({progress:50,message:distance>0?'Adding the tapered section…':'Cutting the tapered section…'});
    const base=solidToCsg(s,true),polygons=distance>0?csgUnionOwned(base,cutter):csgSubtractOwned(base,cutter);
    if(!polygons.length)throw Error('Taper would remove the entire object. Reduce the distance.');
    solid=csgToSolid(polygons,s.id,{kind:'pushpull',label:'Taper'},true);
  }
  solid.metadata={...s.metadata};
  for(const sourceFace of s.faces.values()){const target=solid.faces.get(sourceFace.id);if(target){target.material=sourceFace.material;target.boundaryGroup=sourceFace.boundaryGroup;}}
  validateSolid(solid);report?.({progress:100,message:'Tapered Push/Pull complete.'});return {solid,distance,limited:false};
}
function previewGroundTaper(s:Solid,faceId:FaceId,height:number,angleDeg:number,twistAngleDeg=0,taperMode:TaperMode='edge-angle'):TaperSweepPreview {
  const wire=previewTaperSweep(s,faceId,height,angleDeg,twistAngleDeg,taperMode),offset=s.faces.get(faceId)!.plane.offset;
  return {paths:wire.paths.map(path=>path.map(p=>[p[0],p[1],p[2]-offset] as Vec3)),center:[wire.center[0],wire.center[1],wire.center[2]-offset]};
}
function buildGroundTaper(s:Solid,faceId:FaceId,height:number,angleDeg:number,report?:(update:ModelingProgressUpdate)=>void,twistAngleDeg=0,taperMode:TaperMode='edge-angle'):Solid {
  if(!Number.isFinite(height)||height<=TOL.minimumEdge)throw Error('Ground Taper height must be greater than 0.');
  const layout=taperSweepLayout(s,faceId,height,angleDeg,twistAngleDeg,taperMode),offset=layout.face.plane.offset;
  report?.({progress:20,message:'Building the tapered ground shape…'});
  const inputs=taperSweepFaces(s,layout,true).map(input=>({...input,points:input.points.map(p=>[p[0],p[1],p[2]-offset] as Vec3),planeHint:input.planeHint?{normal:input.planeHint.normal,offset:input.planeHint.offset-offset*input.planeHint.normal[2]}:undefined}));
  const solid=buildSolidFromPolygons(inputs,'ground_taper');report?.({progress:80,message:'Validating the tapered ground shape…'});validateSolid(solid);report?.({progress:100,message:'Tapered ground shape complete.'});return solid;
}
