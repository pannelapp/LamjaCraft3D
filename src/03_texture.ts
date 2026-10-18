// Geometric surface textures for planar face areas. Patterns use one common
// plane, project onto each face, and clip to its domain (including holes).
// An optional Euclidean perimeter keep-out band bounds the combined tooling,
// which commits through one validated Add/Cut operation.

const SURFACE_TEXTURE_POLICY=Object.freeze({
  maximumInstances:4000,
  maximumComponents:6000,
  previewOutlines:1200,
  previewReliefLines:2400,
  maximumEstimatedFaces:120000,
  bevelTopRatio:.55,
  circleSegments:12,
  hexSegments:6,
  squareSides:4,
  triangleSides:3,
  starPoints:5,
  starInnerRadiusRatio:.45,
  slotWidthRatio:.4,
  chevronHeightRatio:.75,
  chevronThicknessRatio:.2,
  motifPaddingCells:1,
  minimumSpacing:.15,
  minimumSize:.05,
  minimumDepth:.02,
  maximumDepth:50,
  maximumSelectedFaces:1000,
  minimumProjectionCosine:.2,
  progressLayout:5,
  progressBuildStart:20,
  progressBuildSpan:50,
  progressBoolean:75,
  progressValidation:90,
  projectionFrameTolerance:1e-7,
  cutterOverlapToleranceFactor:16,
  maximumCutterOverlap:.02,
  cutterOverlapDepthFactor:.08,
});

interface SurfaceTextureReliefFacet { points:[Vec2,Vec2,Vec2]; heights:[number,number,number]; }
interface SurfaceTextureCandidate { outline:Vec2[]; family:0|1; patternPlanes?:Plane[]; relief?:SurfaceTextureReliefFacet[]; }
interface SurfaceTextureRegion { outer:Vec2[];holes:Vec2[][];patternPlanes?:Plane[];relief?:SurfaceTextureReliefFacet[];fullOutline?:Vec2[]; }
interface SurfaceTextureClipContext {
  solid:Solid;
  faceId:FaceId;
  basis:PlaneBasis;
  convexDomain?:{outline:Vec2[];margin:number};
  faceTriangles:Vec2[][];
  faceTriangleBounds:[number,number,number,number][];
  keepouts:{poly:Vec2[];bounds:[number,number,number,number]}[];
}
interface SurfaceTextureLayoutInternal {
  band?:TextureBandFaceField;
  basis:PlaneBasis;
  byFamily:Map<number,SurfaceTextureRegion[]>;
  outlines:Vec2[][];
  reliefLines:Vec3[][];
  previewTruncated:boolean;
  instances:number;
  components:number;
  estimatedFaces:number;
  complexity:'Low'|'Medium'|'High';
}

function textureBounds2(p:Vec2[]):[number,number,number,number]{const xs=p.map(q=>q[0]),ys=p.map(q=>q[1]);return [Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];}
function textureBoundsOverlap(a:[number,number,number,number],b:[number,number,number,number]):boolean{return a[0]<=b[2]+TOL.topologyKey&&a[2]>=b[0]-TOL.topologyKey&&a[1]<=b[3]+TOL.topologyKey&&a[3]>=b[1]-TOL.topologyKey;}
function textureCheckCandidateCount(count:number):void{
  if(!Number.isSafeInteger(count)||count>SURFACE_TEXTURE_POLICY.maximumInstances)throw Error(`Texture is too dense. Increase spacing or select a smaller area; the limit is ${SURFACE_TEXTURE_POLICY.maximumInstances} pattern instances.`);
}
function textureReliefProfile(type:SurfaceTextureType,size:number):SurfaceTextureReliefFacet[]|undefined{
  if(type!=='pyramids'&&type!=='beveltiles'&&type!=='rooftiles')return undefined;
  const outer=textureMotifOutline(type,size),facets:SurfaceTextureReliefFacet[]=[],center:Vec2=[0,0];
  const facet=(a:Vec2,b:Vec2,c:Vec2,ha:number,hb:number,hc:number)=>facets.push({points:[a,b,c],heights:[ha,hb,hc]});
  if(type==='rooftiles'){const [a,b,c,d]=outer,low:Vec2=[0,-size*.5],high:Vec2=[0,size*.5];facet(a,low,high,0,1,1);facet(a,high,d,0,1,0);facet(low,b,c,1,0,0);facet(low,c,high,1,0,1);return facets;}
  if(type==='pyramids'){for(let i=0;i<outer.length;i++)facet(outer[i],outer[(i+1)%outer.length],center,0,0,1);return facets;}
  const ratio=SURFACE_TEXTURE_POLICY.bevelTopRatio,height=1,inner=outer.map(p=>[p[0]*ratio,p[1]*ratio] as Vec2);
  for(let i=0;i<outer.length;i++){
    const j=(i+1)%outer.length;facet(outer[i],outer[j],inner[j],0,0,height);facet(outer[i],inner[j],inner[i],0,height,height);
    facet(inner[i],inner[j],center,height,height,1);
  }
  return facets;
}
function textureReliefHeight(f:SurfaceTextureReliefFacet,p:Vec2):number{
  const [a,b,c]=f.points,det=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]),
    u=((p[0]-a[0])*(c[1]-a[1])-(p[1]-a[1])*(c[0]-a[0]))/det,
    v=((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]))/det;
  return f.heights[0]+u*(f.heights[1]-f.heights[0])+v*(f.heights[2]-f.heights[0]);
}
function textureReliefFragments(component:SurfaceTextureRegion):{outline:Vec2[];facet:SurfaceTextureReliefFacet}[]{
  if(!component.relief)return [];
  const triangulation=triangulatePolygonWithHoles2(component.outer,component.holes),domain=triangulation.triangles.map(t=>t.map(i=>triangulation.points[i])),out:{outline:Vec2[];facet:SurfaceTextureReliefFacet}[]=[];
  for(const facet of component.relief){const bounds=textureBounds2(facet.points);for(const triangle of domain){
    if(!textureBoundsOverlap(bounds,textureBounds2(triangle)))continue;
    const outline=convexIntersection2(triangle,facet.points);
    if(outline.length>=3&&Math.abs(v2.area(outline))>TOL.minimumFaceArea)out.push({outline,facet});
  }}
  return out;
}
function textureOnBoundary(a:Vec2,b:Vec2,component:SurfaceTextureRegion):boolean{
  for(const loop of [component.outer,...component.holes])for(let i=0;i<loop.length;i++){
    const p=loop[i],q=loop[(i+1)%loop.length];if(pointOnSegment2(a,p,q,TOL.topologyKey)&&pointOnSegment2(b,p,q,TOL.topologyKey))return true;
  }
  return false;
}
function textureReliefCellCsg(component:SurfaceTextureRegion,basis:PlaneBasis,z0:number,z1:number,direction:Vec3,p:SurfaceTextureParameters):CSGPolygon[]{
  const out:CSGPolygon[]=[],point=(uv:Vec2,z:number)=>V.add(fromPlane2(uv,basis),V.mul(direction,z)),
    polygon=(vs:Vec3[],normal:Vec3)=>{const poly=csgPolygon(vs);poly.plane={normal,offset:V.dot(normal,vs[0])};out.push(poly);};
  for(const facet of component.relief||[]){
    const outline=facet.points;
    const height=(uv:Vec2)=>p.depth*textureReliefHeight(facet,uv),low=(uv:Vec2)=>point(uv,p.operation==='cut'?-height(uv):z0),high=(uv:Vec2)=>point(uv,p.operation==='add'?height(uv):z1),
      a=facet.points[0],b=facet.points[1],c=facet.points[2],det=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]),
      hu=((facet.heights[1]-facet.heights[0])*(c[1]-a[1])-(facet.heights[2]-facet.heights[0])*(b[1]-a[1]))/det,
      hv=((b[0]-a[0])*(facet.heights[2]-facet.heights[0])-(c[0]-a[0])*(facet.heights[1]-facet.heights[0]))/det,
      sign=p.operation==='add'?1:-1,roofNormal=V.unit(V.add(V.add(V.mul(V.cross(basis.v,direction),-sign*p.depth*hu),V.mul(V.cross(direction,basis.u),-sign*p.depth*hv)),basis.normal));
    polygon(outline.map(high),p.operation==='add'?roofNormal:basis.normal);
    polygon([...outline].reverse().map(low),V.mul(p.operation==='cut'?roofNormal:basis.normal,-1));
    for(let i=0;i<outline.length;i++){
      const uv=outline[i],next=outline[(i+1)%outline.length];if(!textureOnBoundary(uv,next,component))continue;
      const vs=[low(uv),low(next),high(next),high(uv)],normal=V.unit(V.cross(V.sub(fromPlane2(next,basis),fromPlane2(uv,basis)),direction)),
        shared=component.patternPlanes?.find(plane=>V.dot(plane.normal,normal)>1-TOL.coplanarAngle&&vs.every(v=>Math.abs(V.dot(plane.normal,v)-plane.offset)<=TOL.plane));
      const wall=csgPolygon(vs);wall.plane=shared||{normal,offset:V.dot(normal,vs[0])};out.push(wall);
    }
  }
  return out;
}
function textureReliefCsg(component:SurfaceTextureRegion,basis:PlaneBasis,z0:number,z1:number,direction:Vec3,p:SurfaceTextureParameters):CSGPolygon[]{
  if(!component.fullOutline)throw Error('Relief construction requires its complete footprint.');
  // Build one closed height-field cell, then intersect it with the same closed
  // clipped column used by flat patterns. Boolean clipping owns roof/wall/hole
  // junctions instead of independently reconstructing their polygon borders.
  const relief=textureReliefCellCsg({...component,outer:component.fullOutline,holes:[]},basis,z0,z1,direction,p),
    column=textureComponentCsg({...component,relief:undefined},basis,z0,z1,direction,p);
  return csgIntersectOwned(relief,column);
}
function textureRotate2(p:Vec2,angle:number):Vec2{const c=Math.cos(angle),s=Math.sin(angle);return [p[0]*c-p[1]*s,p[0]*s+p[1]*c];}
function textureInverseRotate2(p:Vec2,angle:number):Vec2{return textureRotate2(p,-angle);}
function textureRectangle(cx:number,cy:number,w:number,h:number):Vec2[]{const x=w*.5,y=h*.5;return [[cx-x,cy-y],[cx+x,cy-y],[cx+x,cy+y],[cx-x,cy+y]];}
function textureRegularPolygon(cx:number,cy:number,r:number,n:number,phase=0):Vec2[]{return Array.from({length:n},(_,i)=>[cx+r*Math.cos(phase+i*Math.PI*2/n),cy+r*Math.sin(phase+i*Math.PI*2/n)] as Vec2);}
function textureTransformPatternLoop(loop:Vec2[],angle:number,offsetX:number,offsetY:number):Vec2[]{return loop.map(p=>{const q=textureRotate2(p,angle);return [q[0]+offsetX,q[1]+offsetY] as Vec2;});}
function texturePatternBasis(s:Solid,faceId:FaceId,p:SurfaceTextureParameters):PlaneBasis{
  const face=s.faces.get(faceId);if(!face)throw Error('Select a valid planar face.');const loops=faceLoopPoints(s,faceId);
  if(!p.referencePoint)return planeBasis(face.plane,loops.outer[0]);
  const n=V.unit(face.plane.normal),ref=p.referencePoint,origin=V.add(ref,V.mul(n,face.plane.offset-V.dot(n,ref)));
  if(p.referenceU){const projected=V.sub(p.referenceU,V.mul(n,V.dot(p.referenceU,n)));if(V.len(projected)>1e-8){const u=V.unit(projected),v=V.unit(V.cross(n,u));return {origin,u,v,normal:n};}}
  return planeBasis(face.plane,origin);
}
function textureFaceUvBounds(s:Solid,faceId:FaceId,basis:PlaneBasis,angle:number,offsetX:number,offsetY:number):[number,number,number,number]{
  const loops=faceLoopPoints(s,faceId),pts=[...loops.outer,...loops.holes.flat()].map(p=>toPlane2(p,basis)).map(p=>textureInverseRotate2([p[0]-offsetX,p[1]-offsetY],angle));return textureBounds2(pts);
}
function textureValidatedParameters(input:SurfaceTextureParameters):SurfaceTextureParameters{
  const p={...input};
  if(!['lines','crosshatch','dots','hex','squares','diamonds','triangles','stars','slots','chevrons','pyramids','beveltiles','rooftiles'].includes(p.type))throw Error('Choose a valid texture type.');
  if(p.operation!=='add'&&p.operation!=='cut')throw Error('Choose Add or Cut.');
  for(const [label,value] of [['spacing',p.spacing],['size',p.size],['depth',p.depth],['angle',p.angleDeg],['margin',p.margin],['offset X',p.offsetX],['offset Y',p.offsetY]] as [string,number][])if(!Number.isFinite(value))throw Error(`Enter a valid texture ${label}.`);
  if(p.referencePoint&&(!Array.isArray(p.referencePoint)||p.referencePoint.length!==3||p.referencePoint.some(v=>!Number.isFinite(v))))throw Error('Enter a valid shared texture reference point.');
  if(p.referenceU&&(!Array.isArray(p.referenceU)||p.referenceU.length!==3||p.referenceU.some(v=>!Number.isFinite(v))))throw Error('Enter a valid shared texture reference direction.');
  if(p.projection){const b=p.projection,t=SURFACE_TEXTURE_POLICY.projectionFrameTolerance;
    if([b.origin,b.u,b.v,b.normal].some(a=>!Array.isArray(a)||a.length!==3||a.some(v=>!Number.isFinite(v)))||[b.u,b.v,b.normal].some(a=>Math.abs(V.len(a)-1)>t)||Math.abs(V.dot(b.u,b.v))>t||V.len(V.sub(V.cross(b.u,b.v),b.normal))>t)throw Error('The texture projection frame must be finite and orthonormal.');
  }
  if(p.spacing<SURFACE_TEXTURE_POLICY.minimumSpacing)throw Error(`Texture spacing must be at least ${SURFACE_TEXTURE_POLICY.minimumSpacing} mm.`);
  if(p.size<SURFACE_TEXTURE_POLICY.minimumSize)throw Error(`Texture width / size must be at least ${SURFACE_TEXTURE_POLICY.minimumSize} mm.`);
  if(p.size>=p.spacing*.98)throw Error('Texture width / size must be smaller than spacing so individual features remain separated.');
  if(p.depth<SURFACE_TEXTURE_POLICY.minimumDepth||p.depth>SURFACE_TEXTURE_POLICY.maximumDepth)throw Error(`Texture height / depth must be between ${SURFACE_TEXTURE_POLICY.minimumDepth} and ${SURFACE_TEXTURE_POLICY.maximumDepth} mm.`);
  if(p.margin<0||p.margin>1000)throw Error('Texture edge margin must be between 0 and 1,000 mm.');
  p.angleDeg=((p.angleDeg%360)+360)%360;textureBandValidate(p);return p;
}
function textureLineFamilyCandidates(s:Solid,faceId:FaceId,basis:PlaneBasis,p:SurfaceTextureParameters,angleDeg:number,family:0|1):SurfaceTextureCandidate[]{
  const a=angleDeg*Math.PI/180,b=textureFaceUvBounds(s,faceId,basis,a,p.offsetX,p.offsetY),pad=p.spacing*2,lo=Math.floor((b[1]-pad)/p.spacing),hi=Math.ceil((b[3]+pad)/p.spacing),length=(b[2]-b[0])+pad*2,out:SurfaceTextureCandidate[]=[];
  textureCheckCandidateCount(hi-lo+1);
  for(let k=lo;k<=hi;k++){const y=k*p.spacing,rect=textureRectangle((b[0]+b[2])*.5,y,length,p.size),outline=textureTransformPatternLoop(rect,a,p.offsetX,p.offsetY);out.push({outline,family});}
  return out;
}
function textureDotCandidates(s:Solid,faceId:FaceId,basis:PlaneBasis,p:SurfaceTextureParameters):SurfaceTextureCandidate[]{
  const a=p.angleDeg*Math.PI/180,b=textureFaceUvBounds(s,faceId,basis,a,p.offsetX,p.offsetY),pad=p.spacing,ix0=Math.floor((b[0]-pad)/p.spacing),ix1=Math.ceil((b[2]+pad)/p.spacing),iy0=Math.floor((b[1]-pad)/p.spacing),iy1=Math.ceil((b[3]+pad)/p.spacing),out:SurfaceTextureCandidate[]=[];
  textureCheckCandidateCount((ix1-ix0+1)*(iy1-iy0+1));
  for(let iy=iy0;iy<=iy1;iy++){const stagger=(iy&1)?p.spacing*.5:0;for(let ix=ix0;ix<=ix1;ix++){const center:[number,number]=[ix*p.spacing+stagger,iy*p.spacing],circle=textureRegularPolygon(center[0],center[1],p.size*.5,SURFACE_TEXTURE_POLICY.circleSegments);out.push({outline:textureTransformPatternLoop(circle,a,p.offsetX,p.offsetY),family:0});}}
  return out;
}
function textureHexCandidates(s:Solid,faceId:FaceId,basis:PlaneBasis,p:SurfaceTextureParameters):SurfaceTextureCandidate[]{
  const a=p.angleDeg*Math.PI/180,b=textureFaceUvBounds(s,faceId,basis,a,p.offsetX,p.offsetY),pitchX=p.spacing,pitchY=p.spacing*Math.sqrt(3)/2,pad=p.spacing,ix0=Math.floor((b[0]-pad)/pitchX),ix1=Math.ceil((b[2]+pad)/pitchX),iy0=Math.floor((b[1]-pad)/pitchY),iy1=Math.ceil((b[3]+pad)/pitchY),out:SurfaceTextureCandidate[]=[];
  textureCheckCandidateCount((ix1-ix0+1)*(iy1-iy0+1));
  for(let iy=iy0;iy<=iy1;iy++){const stagger=(iy&1)?pitchX*.5:0;for(let ix=ix0;ix<=ix1;ix++){const cx=ix*pitchX+stagger,cy=iy*pitchY,hex=textureRegularPolygon(cx,cy,p.size*.5,SURFACE_TEXTURE_POLICY.hexSegments,Math.PI/6);out.push({outline:textureTransformPatternLoop(hex,a,p.offsetX,p.offsetY),family:0});}}
  return out;
}
// Repeated closed motifs share a square grid anchored in the common pattern
// plane. Their footprint fits inside one size-wide cell, so the existing
// size/spacing contract also keeps concave motifs separated.
function textureMotifOutline(type:SurfaceTextureType,size:number):Vec2[]{
  const radius=size*.5;
  if(type==='pyramids'||type==='beveltiles'||type==='rooftiles')return textureRectangle(0,0,size,size);
  if(type==='squares')return textureRectangle(0,0,size,size);
  if(type==='diamonds')return textureRegularPolygon(0,0,radius,SURFACE_TEXTURE_POLICY.squareSides);
  if(type==='triangles')return textureRegularPolygon(0,0,radius,SURFACE_TEXTURE_POLICY.triangleSides,Math.PI*.5);
  if(type==='stars')return Array.from({length:SURFACE_TEXTURE_POLICY.starPoints*2},(_,i)=>{
    const angle=Math.PI*.5+i*Math.PI/SURFACE_TEXTURE_POLICY.starPoints,r=i%2?radius*SURFACE_TEXTURE_POLICY.starInnerRadiusRatio:radius;
    return [r*Math.cos(angle),r*Math.sin(angle)] as Vec2;
  });
  if(type==='slots'){
    const r=radius*SURFACE_TEXTURE_POLICY.slotWidthRatio,center=radius-r,steps=SURFACE_TEXTURE_POLICY.circleSegments/2,outline:Vec2[]=[];
    for(const side of [-1,1])for(let i=0;i<=steps;i++){
      const angle=(side<0?Math.PI*.5:Math.PI*1.5)+i*Math.PI/steps;
      outline.push([side*center+r*Math.cos(angle),r*Math.sin(angle)]);
    }
    return outline;
  }
  if(type==='chevrons'){
    const h=size*SURFACE_TEXTURE_POLICY.chevronHeightRatio,t=size*SURFACE_TEXTURE_POLICY.chevronThicknessRatio;
    return [[-radius,h*.5],[-radius,h*.5-t],[0,-h*.5],[radius,h*.5-t],[radius,h*.5],[0,-h*.5+t]];
  }
  throw Error('Choose a repeated motif texture.');
}
function textureMotifCandidates(s:Solid,faceId:FaceId,basis:PlaneBasis,p:SurfaceTextureParameters):SurfaceTextureCandidate[]{
  const angle=p.angleDeg*Math.PI/180,b=textureFaceUvBounds(s,faceId,basis,angle,p.offsetX,p.offsetY),pad=p.spacing*SURFACE_TEXTURE_POLICY.motifPaddingCells,
    ix0=Math.floor((b[0]-pad)/p.spacing),ix1=Math.ceil((b[2]+pad)/p.spacing),iy0=Math.floor((b[1]-pad)/p.spacing),iy1=Math.ceil((b[3]+pad)/p.spacing),
    motif=textureMotifOutline(p.type,p.size),relief=textureReliefProfile(p.type,p.size),out:SurfaceTextureCandidate[]=[];
  textureCheckCandidateCount((ix1-ix0+1)*(iy1-iy0+1));
  for(let iy=iy0;iy<=iy1;iy++)for(let ix=ix0;ix<=ix1;ix++){
    const loop=motif.map(q=>[q[0]+ix*p.spacing,q[1]+iy*p.spacing] as Vec2);
    out.push({outline:textureTransformPatternLoop(loop,angle,p.offsetX,p.offsetY),family:0,relief:relief?.map(f=>({points:textureTransformPatternLoop(f.points.map(q=>[q[0]+ix*p.spacing,q[1]+iy*p.spacing]),angle,p.offsetX,p.offsetY) as [Vec2,Vec2,Vec2],heights:f.heights}))});
  }
  return out;
}
function surfaceTextureCandidates(s:Solid,faceId:FaceId,p0:SurfaceTextureParameters,band?:TextureBandContext):{basis:PlaneBasis;candidates:SurfaceTextureCandidate[];parameters:SurfaceTextureParameters}{
  const p=textureValidatedParameters(p0);if(p.band&&!band)band=createTextureBandContext(s,p.boundaryFaceIds||[faceId],p);if(band)return textureBandCandidates(s,faceId,p,band);const face=s.faces.get(faceId);if(!face)throw Error('Select a valid planar face.');const basis=texturePatternBasis(s,faceId,p),patternBasis=p.projection||basis;let candidates:SurfaceTextureCandidate[];
  if(p.projection&&V.dot(face.plane.normal,p.projection.normal)<SURFACE_TEXTURE_POLICY.minimumProjectionCosine)throw Error('This face turns too far from the texture projection. Remove it or start a separate texture area from that side.');
  if(p.type==='lines')candidates=textureLineFamilyCandidates(s,faceId,patternBasis,p,p.angleDeg,0);
  else if(p.type==='crosshatch')candidates=[...textureLineFamilyCandidates(s,faceId,patternBasis,p,p.angleDeg,0),...textureLineFamilyCandidates(s,faceId,patternBasis,p,p.angleDeg+90,1)];
  else if(p.type==='dots')candidates=textureDotCandidates(s,faceId,patternBasis,p);
  else if(p.type==='hex')candidates=textureHexCandidates(s,faceId,patternBasis,p);
  else candidates=textureMotifCandidates(s,faceId,patternBasis,p);
  if(candidates.length>SURFACE_TEXTURE_POLICY.maximumInstances)throw Error(`Texture is too dense (${candidates.length} pattern instances). Increase spacing or choose a smaller face; the limit is ${SURFACE_TEXTURE_POLICY.maximumInstances}.`);
  if(p.projection){const projection=p.projection,den=V.dot(face.plane.normal,projection.normal);candidates=candidates.map(c=>{
    // The same pattern edge must own exactly the same clipping plane on every
    // selected face. Do not recover it from independently rounded face UVs.
    const patternPlanes=c.outline.map((uv,i)=>{const a=fromPlane2(uv,projection),b=fromPlane2(c.outline[(i+1)%c.outline.length],projection),normal=V.unit(V.cross(V.sub(b,a),projection.normal));return {normal,offset:V.dot(normal,a)};});
    const project=(uv:Vec2):Vec2=>{const q=fromPlane2(uv,projection),point=V.add(q,V.mul(projection.normal,(face.plane.offset-V.dot(face.plane.normal,q))/den));return toPlane2(point,basis);};
    return {family:c.family,patternPlanes,outline:c.outline.map(project),relief:c.relief?.map(f=>({points:f.points.map(project) as [Vec2,Vec2,Vec2],heights:f.heights}))};
  });}
  return {basis,candidates,parameters:p};
}
function textureKeepoutPolygons(s:Solid,faceId:FaceId,basis:PlaneBasis,margin:number,boundaryFaceIds?:FaceId[]):{poly:Vec2[];bounds:[number,number,number,number]}[]{
  if(margin<=TOL.minimumEdge)return [];const loops=faceLoopPoints(s,faceId),out:{poly:Vec2[];bounds:[number,number,number,number]}[]=[];
  const face=s.faces.get(faceId)!,selected=new Set(boundaryFaceIds||[]),loopIds=[face.outerLoop,...face.innerLoops];
  for(const [loopIndex,loop3] of [loops.outer,...loops.holes].entries()){
    const loop=loop3.map(p=>toPlane2(p,basis)),edges=loopHalfEdges(s,loopIds[loopIndex]),boundary=edges.map(he=>!selected.has(s.halfEdges.get(he.twin)?.face||''));
    for(let i=0;i<loop.length;i++){if(!boundary[i])continue;const a=loop[i],b=loop[(i+1)%loop.length],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(len<=TOL.minimumEdge)continue;const nx=-dy/len*margin,ny=dx/len*margin,poly:Vec2[]=[[a[0]+nx,a[1]+ny],[b[0]+nx,b[1]+ny],[b[0]-nx,b[1]-ny],[a[0]-nx,a[1]-ny]];if(v2.area(poly)<0)poly.reverse();out.push({poly,bounds:textureBounds2(poly)});}
    for(let i=0;i<loop.length;i++){if(!boundary[i]&&!boundary[(i+loop.length-1)%loop.length])continue;const point=loop[i],poly=textureRegularPolygon(point[0],point[1],margin,SURFACE_TEXTURE_POLICY.circleSegments);if(v2.area(poly)<0)poly.reverse();out.push({poly,bounds:textureBounds2(poly)});}
  }
  return out;
}
function createSurfaceTextureClipContext(s:Solid,faceId:FaceId,basis:PlaneBasis,margin:number,boundaryFaceIds?:FaceId[]):SurfaceTextureClipContext{
  const face=s.faces.get(faceId)!,loops=faceLoopPoints(s,faceId),outer=loops.outer.map(p=>toPlane2(p,basis)),selected=new Set(boundaryFaceIds||[]);
  // A convex face with a complete perimeter has an exact Euclidean inset:
  // intersect its inward edge half-planes shifted by the requested margin.
  // Clip the motif as one boundary, avoiding independently simplified face
  // triangles and keep-out fragments that can invent gaps at near-tangencies.
  // Partial selected perimeters and holes still require the general clipper.
  const completePerimeter=loopHalfEdges(s,face.outerLoop).every(he=>!selected.has(s.halfEdges.get(he.twin)?.face||''));
  if(!loops.holes.length&&polygonIsConvex2(outer)&&(margin<=TOL.minimumEdge||completePerimeter)){
    if(v2.area(outer)<0)outer.reverse();
    return {solid:s,faceId,basis,convexDomain:{outline:outer,margin:margin<=TOL.minimumEdge?0:margin},faceTriangles:[],faceTriangleBounds:[],keepouts:[]};
  }
  const faceTriangles=triangulateFaceLocal(s,faceId).map(t=>{const q=t.map(p=>toPlane2(p,basis));if(v2.area(q)<0)q.reverse();return q;}),faceTriangleBounds=faceTriangles.map(textureBounds2),keepouts=textureKeepoutPolygons(s,faceId,basis,margin,boundaryFaceIds);return {solid:s,faceId,basis,faceTriangles,faceTriangleBounds,keepouts};
}
function textureClipConvexDomain(region:Vec2[],domain:{outline:Vec2[];margin:number}):Vec2[]{
  let clipped=region;
  for(let i=0;i<domain.outline.length&&clipped.length;i++){
    const a=domain.outline[i],b=domain.outline[(i+1)%domain.outline.length],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),nx=-dy/length,ny=dx/length,offset=nx*a[0]+ny*a[1]+domain.margin,next:Vec2[]=[];
    for(let j=0;j<clipped.length;j++){
      const p=clipped[j],q=clipped[(j+1)%clipped.length],dp=nx*p[0]+ny*p[1]-offset,dq=nx*q[0]+ny*q[1]-offset;
      if(dp>=0)next.push(p);
      if((dp<0)!==(dq<0)){const t=dp/(dp-dq);next.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t]);}
    }
    // Retain shared intersections until boundary assembly; removing a short
    // edge here can change which neighboring boundaries coincide.
    clipped=next;
  }
  return clipped;
}
// These polygons are partitions of one footprint, not independent features.
// Preserve intersections and even sub-minimum-area fragments until their
// oriented boundaries have cancelled. Normalizing a fragment here can remove
// a shared edge and invent a crack in an otherwise valid motif.
function textureSplitFragment2(poly:Vec2[],a:Vec2,b:Vec2):{inside:Vec2[];outside:Vec2[]}{
  const inside:Vec2[]=[],outside:Vec2[]=[];
  for(let i=0;i<poly.length;i++){
    const p=poly[i],q=poly[(i+1)%poly.length],dp=v2.cross(a,b,p),dq=v2.cross(a,b,q),pin=dp>=0,qin=dq>=0;
    (pin?inside:outside).push(p);
    if(pin!==qin){const t=dp/(dp-dq),intersection:Vec2=[p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t];inside.push(intersection);outside.push(intersection);}
  }
  return {inside:inside.length>=3?inside:[],outside:outside.length>=3?outside:[]};
}
function textureIntersectFragments2(subject:Vec2[],clip:Vec2[]):Vec2[]{
  let out=subject;if(v2.area(clip)<0)clip=[...clip].reverse();
  for(let i=0;i<clip.length&&out.length;i++)out=textureSplitFragment2(out,clip[i],clip[(i+1)%clip.length]).inside;
  return out;
}
function textureSubtractFragments2(subject:Vec2[],clip:Vec2[]):Vec2[][]{
  if(v2.area(clip)<0)clip=[...clip].reverse();let inside=subject;const out:Vec2[][]=[];
  for(let i=0;i<clip.length&&inside.length;i++){
    const split=textureSplitFragment2(inside,clip[i],clip[(i+1)%clip.length]);if(split.outside.length)out.push(split.outside);inside=split.inside;
  }
  return out;
}
function textureClipCandidate(ctx:SurfaceTextureClipContext,regionInput:Vec2[]):{outer:Vec2[];holes:Vec2[][]}[]{
  let region=normalizeLoop2(regionInput);if(polygonSelfIntersects(region))return [];if(v2.area(region)<0)region.reverse();
  if(ctx.convexDomain){
    const clipped=textureClipConvexDomain(region,ctx.convexDomain);if(clipped.length<3||Math.abs(v2.area(clipped))<=TOL.minimumFaceArea)return [];
    // A concave motif can clip into multiple pieces. Opposite bridge segments
    // on the clip plane cancel in the existing oriented boundary assembler.
    const plane=ctx.solid.faces.get(ctx.faceId)!.plane,loops=boundaryLoopsFromPolygons([clipped.map(p=>fromPlane2(p,ctx.basis))],plane);
    return classifyPlaneLoops(loops,plane).map(c=>({outer:c.outer.map(p=>toPlane2(p,ctx.basis)),holes:c.holes.map(h=>h.map(p=>toPlane2(p,ctx.basis)))}));
  }
  const tris=triangulateSimple2(region).map(t=>{const q=[region[t[0]],region[t[1]],region[t[2]]] as Vec2[];if(v2.area(q)<0)q.reverse();return q;}),fragments:Vec2[][]=[];
  for(const tri of tris){const tb=textureBounds2(tri);for(let j=0;j<ctx.faceTriangles.length;j++){if(!textureBoundsOverlap(tb,ctx.faceTriangleBounds[j]))continue;const x=textureIntersectFragments2(tri,ctx.faceTriangles[j]);if(x.length>=3)fragments.push(x);}}
  if(!fragments.length)return [];let kept=fragments;
  if(ctx.keepouts.length){for(const k of ctx.keepouts){const next:Vec2[][]=[];for(const frag of kept){if(!textureBoundsOverlap(textureBounds2(frag),k.bounds)){next.push(frag);continue;}next.push(...textureSubtractFragments2(frag,k.poly));}kept=next;if(!kept.length)return [];}}
  // Remove redundant points only after assembly, using the existing B-rep
  // collinearity policy. Sweeping rounded subdivisions of the same straight
  // boundary otherwise introduces needless, numerically noisy side planes.
  const face=ctx.solid.faces.get(ctx.faceId)!,loops3=boundaryLoopsFromPolygons(kept.map(poly=>poly.map(p=>fromPlane2(p,ctx.basis))),face.plane).map(simplifyCollinearLoop3);
  if(!loops3.length)return [];const classified=classifyPlaneLoops(loops3,face.plane);
  return classified.map(c=>({outer:c.outer.map(p=>toPlane2(p,ctx.basis)),holes:c.holes.map(h=>h.map(p=>toPlane2(p,ctx.basis)))})).filter(c=>Math.abs(v2.area(c.outer))-c.holes.reduce((area,h)=>area+Math.abs(v2.area(h)),0)>TOL.minimumFaceArea);
}
function surfaceTextureLayoutInternal(s:Solid,faceId:FaceId,input:SurfaceTextureParameters,allowEmpty=false,previewBudget:{outlines:number;reliefLines:number}={outlines:SURFACE_TEXTURE_POLICY.previewOutlines,reliefLines:SURFACE_TEXTURE_POLICY.previewReliefLines},band?:TextureBandContext):SurfaceTextureLayoutInternal{
  if(input.band&&!band)band=createTextureBandContext(s,input.boundaryFaceIds||[faceId],textureValidatedParameters(input));
  const {basis,candidates,parameters}=surfaceTextureCandidates(s,faceId,input,band),ctx=createSurfaceTextureClipContext(s,faceId,basis,parameters.margin,parameters.boundaryFaceIds),byFamily=new Map<number,SurfaceTextureRegion[]>(),outlines:Vec2[][]=[],reliefLines:Vec3[][]=[];let components=0,estimatedFaces=0,previewTruncated=false;
  for(const candidate of candidates){
    let clipped=textureClipCandidate(ctx,candidate.outline);if(band){const field=band.fields.get(faceId)!;clipped=clipped.map(c=>({outer:textureBandSnapLoop(c.outer,field),holes:c.holes.map(h=>textureBandSnapLoop(h,field))})).filter(c=>c.outer.length>=3);}if(!clipped.length)continue;
    if(!byFamily.has(candidate.family))byFamily.set(candidate.family,[]);
    const regions=clipped.map(c=>({...c,outer:candidate.relief?normalizeLoop2(c.outer):c.outer,holes:candidate.relief?c.holes.map(normalizeLoop2):c.holes,patternPlanes:candidate.patternPlanes,relief:candidate.relief,fullOutline:candidate.outline}));byFamily.get(candidate.family)!.push(...regions);components+=regions.length;
    for(const c of regions){
      const perimeterPoints=c.outer.length+c.holes.reduce((a,h)=>a+h.length,0);
      estimatedFaces+=c.relief?c.relief.length*2+perimeterPoints*2:2+perimeterPoints;
      for(const loop of [c.outer,...c.holes]){if(previewBudget.outlines>0){outlines.push(loop);previewBudget.outlines--;}else previewTruncated=true;}
      if(c.relief){
        if(previewBudget.reliefLines<=0){previewTruncated=true;continue;}
        const direction=parameters.projection?.normal||basis.normal,sign=parameters.operation==='add'?1:-1;
        for(const {outline,facet} of textureReliefFragments(c)){
          if(previewBudget.reliefLines<=0){previewTruncated=true;break;}
          reliefLines.push(outline.map(uv=>V.add(fromPlane2(uv,basis),V.mul(direction,sign*parameters.depth*textureReliefHeight(facet,uv)))));previewBudget.reliefLines--;
        }
      }
    }
  }
  if(!components&&!allowEmpty)throw Error(parameters.margin>0?'No texture remains inside the selected face after applying the edge margin.':'The texture does not intersect the selected face.');
  if(components>SURFACE_TEXTURE_POLICY.maximumComponents||estimatedFaces>SURFACE_TEXTURE_POLICY.maximumEstimatedFaces)throw Error('Texture creates too much geometry. Increase spacing or select a smaller area.');
  const score=Math.max(candidates.length,components,estimatedFaces/10),complexity:SurfaceTextureLayoutInternal['complexity']=score<=90?'Low':score<=230?'Medium':'High';
  return {basis,byFamily,outlines,reliefLines,previewTruncated,instances:candidates.length,components,estimatedFaces,complexity,band:band?.fields.get(faceId)};
}
function textureComponentCsg(component:SurfaceTextureRegion,basis:PlaneBasis,z0:number,z1:number,direction:Vec3=basis.normal,parameters?:SurfaceTextureParameters):CSGPolygon[]{
  if(component.relief){if(!parameters)throw Error('Relief construction requires texture parameters.');return textureReliefCsg(component,basis,z0,z1,direction,parameters);}
  const height=z1-z0;if(height<=TOL.minimumEdge)throw Error('Texture feature height is too small.');const prism=prismRegion(component.outer,component.holes,height);
  return solidToCsg(prism).map(poly=>{
    const out=csgPolygon(poly.vs.map(p=>V.add(fromPlane2([p[0],p[1]],basis),V.mul(direction,z0+p[2]))),poly);
    // Carry the prism's construction plane through the affine sweep. Recovering
    // it from three transformed points is unstable for thin clipped fragments.
    // Cofactor columns transform normals even when the sweep is oblique.
    const sourceNormal=poly.plane.normal,normal=V.unit(V.add(V.add(V.mul(V.cross(basis.v,direction),sourceNormal[0]),V.mul(V.cross(direction,basis.u),sourceNormal[1])),V.mul(V.cross(basis.u,basis.v),sourceNormal[2]))),
      sourcePoint=V.mul(sourceNormal,poly.plane.offset),point=V.add(fromPlane2([sourcePoint[0],sourcePoint[1]],basis),V.mul(direction,z0+sourcePoint[2]));
    out.plane={normal,offset:V.dot(normal,point)};
    if(component.patternPlanes){
      if(Math.abs(poly.plane.normal[2])>1-TOL.coplanarAngle){const sign=Math.sign(poly.plane.normal[2]),normal=V.mul(basis.normal,sign),point=V.add(basis.origin,V.mul(direction,sign>0?z1:z0));out.plane={normal,offset:V.dot(normal,point)};}
      else{const plane=component.patternPlanes.find(p=>V.dot(p.normal,out.plane.normal)>1-TOL.coplanarAngle&&out.vs.every(v=>Math.abs(V.dot(p.normal,v)-p.offset)<=TOL.plane));if(plane)out.plane=plane;}
    }
    return out;
  });
}
function applySurfaceTextureSolid(s:Solid,faceId:FaceId,input:SurfaceTextureParameters):Omit<SurfaceTextureResult,'topology'>{
  return applySurfaceTextureFacesSolid(s,[faceId],input);
}
function surfaceTexturePatchLayouts(s:Solid,faceIds:readonly FaceId[],input:SurfaceTextureParameters,includePreview=true,diagnostic?:ModelingDiagnosticReporter):{parameters:SurfaceTextureParameters;faces:{faceId:FaceId;layout:SurfaceTextureLayoutInternal}[];instances:number;components:number;estimatedFaces:number;band?:SurfaceTexturePatchPreview['band']}{
  const ids=[...new Set(faceIds)];if(!ids.length)throw Error('Select at least one texture face.');
  if(ids.length>SURFACE_TEXTURE_POLICY.maximumSelectedFaces)throw Error(`Select no more than ${SURFACE_TEXTURE_POLICY.maximumSelectedFaces} texture faces at a time.`);
  for(const id of ids)if(!s.faces.has(id))throw Error('A selected texture face no longer exists.');
  const parameters=textureValidatedParameters({...input,boundaryFaceIds:ids}),faces:{faceId:FaceId;layout:SurfaceTextureLayoutInternal}[]=[];let instances=0,components=0,estimatedFaces=0;
  const band=parameters.band?createTextureBandContext(s,ids,parameters):undefined;
  if(band)diagnostic?.('texture','band-mapping',{axis:parameters.band!.axis,repeats:parameters.band!.repeats,center:band.center,period:band.period,spacingAround:band.pitch,rows:parameters.band!.rows??TEXTURE_BAND_POLICY.defaultRows,middleHeight:band.middleHeight,referenceRadius:band.period/(2*Math.PI),originHeight:band.originHeight,originAngle:band.originAngle,policy:TEXTURE_BAND_POLICY});
  const previewBudget={outlines:includePreview?SURFACE_TEXTURE_POLICY.previewOutlines:0,reliefLines:includePreview?SURFACE_TEXTURE_POLICY.previewReliefLines:0};
  // All layouts are derived from the same source B-rep before any Boolean work.
  // Shared selected edges are not perimeter margins; actual holes remain clipped.
  for(const faceId of ids){diagnostic?.('texture','face-layout-start',{faceId});const layout=surfaceTextureLayoutInternal(s,faceId,parameters,true,previewBudget,band);instances+=layout.instances;components+=layout.components;estimatedFaces+=layout.estimatedFaces;
    diagnostic?.('texture','face-layout-complete',{faceId,basis:layout.basis,instances:layout.instances,components:layout.components,estimatedFaces:layout.estimatedFaces,complexity:layout.complexity,families:[...layout.byFamily].map(([family,regions])=>({family,regions:regions.length}))});
    if(instances>SURFACE_TEXTURE_POLICY.maximumInstances||components>SURFACE_TEXTURE_POLICY.maximumComponents||estimatedFaces>SURFACE_TEXTURE_POLICY.maximumEstimatedFaces)throw Error('The selected texture area is too dense. Increase spacing or select fewer faces.');faces.push({faceId,layout});}
  if(!components)throw Error('No texture remains inside the selected area. Reduce the edge margin or adjust the pattern offset.');
  return {parameters,faces,instances,components,estimatedFaces,band:band?{spacingAround:band.pitch,rows:parameters.band?.rows??TEXTURE_BAND_POLICY.defaultRows,referenceRadius:band.period/(2*Math.PI)}:undefined};
}
function applySurfaceTextureFacesSolid(s:Solid,faceIds:readonly FaceId[],input:SurfaceTextureParameters,onProgress?:(update:ModelingProgressUpdate)=>void,onDiagnostic?:(event:ModelingDiagnosticEvent)=>void):Omit<SurfaceTextureResult,'topology'>{
  const started=profilerClock(),diagnostic:ModelingDiagnosticReporter=(category,event,data={})=>onDiagnostic?.({category,event,elapsedMs:profilerClock()-started,data});
  diagnostic('texture','start',{faceIds:[...faceIds],parameters:input,source:{vertices:s.vertices.size,halfEdges:s.halfEdges.size,loops:s.loops.size,faces:s.faces.size},faceOrder:[...s.faces.keys()],policy:SURFACE_TEXTURE_POLICY,tolerances:TOL});
  onProgress?.({progress:SURFACE_TEXTURE_POLICY.progressLayout,message:'Clipping texture patterns…'});
  const patch=surfaceTexturePatchLayouts(s,faceIds,input,false,diagnostic),p=patch.parameters,overlap=Math.max(TOL.snapGeometry*SURFACE_TEXTURE_POLICY.cutterOverlapToleranceFactor,Math.min(SURFACE_TEXTURE_POLICY.maximumCutterOverlap,p.depth*SURFACE_TEXTURE_POLICY.cutterOverlapDepthFactor)),z0=p.operation==='add'?-overlap:-p.depth,z1=p.operation==='add'?p.depth:overlap;
  diagnostic('texture','layout-complete',{parameters:p,instances:patch.instances,components:patch.components,estimatedFaces:patch.estimatedFaces,overlap,z0,z1});
  // The requested volume is the union of all face/family cutters. Merge that
  // volume before modifying the source, so internal selected seams disappear.
  let combined:CSGPolygon[]=[];let processed=0;
  onProgress?.({progress:SURFACE_TEXTURE_POLICY.progressBuildStart,message:'Building texture details…'});
  if(p.band){const out=applyTextureBandPatch(s,patch,diagnostic,onProgress);diagnostic('texture','complete',{durationMs:profilerClock()-started,instances:patch.instances,components:patch.components,result:{vertices:out.vertices.size,halfEdges:out.halfEdges.size,loops:out.loops.size,faces:out.faces.size}});onProgress?.({progress:100,message:'Texture geometry complete.'});return {solid:out,instances:patch.instances,components:patch.components};}
  let base=solidToCsg(s);diagnostic('csg','source-polygons',{count:base.length});
  for(const {faceId,layout} of patch.faces){
    onProgress?.({progress:SURFACE_TEXTURE_POLICY.progressBuildStart+SURFACE_TEXTURE_POLICY.progressBuildSpan*processed++/patch.faces.length,message:`Building texture face ${processed} of ${patch.faces.length}…`});
    for(const family of [...layout.byFamily.keys()].sort()){
      const tool:CSGPolygon[]=[];for(const component of layout.byFamily.get(family)||[])tool.push(...textureComponentCsg(component,layout.basis,z0,z1,p.projection?.normal,p));
      diagnostic('texture','cutter-built',{faceId,family,regions:layout.byFamily.get(family)?.length||0,polygons:tool.length});
      if(tool.length)combined=combined.length?csgUnionOwned(combined,tool):tool;
      diagnostic('csg','tool-merge-complete',{faceId,family,polygons:combined.length});
    }
  }
  onProgress?.({progress:SURFACE_TEXTURE_POLICY.progressBoolean,message:'Combining texture with the object…'});
  const booleanStarted=profilerClock(),sourcePolygons=base.length,toolPolygons=combined.length;
  base=p.operation==='add'?csgUnionOwned(base,combined):csgSubtractOwned(base,combined);
  diagnostic('csg','boolean-complete',{operation:p.operation,sourcePolygons,toolPolygons,resultPolygons:base.length,durationMs:profilerClock()-booleanStarted});
  if(!base.length)throw Error('Surface Texture removed the entire object.');
  onProgress?.({progress:SURFACE_TEXTURE_POLICY.progressValidation,message:'Validating textured geometry…'});
  const out=csgToSolid(base,s.id,{kind:'boolean',label:`Surface texture ${p.type}`},false,diagnostic);
  diagnostic('texture','complete',{durationMs:profilerClock()-started,instances:patch.instances,components:patch.components,result:{vertices:out.vertices.size,halfEdges:out.halfEdges.size,loops:out.loops.size,faces:out.faces.size}});
  onProgress?.({progress:100,message:'Texture geometry complete.'});return {solid:out,instances:patch.instances,components:patch.components};
}
function previewSurfaceTexture(s:Solid,faceId:FaceId,input:SurfaceTextureParameters):SurfaceTexturePreview{
  const layout=surfaceTextureLayoutInternal(s,faceId,input);return {basis:layout.basis,outlines:layout.outlines,reliefLines:layout.reliefLines,previewTruncated:layout.previewTruncated,instances:layout.instances,components:layout.components,estimatedFaces:layout.estimatedFaces,complexity:layout.complexity};
}
function previewSurfaceTextureFaces(s:Solid,faceIds:readonly FaceId[],input:SurfaceTextureParameters):SurfaceTexturePatchPreview{
  const patch=surfaceTexturePatchLayouts(s,faceIds,input),faces=patch.faces.map(({faceId,layout})=>({faceId,preview:{basis:layout.basis,outlines:layout.outlines,reliefLines:layout.reliefLines,previewTruncated:layout.previewTruncated,instances:layout.instances,components:layout.components,estimatedFaces:layout.estimatedFaces,complexity:layout.complexity}}));
  const complexity=faces.some(f=>f.preview.complexity==='High')?'High':faces.some(f=>f.preview.complexity==='Medium')?'Medium':'Low';return {faces,instances:patch.instances,components:patch.components,estimatedFaces:patch.estimatedFaces,complexity,band:patch.band};
}
