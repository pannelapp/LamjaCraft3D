// A local surface chart projects lettering along the placement normal onto a
// connected front-facing B-rep patch. Translating every footprint by the same
// depth vector preserves source curvature and exactly coincident facet seams.
// This is a local projected inscription, not a cylindrical arc-length unwrap.
const CURVED_TEXT_POLICY=Object.freeze({
  minimumProjectionCosine:.35,minimumNeighborCosine:.7,maximumPatchFaces:1000,
  maximumClipComparisons:500000,maximumClippedVertices:24000,
});
interface CurvedTextFace {faceId:FaceId;basis:PlaneBasis;regions:FaceTextRegion[];}
interface CurvedTextPatch {faceIds:FaceId[];faces:CurvedTextFace[];center:Vec3;placement:FaceTextPlacementCheck;}
function curvedTextSurfacePoint(uv:Vec2,plane:Plane,basis:PlaneBasis):Vec3 {
  const p=fromPlane2(uv,basis);
  return V.add(p,V.mul(basis.normal,(plane.offset-V.dot(plane.normal,p))/V.dot(plane.normal,basis.normal)));
}
function curvedTextPatch(s:Solid,seed:FaceId,layout:FaceTextLayout,center:Vec2):CurvedTextPatch {
  const selected=new Set<FaceId>([seed]),queue=[seed],basis=layout.basis;
  for(let index=0;index<queue.length;index++){
    const face=s.faces.get(queue[index])!;
    for(const lid of [face.outerLoop,...face.innerLoops])for(const edge of loopHalfEdges(s,lid)){
      const id=s.halfEdges.get(edge.twin)?.face;if(!id||selected.has(id))continue;
      const next=s.faces.get(id)!;
      if(V.dot(next.plane.normal,basis.normal)<CURVED_TEXT_POLICY.minimumProjectionCosine||V.dot(next.plane.normal,face.plane.normal)<CURVED_TEXT_POLICY.minimumNeighborCosine)continue;
      selected.add(id);queue.push(id);
      if(queue.length>CURVED_TEXT_POLICY.maximumPatchFaces)throw Error(`Curved Text supports at most ${CURVED_TEXT_POLICY.maximumPatchFaces} connected surface faces. Use a simpler object.`);
    }
  }
  const project=(point:Vec3)=>fromPlane2(toPlane2(point,basis),basis),boundaries:Vec3[][]=[];
  for(const id of queue){const loops=faceLoopPoints(s,id);boundaries.push(...[loops.outer,...loops.holes].map(loop=>loop.map(project)));}
  const domains=classifyPlaneLoops(boundaryLoopsFromPolygons(boundaries,s.faces.get(seed)!.plane).map(simplifyCollinearLoop3),s.faces.get(seed)!.plane)
    .map(region=>({outer:region.outer.map(p=>toPlane2(p,basis)),holes:region.holes.map(h=>h.map(p=>toPlane2(p,basis)))}));
  if(domains.some(r=>[r.outer,...r.holes].some(polygonSelfIntersects)))throw Error('The surface overlaps in the text projection. Choose a different placement face.');
  const placement=domains.map(r=>checkTextDomain(layout,r.outer,r.holes)).find(check=>check.ok)||{ok:false as const,message:'Text must fit on the connected curved area, clear of openings and sharp turns. Move it or reduce the capital height.'};
  const centerFace=queue.find(id=>{const loops=faceLoopPoints(s,id);return pointInPolygon2(center,loops.outer.map(p=>toPlane2(p,basis)))&&!loops.holes.some(h=>pointInPolygon2(center,h.map(p=>toPlane2(p,basis))));});
  const patch:CurvedTextPatch={faceIds:queue,faces:[],center:centerFace?curvedTextSurfacePoint(center,s.faces.get(centerFace)!.plane,basis):fromPlane2(center,basis),placement};if(!placement.ok)return patch;
  const glyphTriangles=layout.regions.flatMap(region=>{const mesh=triangulatePolygonWithHoles2(region.outer,region.holes);return mesh.triangles.map(t=>t.map(i=>mesh.points[i]));}),glyphBounds=glyphTriangles.map(textureBounds2);
  let comparisons=0,vertices=0;
  const projectedTriangles=queue.flatMap(id=>triangulateFaceLocal(s,id,undefined,'canonical').map(triangle=>({faceId:id,outline:triangle.map(p=>toPlane2(p,basis))}))),projectedBounds=projectedTriangles.map(t=>textureBounds2(t.outline));
  // A chart must be single-valued. Folded surfaces cannot assign one letter
  // point to two source layers, even when their silhouette looks plausible.
  for(let i=0;i<projectedTriangles.length;i++)for(let j=0;j<i;j++){
    if(!textureBoundsOverlap(projectedBounds[i],projectedBounds[j]))continue;
    if(++comparisons>CURVED_TEXT_POLICY.maximumClipComparisons)throw Error('Curved text projection exceeds its checking budget. Use a simpler surface.');
    const overlap=textureIntersectFragments2(projectedTriangles[i].outline,projectedTriangles[j].outline);
    if(overlap.length>=3&&Math.abs(v2.area(overlap))>TOL.minimumFaceArea)throw Error('The surface overlaps in the text projection. Choose a different placement face.');
  }
  for(const id of queue){
    const face=s.faces.get(id)!,frame=textFaceFrame(s,id),fragments:Vec3[][]=[];
    for(let index=0;index<projectedTriangles.length;index++){
      const triangle=projectedTriangles[index];if(triangle.faceId!==id)continue;
      for(let i=0;i<glyphTriangles.length;i++){
        if(!textureBoundsOverlap(projectedBounds[index],glyphBounds[i]))continue;
        if(++comparisons>CURVED_TEXT_POLICY.maximumClipComparisons)throw Error('Curved lettering is too complex. Use shorter text or a simpler surface.');
        const clipped=textureIntersectFragments2(glyphTriangles[i],triangle.outline);
        if(clipped.length>=3)fragments.push(clipped.map(uv=>curvedTextSurfacePoint(uv,face.plane,basis)));
      }
    }
    if(!fragments.length)continue;
    const regions=classifyPlaneLoops(boundaryLoopsFromPolygons(fragments,face.plane).map(simplifyCollinearLoop3),face.plane)
      .map(r=>({outer:r.outer.map(p=>toPlane2(p,frame)),holes:r.holes.map(h=>h.map(p=>toPlane2(p,frame)))}))
      .filter(r=>Math.abs(v2.area(r.outer))-r.holes.reduce((a,h)=>a+Math.abs(v2.area(h)),0)>TOL.minimumFaceArea);
    if(!regions.length)continue;
    vertices+=regions.reduce((a,r)=>a+r.outer.length+r.holes.reduce((b,h)=>b+h.length,0),0);
    if(vertices>CURVED_TEXT_POLICY.maximumClippedVertices)throw Error('Curved lettering creates too many points. Use shorter text or a simpler surface.');
    patch.faces.push({faceId:id,basis:frame,regions});
  }
  if(!patch.faces.length)throw Error('No text lies on the curved surface.');
  return patch;
}
function curvedTextPatchIsPlanar(s:Solid,layout:FaceTextLayout):boolean {
  const {basis,curved}=layout;if(!curved?.faces.length)return false;
  const offset=V.dot(basis.normal,basis.origin);
  return curved.faces.every(({faceId})=>V.dot(s.faces.get(faceId)!.plane.normal,basis.normal)>1-TOL.coplanarAngle&&faceLoopPoints(s,faceId).outer.every(p=>Math.abs(V.dot(basis.normal,p)-offset)<=TOL.plane));
}
function curvedTextFeatureFaces(s:Solid,layout:FaceTextLayout,depth:number):PolyFaceInput[] {
  const patch=layout.curved!,selected=new Set(patch.faceIds),out:PolyFaceInput[]=[],delta=V.mul(layout.basis.normal,depth);
  for(const f of patch.faces){
    const source=s.faces.get(f.faceId)!,internalEdges=[source.outerLoop,...source.innerLoops].flatMap(lid=>loopHalfEdges(s,lid))
      .filter(e=>selected.has(s.halfEdges.get(e.twin)?.face||''))
      .map(e=>({a:toPlane2(s.vertices.get(e.origin)!.position,f.basis),b:toPlane2(s.vertices.get(s.halfEdges.get(e.next)!.origin)!.position,f.basis)}));
    const cap:Plane={normal:source.plane.normal,offset:source.plane.offset+V.dot(source.plane.normal,delta)},point=(uv:Vec2)=>fromPlane2(uv,f.basis),
      push=(points:Vec3[],planeHint?:Plane)=>out.push({points,planeHint,provenance:{kind:'boolean',label:'Curved Text'}});
    for(const region of f.regions){
      const mesh=triangulatePolygonWithHoles2(region.outer,region.holes);
      for(const triangle of mesh.triangles)push(triangle.map(i=>V.add(point(mesh.points[i]),delta)),cap);
      for(const loop of [region.outer,...region.holes])for(let i=0;i<loop.length;i++){
        const a=loop[i],b=loop[(i+1)%loop.length];
        if(internalEdges.some(e=>pointOnSegment2(a,e.a,e.b,TOL.topologyKey)&&pointOnSegment2(b,e.a,e.b,TOL.topologyKey)))continue;
        push([point(a),point(b),V.add(point(b),delta),V.add(point(a),delta)]);
      }
    }
  }
  return out;
}
// Local skin replacement cannot join another retained wall. Inclusive contact
// checks also catch an exact terminal touch, which a strict crossing test and
// graph-only B-rep validation cannot distinguish from coincident internal skins.
function curvedTextCheckContacts(s:Solid,selected:ReadonlySet<FaceId>,features:PolyFaceInput[]):void {
  const field=(points:Vec3[])=>{const plane=planeFromPoints(points),basis=planeBasis(plane,points[0]);return {points,plane,basis,uv:points.map(p=>toPlane2(p,basis)),bounds:textureBandBounds3(points)};};
  const source=[...s.faces.values()].filter(f=>!selected.has(f.id)).flatMap(f=>triangulateFaceLocal(s,f.id,undefined,'canonical')).map(field),generated=features.flatMap(f=>{
    const basis=planeBasis(f.planeHint||planeFromPoints(f.points),f.points[0]);
    return f.points.length===3?[field(f.points)]:triangulateSimple2(f.points.map(p=>toPlane2(p,basis))).map(t=>field(t.map(i=>f.points[i])));
  });
  const contains=(p:Vec3,f:ReturnType<typeof field>)=>{const uv=toPlane2(p,f.basis);return pointInPolygon2(uv,f.uv)||f.uv.some((a,i)=>pointOnSegment2(uv,a,f.uv[(i+1)%f.uv.length],TOL.plane));};
  const edgeHits=(a:Vec3,b:Vec3,f:ReturnType<typeof field>)=>{
    const da=V.dot(f.plane.normal,a)-f.plane.offset,db=V.dot(f.plane.normal,b)-f.plane.offset;
    if(Math.abs(da)<=TOL.plane&&contains(a,f)||Math.abs(db)<=TOL.plane&&contains(b,f))return true;
    if(da*db>=0)return false;
    return contains(V.lerp(a,b,da/(da-db)),f);
  };
  for(const a of generated)for(const b of source){
    if(!a.bounds.min.every((n,i)=>n<=b.bounds.max[i]+TOL.plane&&a.bounds.max[i]>=b.bounds.min[i]-TOL.plane))continue;
    if(a.points.every(p=>Math.abs(V.dot(b.plane.normal,p)-b.plane.offset)<=TOL.plane)){
      const projected=a.points.map(p=>toPlane2(p,b.basis));
      if(a.points.some(p=>contains(p,b))||b.points.some(p=>contains(p,a))||projected.some((p,i)=>b.uv.some((q,j)=>segmentIntersection2(p,projected[(i+1)%3],q,b.uv[(j+1)%3]))))throw Error('Text depth touches another surface. Reduce height / depth or choose another placement.');
    }else for(let i=0;i<3;i++)if(edgeHits(a.points[i],a.points[(i+1)%3],b)||edgeHits(b.points[i],b.points[(i+1)%3],a))throw Error('Text depth touches or crosses another surface. Reduce height / depth or choose another placement.');
  }
}
function applyCurvedTextPatch(s:Solid,layout:FaceTextLayout,p:FaceTextParameters,onProgress?:(update:ModelingProgressUpdate)=>void):Solid {
  const depth=p.depth*(p.operation==='add'?1:-1);
  return applyTextSurfaceSkin(s,layout.curved!,curvedTextFeatureFaces(s,layout,depth),depth,'Curved Text',onProgress);
}
function applyTextSurfaceSkin(s:Solid,patch:CurvedTextPatch,features:PolyFaceInput[],depth:number,label:string,onProgress?:(update:ModelingProgressUpdate)=>void,rebuildOptions:BrepRebuildOptions={}):Solid {
  const selected=new Set(patch.faces.map(f=>f.faceId)),inputs:PolyFaceInput[]=[];
  onProgress?.({progress:20,message:'Building text surfaces…'});
  for(const face of s.faces.values())if(!selected.has(face.id))for(const points of triangulateFaceLocal(s,face.id,undefined,'canonical'))inputs.push({points,planeHint:face.plane,provenance:face.provenance});
  for(const f of patch.faces){
    const face=s.faces.get(f.faceId)!,loops=faceLoopPoints(s,f.faceId),boundaries=[loops.outer,...loops.holes];
    for(const region of f.regions)for(const loop of [region.outer,...region.holes])boundaries.push([...loop].reverse().map(q=>fromPlane2(q,f.basis)));
    const remainder=classifyPlaneLoops(boundaryLoopsFromPolygons(boundaries,face.plane),face.plane);
    for(const region of remainder){
      // A hole-free remainder already is one oriented polygon. Preserve tiny
      // intersection ears until collective reconstruction resolves their edges;
      // normalizing/triangulating them as independent model faces rejects them
      // before their incident glyph walls can share the same resolution.
      if(!region.holes.length){inputs.push({points:region.outer,planeHint:face.plane,provenance:face.provenance});continue;}
      const mesh=triangulatePolygonWithHoles2(region.outer.map(q=>toPlane2(q,f.basis)),region.holes.map(h=>h.map(q=>toPlane2(q,f.basis))));for(const t of mesh.triangles)inputs.push({points:t.map(i=>fromPlane2(mesh.points[i],f.basis)),planeHint:face.plane,provenance:face.provenance});
    }
  }
  onProgress?.({progress:55,message:'Checking text depth…'});
  // Untouched chart neighbors may share a footprint boundary at depth zero.
  // The single-valued chart and unchanged UVs rule out later collisions there.
  curvedTextCheckContacts(s,new Set(patch.faceIds),features);
  textureBandCheckClearance(s,selected,features,depth);
  onProgress?.({progress:80,message:'Validating text geometry…'});
  const out=buildSolidFromPolygons([...inputs,...features],s.id,rebuildOptions);out.metadata=structuredClone(s.metadata);
  const validation=validateSolid(out,false);if(!validation.ok)throw Error(`${label} produced invalid geometry: ${validation.errors[0]}`);
  if(connectedSolidFaceComponents(out).length!==1)throw Error(`${label} would leave disconnected surfaces. Reduce the depth.`);
  onProgress?.({progress:100,message:'Text geometry complete.'});return out;
}
