// Periodic lettering on concentric cone/sphere facets. Chart triangles are
// affine on canonical source triangles: clipping area and shared seams are
// exact in this chart, while width follows changing local circumference.
const ROUND_TEXT_POLICY=Object.freeze({maximumFaces:1000,minimumPanels:6,maximumRadiusStepRatio:.05,maximumSlicesPerTriangle:64,maximumChartTriangles:20000,maximumFaceAngle:Math.PI/2,relativeFitTolerance:1e-5,minimumRadiusRatio:.12,maximumInwardRadiusRatio:.4,maximumClipComparisons:500000,maximumClippedVertices:24000,maximumGeneratedFaces:60000,minimumFragmentArea:1e-14,minimumChartTriangleArea:1e-12,relativeAreaTolerance:1e-8,barycentricTolerance:1e-7,sourceCornerResolutionDistance:Math.sqrt(TOL.minimumFaceArea*2)});
interface RoundTextTriangle {world:Vec3[];chart:Vec2[];local:Vec2[];directions:Vec3[];}
interface RoundTextField {faceId:FaceId;basis:PlaneBasis;triangles:RoundTextTriangle[];}
interface RoundTextContext {kind:'cone'|'sphere';frame:TextureBandFrame;period:number;originX:number;originY:number;minimumRadius:number;fields:Map<FaceId,RoundTextField>;}
interface RoundTextPatch extends CurvedTextPatch {context:RoundTextContext;}
function roundTextWeights(point:Vec2,triangle:Vec2[]):number[]{const [a,b,c]=triangle,det=v2.cross(a,b,c),w0=v2.cross(point,b,c)/det,w1=v2.cross(a,point,c)/det;return [w0,w1,1-w0-w1];}
function roundTextMix(points:Vec3[],weights:number[]):Vec3{return points.reduce((sum,p,i)=>V.add(sum,V.mul(p,weights[i])),[0,0,0] as Vec3);}
function roundTextClipHeight(points:Vec3[],height:number,axis:Vec3,keepAbove:boolean):Vec3[] {
  const out:Vec3[]=[];for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],ha=V.dot(a,axis)-height,hb=V.dot(b,axis)-height;if(keepAbove?ha>=0:ha<=0)out.push(a);if(ha*hb<0)out.push(V.lerp(a,b,ha/(ha-hb)));}return out;
}
function roundTextContext(s:Solid,seed:FaceId,kind:'cone'|'sphere',settings:NonNullable<FaceTextParameters['wrap']>,anchor:Vec3):RoundTextContext {
  const frame=textureBandFrame(s,settings.axis,anchor),levels=new Map<number,{height:number;radius:number}[]>();
  for(const vertex of s.vertices.values()){const height=V.dot(vertex.position,frame.axis),key=Math.round(height/TOL.topologyKey),row=levels.get(key)||[];row.push({height,radius:textureBandRadius(vertex.position,frame)});levels.set(key,row);}
  const profile=[...levels.values()].map(row=>({height:row.reduce((n,p)=>n+p.height,0)/row.length,radius:row.reduce((n,p)=>n+p.radius,0)/row.length,row})).sort((a,b)=>a.height-b.height),maxRadius=Math.max(...profile.map(p=>p.radius)),tolerance=Math.max(TOL.plane,maxRadius*ROUND_TEXT_POLICY.relativeFitTolerance);
  if(profile.length<2||maxRadius<TEXTURE_BAND_POLICY.minimumRadius||profile.some(p=>p.row.some(q=>Math.abs(q.radius-p.radius)>tolerance)))throw Error('Wrap requires concentric round rings around the chosen object axis. Use Local surface for modified or irregular shapes.');
  if(Math.max(...profile.map(p=>p.row.length))<ROUND_TEXT_POLICY.minimumPanels)throw Error('Wrap requires at least six side facets around the object.');
  const meanH=profile.reduce((n,p)=>n+p.height,0)/profile.length,meanR=profile.reduce((n,p)=>n+p.radius,0)/profile.length,hh=profile.reduce((n,p)=>n+(p.height-meanH)**2,0),slope=profile.reduce((n,p)=>n+(p.height-meanH)*(p.radius-meanR),0)/hh;
  if(kind==='cone'){
    if(!Number.isFinite(slope)||Math.abs(slope)<ROUND_TEXT_POLICY.relativeFitTolerance||profile.some(p=>Math.abs(p.radius-(meanR+slope*(p.height-meanH)))>tolerance))throw Error('Wrap around cone requires a straight cone or conical frustum. Choose its object axis or use Local surface.');
  }else{
    if(profile.length<3)throw Error('Wrap around sphere requires a spherical surface with latitude rings.');
    const meanQ=profile.reduce((n,p)=>n+p.radius*p.radius+(p.height-meanH)**2,0)/profile.length,centerOffset=profile.reduce((n,p)=>n+(p.height-meanH)*(p.radius*p.radius+(p.height-meanH)**2-meanQ),0)/(2*hh),radius=Math.sqrt(meanQ+centerOffset*centerOffset),centerH=meanH+centerOffset;
    if(!Number.isFinite(radius)||profile.some(p=>Math.abs(Math.hypot(p.radius,p.height-centerH)-radius)>tolerance))throw Error('Wrap around sphere requires concentric spherical latitude rings. Choose its object axis or use Local surface.');
  }
  const distances=[0];for(let i=1;i<profile.length;i++)distances.push(distances[i-1]+Math.hypot(profile[i].height-profile[i-1].height,profile[i].radius-profile[i-1].radius));
  const meridian=(height:number)=>{let i=1;while(i<profile.length-1&&profile[i].height<height)i++;return distances[i-1]+(distances[i]-distances[i-1])*(height-profile[i-1].height)/(profile[i].height-profile[i-1].height);};
  const radiusAt=(height:number)=>{let i=1;while(i<profile.length-1&&profile[i].height<height)i++;return profile[i-1].radius+(profile[i].radius-profile[i-1].radius)*(height-profile[i-1].height)/(profile[i].height-profile[i-1].height);};
  const anchorH=V.dot(anchor,frame.axis),section:Vec2[]=[];
  for(const edge of s.halfEdges.values()){const a=s.vertices.get(edge.origin)!.position,b=s.vertices.get(s.halfEdges.get(edge.next)!.origin)!.position,ha=V.dot(a,frame.axis),hb=V.dot(b,frame.axis);if(Math.abs(ha-anchorH)<=TOL.plane)section.push([V.dot(a,frame.u),V.dot(a,frame.v)]);if((ha-anchorH)*(hb-anchorH)<0){const p=V.lerp(a,b,(anchorH-ha)/(hb-ha));section.push([V.dot(p,frame.u),V.dot(p,frame.v)]);}}
  const hull=cylinderTextHull(section);if(hull.length<ROUND_TEXT_POLICY.minimumPanels)throw Error('Click a round side away from the tip or poles.');
  const period=hull.reduce((n,p,i)=>n+v2.dist(p,hull[(i+1)%hull.length]),0),minimumRadius=maxRadius*ROUND_TEXT_POLICY.minimumRadiusRatio;
  if(textureBandRadius(anchor,frame)<minimumRadius)throw Error('Text wrap must stay away from the cone tip or sphere poles. Choose a wider side area.');
  const low=profile[0].height,high=profile.at(-1)!.height;
  const cutoff=kind==='cone'?(minimumRadius-meanR)/slope+meanH:null,keepAbove=slope>0;
  const side=(id:FaceId)=>{const f=s.faces.get(id)!,points=faceLoopPoints(s,id).outer;if(Math.abs(V.dot(f.plane.normal,frame.axis))>1-TOL.coplanarAngle)return false;if(kind==='sphere'&&points.some(p=>textureBandRadius(p,frame)<minimumRadius))return false;const nonAxis=points.filter(p=>textureBandRadius(p,frame)>=TEXTURE_BAND_POLICY.minimumRadius),center=V.mul(points.reduce((n,p)=>V.add(n,p),[0,0,0] as Vec3),1/points.length),near=textureBandAngle(center,frame),angles=nonAxis.map(p=>textureBandUnwrap(textureBandAngle(p,frame),near));return nonAxis.length>=2&&Math.max(...angles)-Math.min(...angles)<=ROUND_TEXT_POLICY.maximumFaceAngle;};
  if(!side(seed))throw Error('Choose a side face away from caps, the cone tip and sphere poles.');
  const ids=[seed],seen=new Set(ids);for(let i=0;i<ids.length;i++)for(const lid of [s.faces.get(ids[i])!.outerLoop,...s.faces.get(ids[i])!.innerLoops])for(const edge of loopHalfEdges(s,lid)){const id=s.halfEdges.get(edge.twin)?.face;if(!id||seen.has(id)||!side(id))continue;seen.add(id);ids.push(id);if(ids.length>ROUND_TEXT_POLICY.maximumFaces)throw Error('Text wrap exceeds 1,000 side faces. Use a simpler object.');}
  // Source incident planes own the offset; adjacent chart triangles use the
  // same vertex direction even at coplanar reconstruction subdivisions.
  const incident=new Map<VertexId,Vec3[]>();for(const e of s.halfEdges.values()){const normal=s.faces.get(e.face)!.plane.normal;if(Math.abs(V.dot(normal,frame.axis))>1-TOL.coplanarAngle)continue;const ns=incident.get(e.origin)||[];if(!ns.some(n=>V.near(n,normal)))ns.push(normal);incident.set(e.origin,ns);}
  const directions=new Map<VertexId,Vec3>();for(const [id,ns] of incident)directions.set(id,textureBandMiter(ns));
  const direction=(point:Vec3,triangle:Vec3[]):Vec3=>{const basis=planeBasis(planeFromPoints(triangle),triangle[0]),weights=roundTextWeights(toPlane2(point,basis),triangle.map(p=>toPlane2(p,basis))),ds=triangle.map(p=>{const v=[...s.vertices.values()].find(v=>V.len(V.sub(v.position,p))<=TOL.topologyKey);if(!v||!directions.has(v.id))throw Error('Could not determine wrapped text depth.');return directions.get(v.id)!;});return roundTextMix(ds,weights);};
  const ctx:RoundTextContext={kind,frame,period,originX:0,originY:meridian(anchorH),minimumRadius,fields:new Map()};
  let chartTriangles=0;
  for(const id of ids){const basis=textFaceFrame(s,id),triangles:RoundTextTriangle[]=[];
    for(const original of triangulateFaceLocal(s,id,undefined,'canonical')){
      let polygon=original;
      if(cutoff!==null&&cutoff>low&&cutoff<high)polygon=roundTextClipHeight(polygon,cutoff,frame.axis,keepAbove);
      if(polygon.length<3)continue;
      const heights=polygon.map(p=>V.dot(p,frame.axis)),bottom=Math.min(...heights),top=Math.max(...heights),r0=radiusAt(bottom),r1=radiusAt(top),ratio=r1/r0,count=Math.max(1,Math.ceil(Math.abs(Math.log(ratio))/Math.log(1+ROUND_TEXT_POLICY.maximumRadiusStepRatio)));
      if(!Number.isFinite(count)||count>ROUND_TEXT_POLICY.maximumSlicesPerTriangle)throw Error('This side tapers too sharply for text wrap. Use a narrower band.');
      // Refine broad conical facets into thin derived strips. A single affine
      // diagonal on a whole cone panel would severely shear its glyphs.
      const height=(i:number)=>bottom+(top-bottom)*(count===1?i:Math.pow(ratio,i/count)-1)/(count===1?1:ratio-1);
      for(let slice=0;slice<count;slice++){
        const row=roundTextClipHeight(roundTextClipHeight(polygon,height(slice),frame.axis,true),height(slice+1),frame.axis,false);if(row.length<3)continue;
        const center=V.mul(row.reduce((sum,p)=>V.add(sum,p),[0,0,0] as Vec3),1/row.length),near=textureBandAngle(center,frame);
        for(let i=1;i<row.length-1;i++){const world=[row[0],row[i],row[i+1]],chart=world.map(p=>[textureBandUnwrap(textureBandAngle(p,frame),near)*period/(2*Math.PI),meridian(V.dot(p,frame.axis))-ctx.originY] as Vec2);if(Math.abs(v2.area(chart))<=ROUND_TEXT_POLICY.minimumFragmentArea||Math.abs(v2.area(world.map(p=>toPlane2(p,basis))))<=ROUND_TEXT_POLICY.minimumChartTriangleArea)continue;triangles.push({world,chart,local:world.map(p=>toPlane2(p,basis)),directions:world.map(p=>direction(p,original))});if(++chartTriangles>ROUND_TEXT_POLICY.maximumChartTriangles)throw Error('Wrapped text exceeds its derived chart budget. Use a simpler surface.');}
      }
    }
    if(triangles.length)ctx.fields.set(id,{faceId:id,basis,triangles});
  }
  const seedField=ctx.fields.get(seed);if(!seedField)throw Error('Choose a side face away from the cone tip.');
  const point=toPlane2(anchor,seedField.basis),triangle=seedField.triangles.find(t=>roundTextWeights(point,t.local).every(w=>w>=-ROUND_TEXT_POLICY.barycentricTolerance));if(!triangle)throw Error('Click a side point away from the tip or poles.');
  const weights=roundTextWeights(point,triangle.local);ctx.originX=triangle.chart.reduce((n,q,i)=>n+q[0]*weights[i],0);const correctionY=triangle.chart.reduce((n,q,i)=>n+q[1]*weights[i],0);ctx.originY+=correctionY;
  for(const field of ctx.fields.values())for(const t of field.triangles)for(const q of t.chart){q[0]-=ctx.originX;q[1]-=correctionY;}
  // A complete horizontal chart turn must exist at the clicked ring. This
  // rejects partial round shells before short text could mask the missing side.
  const intervals:Vec2[]=[];for(const field of ctx.fields.values())for(const t of field.triangles){const xs:number[]=[];for(let i=0;i<3;i++){const a=t.chart[i],b=t.chart[(i+1)%3];if(Math.abs(a[1])<=TOL.topologyKey)xs.push(a[0]);if(a[1]*b[1]<0)xs.push(a[0]+(b[0]-a[0])*(-a[1])/(b[1]-a[1]));}if(xs.length<2)continue;let start=Math.min(...xs),end=Math.max(...xs);const shift=period*Math.floor(start/period);start-=shift;end-=shift;if(end<=period)intervals.push([start,end]);else{intervals.push([start,period],[0,end-period]);}}
  intervals.sort((a,b)=>a[0]-b[0]);let length=0,end=0;for(const [a,b] of intervals){if(b<=end)continue;length+=b-Math.max(a,end);end=b;}if(Math.abs(length-period)>Math.max(TOL.topologyKey,period*ROUND_TEXT_POLICY.relativeAreaTolerance))throw Error('Wrap requires a complete round side at the clicked ring. Use Local surface for partial shapes.');
  return ctx;
}
function roundTextPoint(uv:Vec2,field:RoundTextField,depth:number):Vec3 {
  const triangle=field.triangles.find(t=>roundTextWeights(uv,t.local).every(w=>w>=-ROUND_TEXT_POLICY.barycentricTolerance));if(!triangle)throw Error('Wrapped preview point lies outside its source facet.');const weights=roundTextWeights(uv,triangle.local);return V.add(fromPlane2(uv,field.basis),V.mul(roundTextMix(triangle.directions,weights),depth));
}
function roundTextPatch(s:Solid,layout:FaceTextLayout,context:RoundTextContext):RoundTextPatch {
  const patch:RoundTextPatch={context,faceIds:[...context.fields.keys()],faces:[],center:[0,0,0],placement:{ok:true}},glyphs=layout.regions.flatMap(r=>{const m=triangulatePolygonWithHoles2(r.outer,r.holes);return m.triangles.map(t=>t.map(i=>m.points[i]));}),bounds=textureBounds2(layout.regions.flatMap(r=>[r.outer,...r.holes].flat()));
  if(bounds[2]-bounds[0]>context.period-2*TEXT_POLICY.minimumBoundaryClearance)throw Error('Text overlaps itself around the wrap seam. Reduce capital height or use shorter lines.');
  let comparisons=0,covered=0,vertices=0;
  for(const field of context.fields.values()){
    const sourceLoops=faceLoopPoints(s,field.faceId),corners=[sourceLoops.outer,...sourceLoops.holes].flat();
    // Near a source corner, independently clipped glyph boundaries can leave
    // an ear below the canonical minimum face area. Resolve derived points to
    // that SAME canonical corner on every incident face, before roofs/walls or
    // the retained skin are built. The bound is below the font flattening error;
    // source coordinates, placement and requested normal depth stay unchanged.
    const resolveCorner=(point:Vec3)=>{let result=point,distance=ROUND_TEXT_POLICY.sourceCornerResolutionDistance;for(const corner of corners){const d=V.len(V.sub(point,corner));if(d<=distance){result=corner;distance=d;}}return result;};
    const fragments:Vec3[][]=[];
    for(const t of field.triangles){const b=textureBounds2(t.chart);for(const glyph of glyphs){const g=textureBounds2(glyph);if(g[3]<b[1]||g[1]>b[3])continue;for(let copy=Math.ceil((b[0]-g[2])/context.period);copy<=Math.floor((b[2]-g[0])/context.period);copy++){
      if(++comparisons>ROUND_TEXT_POLICY.maximumClipComparisons)throw Error('Wrapped text exceeds its clipping budget. Use shorter text or a simpler object.');
      const clipped=textureIntersectFragments2(glyph.map(q=>[q[0]+copy*context.period,q[1]] as Vec2),t.chart);if(clipped.length>=3&&Math.abs(v2.area(clipped))>ROUND_TEXT_POLICY.minimumFragmentArea){covered+=Math.abs(v2.area(clipped));fragments.push(clipped.map(q=>resolveCorner(roundTextMix(t.world,roundTextWeights(q,t.chart)))));}
    }}}
    if(!fragments.length)continue;
    const source=s.faces.get(field.faceId)!,regions=classifyPlaneLoops(boundaryLoopsFromPolygons(fragments,source.plane),source.plane).map(r=>({outer:r.outer.map(q=>toPlane2(q,field.basis)),holes:r.holes.map(h=>h.map(q=>toPlane2(q,field.basis)))}));
    const physical=[source.outerLoop,...source.innerLoops].flatMap(lid=>loopHalfEdges(s,lid)).filter(e=>!context.fields.has(s.halfEdges.get(e.twin)!.face));
    for(const region of regions)for(const loop of [region.outer,...region.holes])for(let i=0;i<loop.length;i++)for(const e of physical){const a=toPlane2(s.vertices.get(e.origin)!.position,field.basis),b=toPlane2(s.vertices.get(s.halfEdges.get(e.next)!.origin)!.position,field.basis),q=loop[i],r=loop[(i+1)%loop.length],distance=(p:Vec2,c:Vec2,d:Vec2)=>{const dx=d[0]-c[0],dy=d[1]-c[1],w=clamp(((p[0]-c[0])*dx+(p[1]-c[1])*dy)/(dx*dx+dy*dy),0,1);return v2.dist(p,[c[0]+w*dx,c[1]+w*dy]);};if(segmentIntersection2(q,r,a,b)||Math.min(distance(q,a,b),distance(r,a,b),distance(a,q,r),distance(b,q,r))<TEXT_POLICY.minimumBoundaryClearance)patch.placement={ok:false,message:'Wrapped text must stay clear of caps, openings and the selected side boundary.'};}
    vertices+=regions.reduce((n,r)=>n+r.outer.length+r.holes.reduce((m,h)=>m+h.length,0),0);if(vertices>ROUND_TEXT_POLICY.maximumClippedVertices)throw Error('Wrapped text creates too many points. Use shorter text or a simpler object.');patch.faces.push({faceId:field.faceId,basis:field.basis,regions});
  }
  if(!patch.faces.length||Math.abs(covered-layout.area)>Math.max(TOL.minimumFaceArea,layout.area*ROUND_TEXT_POLICY.relativeAreaTolerance))patch.placement={ok:false,message:'Text must fit on the complete wrapped side band, away from caps, the tip and poles. Move it or reduce capital height.'};
  const middle:Vec2=[(bounds[0]+bounds[2])*.5,(bounds[1]+bounds[3])*.5];outer:for(const field of context.fields.values())for(const t of field.triangles){const x=middle[0]+context.period*Math.round((textureBounds2(t.chart)[0]-middle[0])/context.period);const weights=roundTextWeights([x,middle[1]],t.chart);if(weights.every(w=>w>=-ROUND_TEXT_POLICY.barycentricTolerance)){patch.center=roundTextMix(t.world,weights);break outer;}}
  return patch;
}
function roundTextDepthLimit(patch:RoundTextPatch):number {
  let radius=Infinity;for(const face of patch.faces)for(const region of face.regions)for(const loop of [region.outer,...region.holes])for(const q of loop)radius=Math.min(radius,textureBandRadius(fromPlane2(q,face.basis),patch.context.frame));
  return radius*ROUND_TEXT_POLICY.maximumInwardRadiusRatio;
}
function roundTextFeatureFaces(s:Solid,layout:FaceTextLayout,depth:number):PolyFaceInput[] {
  const patch=layout.wrap!,out:PolyFaceInput[]=[],selected=new Set(patch.faceIds);
  for(const face of patch.faces){const field=patch.context.fields.get(face.faceId)!,source=s.faces.get(face.faceId)!,edges=[source.outerLoop,...source.innerLoops].flatMap(lid=>loopHalfEdges(s,lid)).filter(e=>selected.has(s.halfEdges.get(e.twin)!.face)),point=(uv:Vec2,z:number)=>roundTextPoint(uv,field,z),push=(points:Vec3[],planeHint?:Plane)=>{out.push({points,planeHint,provenance:{kind:'boolean',label:'Wrapped Text'}});if(out.length>ROUND_TEXT_POLICY.maximumGeneratedFaces)throw Error('Wrapped text exceeds its generated-face budget.');};
    for(const region of face.regions){
      const cap={normal:source.plane.normal,offset:source.plane.offset+depth},roofBasis={...field.basis,origin:V.add(field.basis.origin,V.mul(field.basis.normal,depth))},roof=(q:Vec2)=>toPlane2(point(q,depth),roofBasis);
      // Offset directions are piecewise affine across original source triangles.
      // A straight footprint edge can become a bent roof edge at their seam.
      // Triangulate the actual offset boundary, preserving those roof corners.
      const mesh=triangulatePolygonWithHoles2(region.outer.map(roof),region.holes.map(loop=>loop.map(roof)));
      for(const t of mesh.triangles)push(t.map(i=>fromPlane2(mesh.points[i],roofBasis)),cap);
      for(const loop of [region.outer,...region.holes])for(let i=0;i<loop.length;i++){const a=loop[i],b=loop[(i+1)%loop.length];if(edges.some(e=>{const c=toPlane2(s.vertices.get(e.origin)!.position,face.basis),d=toPlane2(s.vertices.get(s.halfEdges.get(e.next)!.origin)!.position,face.basis);return pointOnSegment2(a,c,d,TOL.topologyKey)&&pointOnSegment2(b,c,d,TOL.topologyKey);}))continue;const points=[point(a,0),point(b,0),point(b,depth),point(a,depth)],plane=planeFromPoints(points);if(points.every(q=>Math.abs(V.dot(plane.normal,q)-plane.offset)<=TOL.plane))push(points,plane);else{push(points.slice(0,3));push([points[0],points[2],points[3]]);}}
    }
  }
  return out;
}
function applyRoundTextPatch(s:Solid,layout:FaceTextLayout,p:FaceTextParameters,onProgress?:(update:ModelingProgressUpdate)=>void):Solid {
  const depth=p.depth*(p.operation==='add'?1:-1),patch=layout.wrap!;
  if(Math.abs(depth)>=roundTextDepthLimit(patch))throw Error('Wrapped text depth is too large for this surface. Reduce height / depth.');
  // Glyph/chart intersections can create a boundary shorter than the canonical
  // minimum edge. Resolve it once across all roofs, walls and retained skin,
  // constrained by every incident plane; independent fragment cleanup cracks seams.
  return applyTextSurfaceSkin(s,patch,roundTextFeatureFaces(s,layout,depth),depth,'Wrapped Text',onProgress,{resolveShortBoundaryEdges:true,preserveBoundaryCorners:true});
}
