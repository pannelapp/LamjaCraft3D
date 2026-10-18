// Periodic angular coordinates on canonical planar side faces. The radial
// ray/plane intersection follows taper at every height; it never replaces B-rep truth.
const TEXTURE_BAND_POLICY=Object.freeze({
  minimumRepeats:3,maximumRepeats:256,defaultRows:3,maximumRows:16,minimumRadius:.02,minimumRadialCosine:.15,
  maximumFaceAngle:Math.PI/2,contourChordError:.005,maximumContourSubdivisions:8,
  centerConditionTolerance:1e-12,miterRankTolerance:1e-9,miterConstraintTolerance:1e-7,
  maximumMiterLength:6,coordinateWeightTolerance:1e-12,maximumSizePitchRatio:.98,
});
interface TextureBandFrame {axis:Vec3;u:Vec3;v:Vec3;center:Vec3;originHeight:number;originAngle:number;}
interface TextureBandFaceField {basis:PlaneBasis;frame:TextureBandFrame;outer:Vec2[];directions:Vec3[];internalEdges:{a:Vec2;b:Vec2}[];}
interface TextureBandContext extends TextureBandFrame {period:number;pitch:number;middleHeight:number;fields:Map<FaceId,TextureBandFaceField>;}
function textureBandValidate(p:SurfaceTextureParameters):void{
  if(!p.band)return;
  if(!['x','y','z'].includes(p.band.axis)||!Number.isInteger(p.band.repeats)||p.band.repeats<TEXTURE_BAND_POLICY.minimumRepeats||p.band.repeats>TEXTURE_BAND_POLICY.maximumRepeats)throw Error('Choose an object axis and 3–256 repeats around the band.');
  if(!Number.isInteger(p.band.rows??TEXTURE_BAND_POLICY.defaultRows)||(p.band.rows??TEXTURE_BAND_POLICY.defaultRows)<1||(p.band.rows??TEXTURE_BAND_POLICY.defaultRows)>TEXTURE_BAND_POLICY.maximumRows)throw Error('Choose 1–16 pattern rows for the wrapped band.');
  if(['crosshatch','pyramids','beveltiles','rooftiles'].includes(p.type))throw Error('Use Planar patch for Crosshatch or motifs with sloped 3D tops. Wrapped bands support ribs and separate flat-top motifs.');
  if(p.projection)throw Error('Wrapped bands use angular mapping rather than a planar projection.');
  if(p.type==='lines'&&Math.abs(p.angleDeg)>TOL.coplanarAngle)throw Error('Use rotation 0° for continuous wrapped ribs.');
}
function textureBandFrame(s:Solid,axisName:TextureBandAxis,reference?:Vec3):TextureBandFrame{
  const axis:Vec3=axisName==='x'?[1,0,0]:axisName==='y'?[0,1,0]:[0,0,1],u:Vec3=axisName==='x'?[0,1,0]:axisName==='y'?[0,0,1]:[1,0,0],v=V.cross(axis,u);
  // Fit one axis centre, allowing every axial level its own squared-radius
  // intercept. Concentric inner/outer rings and odd facet counts remain centred.
  const levels=new Map<number,Vec2[]>();
  for(const vertex of s.vertices.values()){const point=vertex.position,key=Math.round(V.dot(point,axis)/TOL.topologyKey),row=levels.get(key)||[];row.push([V.dot(point,u),V.dot(point,v)]);levels.set(key,row);}
  let xx=0,xy=0,yy=0,xq=0,yq=0;
  for(const row of levels.values()){
    if(row.length<3)continue;const mx=row.reduce((n,p)=>n+p[0],0)/row.length,my=row.reduce((n,p)=>n+p[1],0)/row.length;
    for(const p of row){const x=p[0]-mx,y=p[1]-my,q=x*x+y*y;xx+=x*x;xy+=x*y;yy+=y*y;xq+=x*q+2*mx*x*x+2*my*x*y;yq+=y*q+2*mx*x*y+2*my*y*y;}
  }
  const det=xx*yy-xy*xy;if(!Number.isFinite(det)||det<=TEXTURE_BAND_POLICY.centerConditionTolerance*(xx+yy)*(xx+yy))throw Error('Could not find a stable band centre for this object axis. Choose another axis or a round side band.');
  const cx=(xq*yy-yq*xy)/(2*det),cy=(yq*xx-xq*xy)/(2*det),center=V.add(V.mul(u,cx),V.mul(v,cy)),relative=V.sub(reference||center,center),radius=Math.hypot(V.dot(relative,u),V.dot(relative,v));
  return {axis,u,v,center,originHeight:reference?V.dot(reference,axis):0,originAngle:radius>TEXTURE_BAND_POLICY.minimumRadius?Math.atan2(V.dot(relative,v),V.dot(relative,u)):0};
}
function textureBandRadius(point:Vec3,frame:TextureBandFrame):number{const q=V.sub(point,frame.center);return Math.hypot(V.dot(q,frame.u),V.dot(q,frame.v));}
function textureBandAngle(point:Vec3,frame:TextureBandFrame):number{const q=V.sub(point,frame.center);return Math.atan2(V.dot(q,frame.v),V.dot(q,frame.u))-frame.originAngle;}
function textureBandUnwrap(angle:number,near:number):number{return angle+2*Math.PI*Math.round((near-angle)/(2*Math.PI));}
function textureBandFaceBounds(s:Solid,id:FaceId,frame:TextureBandFrame,period:number):[number,number,number,number]{
  const points=faceLoopPoints(s,id).outer,centroid=V.mul(points.reduce((n,p)=>V.add(n,p),[0,0,0] as Vec3),1/points.length),near=textureBandAngle(centroid,frame),angles=points.map(p=>textureBandUnwrap(textureBandAngle(p,frame),near));
  const face=s.faces.get(id)!;if(points.some(p=>textureBandRadius(p,frame)<TEXTURE_BAND_POLICY.minimumRadius)||Math.max(...angles)-Math.min(...angles)>TEXTURE_BAND_POLICY.maximumFaceAngle||Math.abs(V.dot(face.plane.normal,V.unit(V.sub(centroid,V.add(frame.center,V.mul(frame.axis,V.dot(centroid,frame.axis)))))))<TEXTURE_BAND_POLICY.minimumRadialCosine)throw Error('Select side faces away from the axis for a wrapped band; caps and pole faces are not supported.');
  const heights=points.map(p=>V.dot(p,frame.axis)-frame.originHeight);
  return [Math.min(...angles)*period/(2*Math.PI),Math.min(...heights),Math.max(...angles)*period/(2*Math.PI),Math.max(...heights)];
}
function textureBandMiter(normals:Vec3[]):Vec3{
  const independent:Vec3[]=[];
  for(const n of normals){if(!independent.length)independent.push(n);else if(independent.length===1&&V.len(V.cross(independent[0],n))>TEXTURE_BAND_POLICY.miterRankTolerance)independent.push(n);else if(independent.length===2&&Math.abs(V.dot(V.cross(independent[0],independent[1]),n))>TEXTURE_BAND_POLICY.miterRankTolerance)independent.push(n);if(independent.length===3)break;}
  let direction=independent[0];
  if(independent.length===2){const [a,b]=independent;direction=V.mul(V.add(a,b),1/(1+V.dot(a,b)));}
  if(independent.length===3){const [a,b,c]=independent;direction=V.mul(V.add(V.add(V.cross(a,b),V.cross(b,c)),V.cross(c,a)),1/V.dot(a,V.cross(b,c)));}
  if(direction.some(n=>!Number.isFinite(n))||V.len(direction)>TEXTURE_BAND_POLICY.maximumMiterLength||normals.some(n=>Math.abs(V.dot(n,direction)-1)>TEXTURE_BAND_POLICY.miterConstraintTolerance))throw Error('These band faces cannot share a stable depth offset. Select a narrower band or a smoother side area.');
  return direction;
}
function createTextureBandContext(s:Solid,ids:readonly FaceId[],p:SurfaceTextureParameters):TextureBandContext{
  if(!p.band)throw Error('Wrapped band settings are missing.');const frame=textureBandFrame(s,p.band.axis,p.referencePoint),normals=new Map<VertexId,Vec3[]>();let radius=0,low=Infinity,high=-Infinity;
  for(const id of ids){const face=s.faces.get(id)!;const bounds=textureBandFaceBounds(s,id,frame,1);low=Math.min(low,bounds[1]);high=Math.max(high,bounds[3]);for(const lid of [face.outerLoop,...face.innerLoops])for(const edge of loopHalfEdges(s,lid)){const ns=normals.get(edge.origin)||[];ns.push(face.plane.normal);normals.set(edge.origin,ns);radius=Math.max(radius,textureBandRadius(s.vertices.get(edge.origin)!.position,frame));}}
  const period=2*Math.PI*radius,pitch=period/p.band.repeats;
  if(p.type!=='lines'&&p.size>=pitch*TEXTURE_BAND_POLICY.maximumSizePitchRatio)throw Error(`Band motifs overlap around the object. Reduce width below ${(pitch*TEXTURE_BAND_POLICY.maximumSizePitchRatio).toFixed(3)} mm or choose fewer repeats.`);
  // Source-side neighbours own depth at a vertex even when only one face is
  // selected. The same ring therefore has the same offset in every selection.
  const incidentFaces=new Map<VertexId,Set<FaceId>>();for(const edge of s.halfEdges.values())if(normals.has(edge.origin)){const faces=incidentFaces.get(edge.origin)||new Set<FaceId>();faces.add(edge.face);incidentFaces.set(edge.origin,faces);}
  for(const [id,ns] of normals){const q=V.sub(s.vertices.get(id)!.position,frame.center),radial=V.unit(V.sub(q,V.mul(frame.axis,V.dot(q,frame.axis)))),side=Math.sign(V.dot(ns[0],radial));for(const faceId of incidentFaces.get(id)||[]){const n=s.faces.get(faceId)!.plane.normal;if(V.dot(n,radial)*side>=TEXTURE_BAND_POLICY.minimumRadialCosine&&!ns.some(p=>V.near(n,p)))ns.push(n);}}
  const directions=new Map([...normals].map(([id,ns])=>[id,textureBandMiter(ns)])),fields=new Map<FaceId,TextureBandFaceField>();
  for(const [id,direction] of directions){const q=V.sub(s.vertices.get(id)!.position,frame.center),radial=V.unit(V.sub(q,V.mul(frame.axis,V.dot(q,frame.axis))));if(Math.abs(V.dot(direction,V.cross(frame.axis,radial)))>TEXTURE_BAND_POLICY.miterConstraintTolerance)throw Error('Wrapped depth requires concentric side rings around the chosen axis. Select a regular round band.');}
  for(const id of ids){const face=s.faces.get(id)!,basis=texturePatternBasis(s,id,p),edges=loopHalfEdges(s,face.outerLoop);fields.set(id,{basis,frame,outer:edges.map(e=>toPlane2(s.vertices.get(e.origin)!.position,basis)),directions:edges.map(e=>directions.get(e.origin)!),internalEdges:edges.filter(e=>ids.includes(s.halfEdges.get(e.twin)?.face||'')).map(e=>({a:toPlane2(s.vertices.get(e.origin)!.position,basis),b:toPlane2(s.vertices.get(s.halfEdges.get(e.next)!.origin)!.position,basis)}))});}
  return {...frame,period,pitch,middleHeight:(low+high)*.5,fields};
}
function textureBandPoint(uv:Vec2,plane:Plane,frame:TextureBandContext):Vec3{
  const angle=uv[0]*2*Math.PI/frame.period+frame.originAngle,radial=V.add(V.mul(frame.u,Math.cos(angle)),V.mul(frame.v,Math.sin(angle))),base=V.add(frame.center,V.mul(frame.axis,uv[1]+frame.originHeight)),den=V.dot(plane.normal,radial);
  if(Math.abs(den)<TEXTURE_BAND_POLICY.minimumRadialCosine)throw Error('A band face turns too far from the radial mapping.');
  const radius=(plane.offset-V.dot(plane.normal,base))/den;if(!Number.isFinite(radius)||radius<TEXTURE_BAND_POLICY.minimumRadius)throw Error('The wrapped band reaches the object axis. Select a narrower side band.');return V.add(base,V.mul(radial,radius));
}
function textureBandMappedLoop(loop:Vec2[],plane:Plane,ctx:TextureBandContext):Vec3[]{
  const out:Vec3[]=[];
  const segment=(a:Vec2,b:Vec2,pa:Vec3,pb:Vec3,level:number)=>{const mid:Vec2=[(a[0]+b[0])*.5,(a[1]+b[1])*.5],pm=textureBandPoint(mid,plane,ctx),delta=V.sub(pb,pa),lengthSquared=V.dot(delta,delta),t=lengthSquared?Math.max(0,Math.min(1,V.dot(V.sub(pm,pa),delta)/lengthSquared)):0;if(V.len(V.sub(pm,V.lerp(pa,pb,t)))>TEXTURE_BAND_POLICY.contourChordError){if(level>=TEXTURE_BAND_POLICY.maximumContourSubdivisions)throw Error('Wrapped contour detail exceeds the band budget. Reduce motif size or choose a narrower band.');segment(a,mid,pa,pm,level+1);segment(mid,b,pm,pb,level+1);}else out.push(pa);};
  for(let i=0;i<loop.length;i++){const a=loop[i],b=loop[(i+1)%loop.length];segment(a,b,textureBandPoint(a,plane,ctx),textureBandPoint(b,plane,ctx),0);}return out;
}
function textureBandCandidates(s:Solid,id:FaceId,p:SurfaceTextureParameters,ctx:TextureBandContext):{basis:PlaneBasis;candidates:SurfaceTextureCandidate[];parameters:SurfaceTextureParameters}{
  const face=s.faces.get(id)!,basis=ctx.fields.get(id)!.basis,b=textureBandFaceBounds(s,id,ctx,ctx.period),pitchY=p.type==='hex'?p.spacing*Math.sqrt(3)/2:p.spacing,offset=((p.offsetX%ctx.period)+ctx.period)%ctx.period,iy0=0,iy1=(p.band?.rows??TEXTURE_BAND_POLICY.defaultRows)-1,out:SurfaceTextureCandidate[]=[];
  const rectangle:Vec2[]=[[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]]];
  const add=(outline:Vec2[],family:0|1)=>{
    const fragments:Vec3[][]=[],uvPlane:Plane={normal:[0,0,1],offset:0};
    // Assemble the clipped UV boundary before nonlinear mapping. Mapping each
    // triangle first would approximate shared interior curves independently.
    for(const t of triangulateSimple2(outline)){const clipped=textureIntersectFragments2(t.map(i=>outline[i]),rectangle);if(clipped.length>=3)fragments.push(clipped.map(q=>[q[0],q[1],0] as Vec3));}
    if(!fragments.length)return;
    const regions=classifyPlaneLoops(boundaryLoopsFromPolygons(fragments,uvPlane).map(simplifyCollinearLoop3),uvPlane);
    for(const r of regions){if(r.holes.length)throw Error('A wrapped motif unexpectedly formed a hole.');out.push({outline:textureBandMappedLoop(r.outer.map(q=>[q[0],q[1]] as Vec2),face.plane,ctx).map(q=>toPlane2(q,basis)),family});}
  };
  if(p.type==='lines')for(let iy=iy0;iy<=iy1;iy++)add(textureRectangle((b[0]+b[2])*.5,(iy-iy1*.5)*pitchY+ctx.middleHeight+p.offsetY,b[2]-b[0],p.size),0);
  const ix0=Math.floor((b[0]-p.size-offset)/ctx.pitch)-1,ix1=Math.ceil((b[2]+p.size-offset)/ctx.pitch)+1;
  textureCheckCandidateCount((ix1-ix0+1)*(iy1-iy0+1));
  if(p.type!=='lines')for(let iy=iy0;iy<=iy1;iy++)for(let ix=ix0;ix<=ix1;ix++){
    const stagger=(p.type==='dots'||p.type==='hex')&&(iy&1)?ctx.pitch*.5:0,cx=ix*ctx.pitch+stagger+offset,cy=(iy-iy1*.5)*pitchY+ctx.middleHeight+p.offsetY,angle=p.angleDeg*Math.PI/180;
    const local=p.type==='dots'?textureRegularPolygon(0,0,p.size*.5,SURFACE_TEXTURE_POLICY.circleSegments):p.type==='hex'?textureRegularPolygon(0,0,p.size*.5,SURFACE_TEXTURE_POLICY.hexSegments,Math.PI/6):textureMotifOutline(p.type,p.size),transform=(q:Vec2):Vec2=>{const r=textureRotate2(q,angle);return [r[0]+cx,r[1]+cy];};add(local.map(transform),0);
  }
  return {basis,candidates:out,parameters:p};
}
function textureBandDirection(point:Vec2,field:TextureBandFaceField):Vec3{
  const outer=field.outer;
  for(let i=0;i<outer.length;i++){const a=outer[i],b=outer[(i+1)%outer.length];if(pointOnSegment2(point,a,b,TOL.topologyKey)){const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/(dx*dx+dy*dy)));return V.lerp(field.directions[i],field.directions[(i+1)%outer.length],t);}}
  const relative=outer.map(p=>[p[0]-point[0],p[1]-point[1]] as Vec2),lengths=relative.map(p=>Math.hypot(...p)),tangents=relative.map((a,i)=>{const j=(i+1)%outer.length,b=relative[j];return v2.cross([0,0],a,b)/(lengths[i]*lengths[j]+a[0]*b[0]+a[1]*b[1]);}),weights=outer.map((_p,i)=>(tangents[(i+outer.length-1)%outer.length]+tangents[i])/lengths[i]),sum=weights.reduce((n,w)=>n+w,0);
  if(!Number.isFinite(sum)||Math.abs(sum)<TEXTURE_BAND_POLICY.coordinateWeightTolerance)throw Error('Could not interpolate a stable band depth.');
  // Preserve the angular coordinate through the sweep. Interpolate the axial
  // miter component, then solve the exact face-normal depth constraint.
  const axial=weights.reduce((n,w,i)=>n+w*V.dot(field.directions[i],field.frame.axis),0)/sum,q=V.sub(fromPlane2(point,field.basis),field.frame.center),radial=V.unit(V.sub(q,V.mul(field.frame.axis,V.dot(q,field.frame.axis)))),den=V.dot(field.basis.normal,radial);
  return V.add(V.mul(field.frame.axis,axial),V.mul(radial,(1-V.dot(field.basis.normal,field.frame.axis)*axial)/den));
}
function textureBandSnapLoop(loop:Vec2[],field:TextureBandFaceField):Vec2[]{
  const snapped=loop.map(point=>{for(const vertex of field.outer)if(v2.dist(point,vertex)<=TOL.topologyKey)return [...vertex] as Vec2;let best=point;let distance:number=TOL.topologyKey;for(let i=0;i<field.outer.length;i++){const a=field.outer[i],b=field.outer[(i+1)%field.outer.length],dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/(dx*dx+dy*dy))),q:Vec2=[a[0]+t*dx,a[1]+t*dy],d=v2.dist(point,q);if(d<distance){best=q;distance=d;}}return best;});
  const out:Vec2[]=[];for(const q of snapped)if(!out.length||v2.dist(q,out.at(-1)!)>TOL.weld)out.push(q);if(out.length>1&&v2.dist(out[0],out.at(-1)!)<=TOL.weld)out.pop();return out;
}
function textureBandSurface(component:SurfaceTextureRegion,field:TextureBandFaceField,depth:number):PolyFaceInput[]{
  const out:PolyFaceInput[]=[],point=(uv:Vec2,z:number)=>V.add(fromPlane2(uv,field.basis),V.mul(textureBandDirection(uv,field),z)),
    push=(points:Vec3[],planeHint?:Plane)=>out.push({points,planeHint,provenance:{kind:'boolean',label:'Wrapped band'}}),
    cap:Plane={normal:field.basis.normal,offset:V.dot(field.basis.normal,field.basis.origin)+depth};
  const mesh=triangulatePolygonWithHoles2(component.outer,component.holes);
  for(const t of mesh.triangles)push(t.map(i=>point(mesh.points[i],depth)),cap);
  for(const loop of [component.outer,...component.holes])for(let i=0;i<loop.length;i++){
    const a=loop[i],b=loop[(i+1)%loop.length];if(field.internalEdges.some(e=>pointOnSegment2(a,e.a,e.b,TOL.topologyKey)&&pointOnSegment2(b,e.a,e.b,TOL.topologyKey)))continue;
    const points=[point(a,0),point(b,0),point(b,depth),point(a,depth)];
    const plane=planeFromPoints(points);
    if(points.every(q=>Math.abs(V.dot(plane.normal,q)-plane.offset)<=TOL.plane))push(points,plane);
    else{push([points[0],points[1],points[2]]);push([points[0],points[2],points[3]]);}
  }
  return out;
}
function textureBandCrossesTriangle(a:Vec3,b:Vec3,triangle:Vec3[]):boolean{
  const plane=planeFromPoints(triangle),da=V.dot(plane.normal,a)-plane.offset,db=V.dot(plane.normal,b)-plane.offset;
  if(da*db>=0||Math.abs(da)<=TOL.plane||Math.abs(db)<=TOL.plane)return false;
  const point=V.lerp(a,b,da/(da-db)),basis=planeBasis(plane,triangle[0]);return pointInPolygon2(toPlane2(point,basis),triangle.map(q=>toPlane2(q,basis)));
}
function textureBandBounds3(points:Vec3[]):{min:Vec3;max:Vec3}{return {min:[0,1,2].map(i=>Math.min(...points.map(p=>p[i]))) as Vec3,max:[0,1,2].map(i=>Math.max(...points.map(p=>p[i]))) as Vec3};}
function textureBandCheckClearance(s:Solid,selected:Set<FaceId>,features:PolyFaceInput[],depth:number):void{
  // Verify the actual generated surfaces against every retained source surface.
  // A wrapped skin operation must not cut through another wall or merge with
  // an unrelated surface; those events need the general Boolean operation.
  const sourceTriangles=[...s.faces.values()].filter(f=>!selected.has(f.id)).flatMap(f=>triangulateFaceLocal(s,f.id,undefined,'canonical')),sourceBounds=sourceTriangles.map(textureBandBounds3),newTriangles:Vec3[][]=[];
  for(const f of features){const plane=f.planeHint||planeFromPoints(f.points),basis=planeBasis(plane,f.points[0]);if(f.points.length===3)newTriangles.push(f.points);else for(const t of triangulateSimple2(f.points.map(q=>toPlane2(q,basis))))newTriangles.push(t.map(i=>f.points[i]));}
  const overlaps=(a:{min:Vec3;max:Vec3},b:{min:Vec3;max:Vec3})=>a.min.every((n,i)=>n<=b.max[i]+TOL.plane&&a.max[i]>=b.min[i]-TOL.plane);
  for(const triangle of newTriangles){const bounds=textureBandBounds3(triangle);for(let i=0;i<sourceTriangles.length;i++){if(!overlaps(bounds,sourceBounds[i]))continue;const other=sourceTriangles[i];for(let j=0;j<3;j++)if(textureBandCrossesTriangle(triangle[j],triangle[(j+1)%3],other)||textureBandCrossesTriangle(other[j],other[(j+1)%3],triangle))throw Error('Wrapped depth crosses another surface. Reduce height / depth or select a band farther from other walls.');}}
  const vertices:Vec3[]=[],triangles:[number,number,number][]=[];for(const f of s.faces.values())for(const tri of triangulateFaceLocal(s,f.id,undefined,'canonical')){const i=vertices.length;vertices.push(...tri);triangles.push([i,i+1,i+2]);}
  const component=triangles.map((_t,i)=>i),tested=new Set<string>();
  for(const f of features){if(!f.planeHint)continue;const center=V.mul(f.points.reduce((n,q)=>V.add(n,q),[0,0,0] as Vec3),1/f.points.length),key=pointKey3(center);if(tested.has(key))continue;tested.add(key);const inside=meshShellContainsPoint(vertices,triangles,component,center);if(inside!==(depth<0))throw Error('Wrapped depth leaves the intended surface layer. Reduce height / depth.');}
}
function applyTextureBandPatch(s:Solid,patch:ReturnType<typeof surfaceTexturePatchLayouts>,diagnostic:ModelingDiagnosticReporter,onProgress?:((update:ModelingProgressUpdate)=>void)):Solid{
  const selected=new Set(patch.faces.map(f=>f.faceId)),inputs:PolyFaceInput[]=[],features:PolyFaceInput[]=[],depth=patch.parameters.depth*(patch.parameters.operation==='add'?1:-1);let processed=0;
  for(const f of s.faces.values())if(!selected.has(f.id))for(const points of triangulateFaceLocal(s,f.id,undefined,'canonical'))inputs.push({points,planeHint:f.plane,provenance:f.provenance});
  for(const {faceId,layout} of patch.faces){
    onProgress?.({progress:SURFACE_TEXTURE_POLICY.progressBuildStart+SURFACE_TEXTURE_POLICY.progressBuildSpan*processed++/patch.faces.length,message:`Building texture face ${processed} of ${patch.faces.length}…`});
    const plane=s.faces.get(faceId)!.plane,regions=[...layout.byFamily.values()].flat();
    // The face complement is an oriented boundary difference. Whole source
    // edges cancel against whole footprint edges, without introducing a new
    // triangulation or tiny clipping slivers along already-matched seams.
    const loops=faceLoopPoints(s,faceId),boundaries=[loops.outer,...loops.holes];
    for(const region of regions)for(const loop of [region.outer,...region.holes])boundaries.push([...loop].reverse().map(q=>fromPlane2(q,layout.basis)));
    const remainder=classifyPlaneLoops(boundaryLoopsFromPolygons(boundaries,plane).map(simplifyCollinearLoop3).filter(loop=>Math.abs(v2.area(loop.map(q=>toPlane2(q,layout.basis))))>TOL.minimumFaceArea),plane);
    for(const region of remainder){const mesh=triangulatePolygonWithHoles2(region.outer.map(q=>toPlane2(q,layout.basis)),region.holes.map(h=>h.map(q=>toPlane2(q,layout.basis))));for(const t of mesh.triangles)inputs.push({points:t.map(i=>fromPlane2(mesh.points[i],layout.basis)),planeHint:plane,provenance:s.faces.get(faceId)!.provenance});}
    for(const region of regions)features.push(...textureBandSurface(region,layout.band!,depth));
    diagnostic('texture','band-face-built',{faceId,regions:regions.length,remainingRegions:remainder.length});
  }
  onProgress?.({progress:SURFACE_TEXTURE_POLICY.progressBoolean,message:'Checking wrapped surface clearance…'});textureBandCheckClearance(s,selected,features,depth);
  onProgress?.({progress:SURFACE_TEXTURE_POLICY.progressValidation,message:'Validating textured geometry…'});
  diagnostic('brep','band-rebuild-start',{sourceFaces:s.faces.size,polygons:inputs.length+features.length,featurePolygons:features.length});
  const out=buildSolidFromPolygons([...inputs,...features],s.id);out.metadata=structuredClone(s.metadata);validateSolid(out);
  diagnostic('brep','validation-ok',{faces:out.faces.size,vertices:out.vertices.size});diagnostic('texture','band-surface-validated',{faces:out.faces.size,vertices:out.vertices.size});return out;
}
function textureBandSelection(s:Solid,ids:readonly FaceId[],p:SurfaceTextureParameters,wholeRing:boolean):FaceId[]{
  if(!p.band||!ids.length)return [];const frame=textureBandFrame(s,p.band.axis,p.referencePoint),selected=new Set(ids),seed=ids.at(-1)!,seedFace=s.faces.get(seed)!,seedPoints=faceLoopPoints(s,seed).outer,lo=Math.min(...seedPoints.map(q=>V.dot(q,frame.axis))),hi=Math.max(...seedPoints.map(q=>V.dot(q,frame.axis))),mid=V.mul(seedPoints.reduce((a,q)=>V.add(a,q),[0,0,0] as Vec3),1/seedPoints.length),radial=V.unit(V.sub(mid,V.add(frame.center,V.mul(frame.axis,V.dot(mid,frame.axis))))),side=Math.sign(V.dot(seedFace.plane.normal,radial)),out:FaceId[]=[];
  const candidates=wholeRing?[...s.faces.keys()]:[...new Set(ids.flatMap(id=>{const f=s.faces.get(id)!;return [f.outerLoop,...f.innerLoops].flatMap(lid=>loopHalfEdges(s,lid).map(e=>s.halfEdges.get(e.twin)?.face||''));}))];
  for(const id of candidates){if(!id||selected.has(id))continue;const face=s.faces.get(id)!,points=faceLoopPoints(s,id).outer,low=Math.min(...points.map(q=>V.dot(q,frame.axis))),high=Math.max(...points.map(q=>V.dot(q,frame.axis))),center=V.mul(points.reduce((a,q)=>V.add(a,q),[0,0,0] as Vec3),1/points.length),r=V.sub(center,V.add(frame.center,V.mul(frame.axis,V.dot(center,frame.axis))));
    if(V.len(r)<TEXTURE_BAND_POLICY.minimumRadius||V.dot(face.plane.normal,V.unit(r))*side<TEXTURE_BAND_POLICY.minimumRadialCosine||points.some(q=>textureBandRadius(q,frame)<TEXTURE_BAND_POLICY.minimumRadius))continue;
    if(wholeRing&&(Math.abs(low-lo)>TOL.plane||Math.abs(high-hi)>TOL.plane))continue;out.push(id);
  }
  return out;
}
