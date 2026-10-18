// Isometric unfolding of a straight, convex cylindrical B-rep side shell.
// Horizontal millimetres follow the actual facet perimeter, not a projected
// chord or an ideal angular radius. Periodic copies meet at the same seam.
const CYLINDER_TEXT_POLICY=Object.freeze({
  minimumPanels:6,maximumFaces:1000,axisCosineTolerance:1e-6,
  relativeRadiusTolerance:1e-5,maximumPanelAngle:Math.PI/2,
  maximumClipComparisons:500000,maximumClippedVertices:24000,
  relativeAreaTolerance:1e-8,maximumGeneratedFaces:60000,
  maximumInwardRadiusRatio:.45,
  // Clip fragments are not model faces. Keep microscopic ears until their
  // oriented union is assembled, so a seam is identical from either side.
  minimumFragmentArea:1e-14,
});
interface CylinderTextPanel {start:Vec2;end:Vec2;tangent:Vec2;length:number;offset:number;normal:Vec3;left:Vec3;right:Vec3;}
interface CylinderTextField {faceId:FaceId;basis:PlaneBasis;panel:CylinderTextPanel;}
interface CylinderTextContext {
  axis:Vec3;u:Vec3;v:Vec3;period:number;radius:number;originX:number;originHeight:number;
  faceIds:FaceId[];fields:Map<FaceId,CylinderTextField>;
}
interface CylinderTextPatch extends CurvedTextPatch {context:CylinderTextContext;}

function cylinderTextHull(points:Vec2[]):Vec2[] {
  const unique=new Map<string,Vec2>();for(const p of points)unique.set(p.map(q=>Math.round(q/TOL.topologyKey)).join(','),p);
  const sorted=[...unique.values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]),chain=(row:Vec2[])=>{
    const out:Vec2[]=[];for(const p of row){while(out.length>=2&&v2.cross(out.at(-2)!,out.at(-1)!,p)<=TOL.minimumFaceArea)out.pop();out.push(p);}return out;
  };
  const lower=chain(sorted),upper=chain([...sorted].reverse());return [...lower.slice(0,-1),...upper.slice(0,-1)];
}
function cylinderTextContext(s:Solid,seed:FaceId,axisName:TextureBandAxis,anchor:Vec3):CylinderTextContext {
  const axis:Vec3=axisName==='x'?[1,0,0]:axisName==='y'?[0,1,0]:[0,0,1],u:Vec3=axisName==='x'?[0,1,0]:axisName==='y'?[0,0,1]:[1,0,0],v=V.cross(axis,u);
  const side=(id:FaceId)=>Math.abs(V.dot(s.faces.get(id)!.plane.normal,axis))<=CYLINDER_TEXT_POLICY.axisCosineTolerance;
  if(!side(seed))throw Error('Choose a cylinder side face and its object axis; caps and tapered sides use local surface text.');
  const ids=[seed],seen=new Set(ids);
  for(let i=0;i<ids.length;i++)for(const lid of [s.faces.get(ids[i])!.outerLoop,...s.faces.get(ids[i])!.innerLoops])for(const edge of loopHalfEdges(s,lid)){
    const next=s.halfEdges.get(edge.twin)!.face;if(seen.has(next)||!side(next))continue;seen.add(next);ids.push(next);
    if(ids.length>CYLINDER_TEXT_POLICY.maximumFaces)throw Error('Cylinder text exceeds the side-face budget. Use a simpler cylinder.');
  }
  const projected=(q:Vec3):Vec2=>[V.dot(q,u),V.dot(q,v)],points=ids.flatMap(id=>[faceLoopPoints(s,id).outer,...faceLoopPoints(s,id).holes].flat()),hull=cylinderTextHull(points.map(projected));
  if(hull.length<CYLINDER_TEXT_POLICY.minimumPanels)throw Error('Wrap around cylinder requires a complete round side shell with at least six facets.');
  const a=hull[0],b=hull[Math.floor(hull.length/3)],c=hull[Math.floor(hull.length*2/3)],bx=b[0]-a[0],by=b[1]-a[1],cx=c[0]-a[0],cy=c[1]-a[1],det=2*(bx*cy-by*cx);
  if(Math.abs(det)<=TOL.minimumFaceArea)throw Error('Could not determine the cylinder radius.');
  const center:Vec2=[a[0]+((bx*bx+by*by)*cy-(cx*cx+cy*cy)*by)/det,a[1]+(bx*(cx*cx+cy*cy)-cx*(bx*bx+by*by))/det],radius=v2.dist(a,center),tolerance=Math.max(TOL.plane,radius*CYLINDER_TEXT_POLICY.relativeRadiusTolerance);
  if(radius<=TEXTURE_BAND_POLICY.minimumRadius||hull.some(p=>Math.abs(v2.dist(p,center)-radius)>tolerance))throw Error('Wrap around cylinder requires a constant-radius round cross-section. Use local surface text for other shapes.');
  let period=0;
  const panels:CylinderTextPanel[]=hull.map((start,i)=>{
    const end=hull[(i+1)%hull.length],length=v2.dist(start,end),tangent:Vec2=[(end[0]-start[0])/length,(end[1]-start[1])/length],normal=V.sub(V.mul(u,tangent[1]),V.mul(v,tangent[0]));
    if(length>2*radius*Math.sin(CYLINDER_TEXT_POLICY.maximumPanelAngle/2)+tolerance)throw Error('The cylinder side shell has an unsupported sharp turn.');
    const panel={start,end,tangent,length,offset:period,normal,left:[0,0,0] as Vec3,right:[0,0,0] as Vec3};period+=length;return panel;
  });
  panels.forEach((p,i)=>{p.left=textureBandMiter([panels[(i+panels.length-1)%panels.length].normal,p.normal]);p.right=textureBandMiter([p.normal,panels[(i+1)%panels.length].normal]);});
  const fields=new Map<FaceId,CylinderTextField>();
  for(const id of ids){const face=s.faces.get(id)!,loop=faceLoopPoints(s,id).outer.map(projected),panel=panels.find(p=>V.dot(p.normal,face.plane.normal)>1-CYLINDER_TEXT_POLICY.axisCosineTolerance&&loop.every(q=>pointOnSegment2(q,p.start,p.end,tolerance)));
    if(!panel)throw Error('The chosen shell is not one complete cylindrical side surface.');fields.set(id,{faceId:id,basis:textFaceFrame(s,id),panel});
  }
  if(panels.some(p=>![...fields.values()].some(f=>f.panel===p)))throw Error('The cylinder side shell does not close around a full turn.');
  const seedPanel=fields.get(seed)!.panel,q=projected(anchor),originX=seedPanel.offset+(q[0]-seedPanel.start[0])*seedPanel.tangent[0]+(q[1]-seedPanel.start[1])*seedPanel.tangent[1];
  return {axis,u,v,period,radius,originX,originHeight:V.dot(anchor,axis),faceIds:ids,fields};
}
function cylinderTextChartPoint(q:Vec3,field:CylinderTextField,ctx:CylinderTextContext):Vec2 {
  const p=field.panel;return [p.offset-ctx.originX+(V.dot(q,ctx.u)-p.start[0])*p.tangent[0]+(V.dot(q,ctx.v)-p.start[1])*p.tangent[1],V.dot(q,ctx.axis)-ctx.originHeight];
}
function cylinderTextSurfacePoint(uv:Vec2,field:CylinderTextField,ctx:CylinderTextContext,depth=0):Vec3 {
  const p=field.panel,t=uv[0]+ctx.originX-p.offset,base=V.add(V.add(V.mul(ctx.u,p.start[0]+t*p.tangent[0]),V.mul(ctx.v,p.start[1]+t*p.tangent[1])),V.mul(ctx.axis,uv[1]+ctx.originHeight));
  return V.add(base,V.mul(V.lerp(p.left,p.right,t/p.length),depth));
}
function cylinderTextPointOffset(uv:Vec2,field:CylinderTextField,ctx:CylinderTextContext,depth:number):Vec3 {
  return cylinderTextSurfacePoint(cylinderTextChartPoint(fromPlane2(uv,field.basis),field,ctx),field,ctx,depth);
}
function cylinderTextPatch(s:Solid,layout:FaceTextLayout,context:CylinderTextContext):CylinderTextPatch {
  const patch:CylinderTextPatch={context,faceIds:context.faceIds,faces:[],center:[0,0,0],placement:{ok:true}},uvPlane:Plane={normal:[0,0,1],offset:0};
  const glyphTriangles=layout.regions.flatMap(region=>{const mesh=triangulatePolygonWithHoles2(region.outer,region.holes);return mesh.triangles.map(t=>t.map(i=>mesh.points[i]));});
  const allBounds=textureBounds2(layout.regions.flatMap(r=>[r.outer,...r.holes].flat()));
  if(allBounds[2]-allBounds[0]>context.period-2*TEXT_POLICY.minimumBoundaryClearance)throw Error('Text overlaps itself around the cylinder seam. Reduce capital height or use shorter lines.');
  const shift=context.period*Math.round((allBounds[0]+allBounds[2])*.5/context.period);
  let comparisons=0,covered=0,vertices=0;
  for(const field of context.fields.values()){
    const face=s.faces.get(field.faceId)!,fragments:Vec3[][]=[];
    for(const triangle of triangulateFaceLocal(s,field.faceId,undefined,'canonical')){
      const outline=triangle.map(q=>cylinderTextChartPoint(q,field,context)),bounds=textureBounds2(outline);
      for(const glyph of glyphTriangles){const base=glyph.map(q=>[q[0]-shift,q[1]] as Vec2),b=textureBounds2(base),first=Math.ceil((bounds[0]-b[2])/context.period),last=Math.floor((bounds[2]-b[0])/context.period);
        if(b[3]<bounds[1]||b[1]>bounds[3])continue;
        for(let copy=first;copy<=last;copy++){
          if(++comparisons>CYLINDER_TEXT_POLICY.maximumClipComparisons)throw Error('Cylinder text exceeds its clipping budget. Use shorter text or a simpler cylinder.');
          const clipped=textureIntersectFragments2(base.map(q=>[q[0]+copy*context.period,q[1]] as Vec2),outline);
          if(clipped.length>=3&&Math.abs(v2.area(clipped))>CYLINDER_TEXT_POLICY.minimumFragmentArea){covered+=Math.abs(v2.area(clipped));fragments.push(clipped.map(q=>[q[0],q[1],0] as Vec3));}
        }
      }
    }
    if(!fragments.length)continue;
    const regions=classifyPlaneLoops(boundaryLoopsFromPolygons(fragments,uvPlane),uvPlane).map(r=>({outer:r.outer.map(q=>toPlane2(cylinderTextSurfacePoint([q[0],q[1]],field,context),field.basis)),holes:r.holes.map(h=>h.map(q=>toPlane2(cylinderTextSurfacePoint([q[0],q[1]],field,context),field.basis)))}));
    const physical=[face.outerLoop,...face.innerLoops].flatMap(lid=>loopHalfEdges(s,lid)).filter(e=>!context.fields.has(s.halfEdges.get(e.twin)!.face));
    for(const region of regions)for(const loop of [region.outer,...region.holes])for(let i=0;i<loop.length;i++)for(const edge of physical){
      const a=toPlane2(s.vertices.get(edge.origin)!.position,field.basis),b=toPlane2(s.vertices.get(s.halfEdges.get(edge.next)!.origin)!.position,field.basis),q=loop[i],r=loop[(i+1)%loop.length],distance=(p:Vec2,c:Vec2,d:Vec2)=>{const dx=d[0]-c[0],dy=d[1]-c[1],t=clamp(((p[0]-c[0])*dx+(p[1]-c[1])*dy)/(dx*dx+dy*dy),0,1);return v2.dist(p,[c[0]+t*dx,c[1]+t*dy]);};
      if(segmentIntersection2(q,r,a,b)||Math.min(distance(q,a,b),distance(r,a,b),distance(a,q,r),distance(b,q,r))<TEXT_POLICY.minimumBoundaryClearance)patch.placement={ok:false,message:'Cylinder text must stay clear of caps, openings and the side-area boundary. Move it or reduce capital height.'};
    }
    vertices+=regions.reduce((n,r)=>n+r.outer.length+r.holes.reduce((m,h)=>m+h.length,0),0);
    if(vertices>CYLINDER_TEXT_POLICY.maximumClippedVertices)throw Error('Cylinder text creates too many points. Use shorter text or a simpler cylinder.');
    patch.faces.push({faceId:field.faceId,basis:field.basis,regions});
  }
  if(!patch.faces.length||Math.abs(covered-layout.area)>Math.max(TOL.minimumFaceArea,layout.area*CYLINDER_TEXT_POLICY.relativeAreaTolerance))patch.placement={ok:false,message:'Cylinder text must fit on the complete side area, clear of caps and openings. Move it or reduce capital height.'};
  const centerX=allBounds[0]+(allBounds[2]-allBounds[0])*.5-shift,wrapped=((centerX+context.originX)%context.period+context.period)%context.period,field=[...context.fields.values()].find(f=>wrapped>=f.panel.offset&&wrapped<=f.panel.offset+f.panel.length)||context.fields.values().next().value!;
  patch.center=cylinderTextSurfacePoint([wrapped-context.originX,(allBounds[1]+allBounds[3])*.5],field,context);
  return patch;
}
function cylinderTextFeatureFaces(s:Solid,layout:FaceTextLayout,depth:number):PolyFaceInput[] {
  const patch=layout.cylinder!,out:PolyFaceInput[]=[],selected=new Set(patch.faceIds);
  if(depth<0&&Math.abs(depth)>=patch.context.radius*CYLINDER_TEXT_POLICY.maximumInwardRadiusRatio)throw Error('Cylinder text depth is too large for this radius. Reduce depth.');
  for(const face of patch.faces){const field=patch.context.fields.get(face.faceId)!,source=s.faces.get(face.faceId)!,edges=[source.outerLoop,...source.innerLoops].flatMap(lid=>loopHalfEdges(s,lid)).filter(e=>selected.has(s.halfEdges.get(e.twin)!.face)),point=(q:Vec2,z:number)=>cylinderTextPointOffset(q,field,patch.context,z),push=(points:Vec3[],planeHint?:Plane)=>{out.push({points,planeHint,provenance:{kind:'boolean',label:'Cylinder Text'}});if(out.length>CYLINDER_TEXT_POLICY.maximumGeneratedFaces)throw Error('Cylinder text exceeds the generated-face budget.');};
    for(const region of face.regions){const mesh=triangulatePolygonWithHoles2(region.outer,region.holes),cap={normal:source.plane.normal,offset:source.plane.offset+depth};
      for(const t of mesh.triangles)push(t.map(i=>point(mesh.points[i],depth)),cap);
      for(const loop of [region.outer,...region.holes])for(let i=0;i<loop.length;i++){
        const a=loop[i],b=loop[(i+1)%loop.length];
        if(edges.some(e=>{const c=toPlane2(s.vertices.get(e.origin)!.position,face.basis),d=toPlane2(s.vertices.get(s.halfEdges.get(e.next)!.origin)!.position,face.basis);return pointOnSegment2(a,c,d,TOL.topologyKey)&&pointOnSegment2(b,c,d,TOL.topologyKey);}))continue;
        const points=[point(a,0),point(b,0),point(b,depth),point(a,depth)],plane=planeFromPoints(points);
        if(points.every(q=>Math.abs(V.dot(plane.normal,q)-plane.offset)<=TOL.plane))push(points,plane);else{push(points.slice(0,3));push([points[0],points[2],points[3]]);}
      }
    }
  }
  return out;
}
function applyCylinderTextPatch(s:Solid,layout:FaceTextLayout,p:FaceTextParameters,onProgress?:(update:ModelingProgressUpdate)=>void):Solid {
  const depth=p.depth*(p.operation==='add'?1:-1),features=cylinderTextFeatureFaces(s,layout,depth);
  return applyTextSurfaceSkin(s,layout.cylinder!,features,depth,'Cylinder Text',onProgress);
}
