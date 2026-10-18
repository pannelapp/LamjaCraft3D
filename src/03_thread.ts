const THREAD_POLICY=Object.freeze({
  minimumPitch:.05,
  minimumDepth:.02,
  minimumLength:.1,
  minimumProfileAngleDeg:30,
  maximumProfileAngleDeg:80,
  maximumProfilePitchFraction:.96,
  maximumSweepSections:1800,
  radialOverlapToleranceFactor:8,
  terminalSectionAvoidanceFactor:8,
  terminalControlInsetFactor:2,
  minimumRelativeVolumeChange:1e-10,
  lengthToleranceFactor:16,
  endClipMarginFactor:2,
});


function threadRimInfo(s:Solid,halfEdgeId:HalfEdgeId):ThreadRimInfo|null{
  const seed=s.halfEdges.get(halfEdgeId);if(!seed)return null;
  for(const he of [seed,s.halfEdges.get(seed.twin)].filter(Boolean) as HalfEdge[]){
    const loop=s.loops.get(he.loop),support=s.faces.get(he.face);if(!loop||!support)continue;
    const rim=loopHalfEdges(s,loop.id);if(rim.length<CHAMFER_CIRCULAR_RIM_POLICY.minimumVertices)continue;
    const pts=rim.map(e=>[...s.vertices.get(e.origin)!.position] as Vec3);if(!approximatelyCircularPlanarLoop(pts,support.plane))continue;
    const sideFaces:Face[]=[];let straight=true;
    for(const e of rim){const twin=s.halfEdges.get(e.twin),side=twin&&s.faces.get(twin.face);if(!side||Math.abs(V.dot(side.plane.normal,support.plane.normal))>.08){straight=false;break;}sideFaces.push(side);}
    if(!straight)continue;
    const center=V.mul(pts.reduce((a,q)=>V.add(a,q),[0,0,0] as Vec3),1/pts.length),radius=pts.reduce((a,q)=>a+V.len(V.sub(q,center)),0)/pts.length;
    if(radius<=TOL.minimumEdge)continue;
    const axis=V.mul(support.plane.normal,-1);let maxLength=Infinity;
    for(const face of sideFaces){
      const q=faceLoopPoints(s,face.id),vertices=[...q.outer,...q.holes.flat()],depth=Math.max(0,...vertices.map(v=>V.dot(V.sub(v,center),axis)));maxLength=Math.min(maxLength,depth);
    }
    if(!Number.isFinite(maxLength)||maxLength<=TOL.minimumEdge)continue;
    const referenceRadial=V.unit(V.sub(pts[0],center));if(V.len(referenceRadial)<=TOL.minimumEdge)continue;
    return {halfEdgeId:he.id,halfEdgeIds:rim.map(e=>e.id),kind:loop.kind==='hole'?'internal':'external',center,axis,radius,maxLength,rimSegments:rim.length,referenceRadial};
  }
  return null;
}

function orientedThreadTriangle(points:[Vec3,Vec3,Vec3],expectedOut:Vec3):CSGPolygon{
  let vs=points.map(p=>[...p] as Vec3) as [Vec3,Vec3,Vec3],pl=planeFromPoints(vs);if(V.dot(pl.normal,expectedOut)<0){vs=[vs[0],vs[2],vs[1]];pl=planeFromPoints(vs);}return {vs,plane:pl};
}

function threadSweepProfileGeometry(radius:number,depth:number,halfWidth:number,surfaceOverlap:number,overlap:number,sweepSegments:number,radialSign:number){
  const tipRadius=radius+radialSign*depth,nominalRootRadius=radius-radialSign*surfaceOverlap;
  if(radialSign>=0)return {tipRadius,rootRadius:nominalRootRadius,rootHalfWidth:halfWidth};
  // For inward tools, a straight chord between coarse root samples must stay on the solid side
  // of the selected wall. Inflate only the outside root, then preserve the requested V angle
  // by keeping the nominal wall crossing at the original axial half-width.
  const wallSafeRootRadius=(radius+overlap)/Math.cos(Math.PI/sweepSegments),rootRadius=Math.max(nominalRootRadius,wallSafeRootRadius),rootHalfWidth=halfWidth*(rootRadius-tipRadius)/depth;
  return {tipRadius,rootRadius,rootHalfWidth};
}

function threadSweepBounds(length:number,profileHalfWidth:number):[number,number]{
  return [-profileHalfWidth,length+profileHalfWidth];
}

function threadFacetedWallRadius(info:ThreadRimInfo,rimPhase:number,theta:number):number{
  const step=Math.PI*2/info.rimSegments,rel=((theta-rimPhase)%step+step)%step,local=rel-step*.5;
  return info.radius*Math.cos(step*.5)/Math.cos(local);
}

function threadSweepSectionPositions(sweepStart:number,sweepEnd:number,pitch:number,sweepSegments:number,clipStart?:number,clipEnd?:number,terminalControls=true):number[]{
  const terminalEps=Math.max(TOL.minimumEdge,TOL.topologyKey)*THREAD_POLICY.terminalSectionAvoidanceFactor,isTerminal=(z:number)=>[clipStart,clipEnd].some(v=>v!==undefined&&Math.abs(z-v)<=terminalEps),step=pitch/sweepSegments,eps=Math.max(TOL.minimumEdge,TOL.topologyKey)*.25,out=[sweepStart],first=Math.ceil((sweepStart+eps)/step),last=Math.floor((sweepEnd-eps)/step);
  for(let k=first;k<=last;k++){const z=k*step;if(!isTerminal(z))out.push(z);}
  if(terminalControls){const terminalControlInset=terminalEps*THREAD_POLICY.terminalControlInsetFactor;for(const control of [clipStart===undefined?undefined:clipStart+terminalControlInset,clipEnd===undefined?undefined:clipEnd-terminalControlInset])if(control!==undefined&&control>sweepStart+eps&&control<sweepEnd-eps)out.push(control);}
  out.sort((a,b)=>a-b);const unique=out.filter((z,i)=>i===0||z-out[i-1]>eps);
  if(sweepEnd-unique[unique.length-1]>eps)unique.push(sweepEnd);else unique[unique.length-1]=sweepEnd;
  return unique;
}

function threadToolCsg(info:ThreadRimInfo,pitch:number,depth:number,length:number,profileAngleDeg:number,direction:ThreadDirection,operation:ThreadOperation,diagnostic?:ModelingDiagnosticReporter):CSGPolygon[]{
  if(!Number.isFinite(pitch)||pitch<THREAD_POLICY.minimumPitch)throw Error(`Thread pitch must be at least ${THREAD_POLICY.minimumPitch} mm.`);
  if(!Number.isFinite(depth)||depth<THREAD_POLICY.minimumDepth)throw Error(`Thread depth must be at least ${THREAD_POLICY.minimumDepth} mm.`);
  if(!Number.isFinite(length)||length<THREAD_POLICY.minimumLength)throw Error(`Thread length must be at least ${THREAD_POLICY.minimumLength} mm.`);
  if(length>info.maxLength+Math.max(TOL.snapGeometry*THREAD_POLICY.lengthToleranceFactor,TOL.minimumEdge*THREAD_POLICY.lengthToleranceFactor))throw Error(`Thread length exceeds the available straight wall (${info.maxLength.toFixed(2)} mm).`);
  if(!Number.isFinite(profileAngleDeg)||profileAngleDeg<THREAD_POLICY.minimumProfileAngleDeg||profileAngleDeg>THREAD_POLICY.maximumProfileAngleDeg)throw Error(`Thread profile angle must be between ${THREAD_POLICY.minimumProfileAngleDeg}° and ${THREAD_POLICY.maximumProfileAngleDeg}°.`);
  const requestedSegments=info.rimSegments,halfWidth=depth*Math.tan(profileAngleDeg*Math.PI/360);
  if(halfWidth*2>=pitch*THREAD_POLICY.maximumProfilePitchFraction)throw Error('Thread depth is too large for this pitch and profile angle.');
  if(length<=halfWidth*2+TOL.minimumEdge)throw Error('Thread length is too short for the selected depth.');
  const normal=V.mul(info.axis,-1),basis=planeBasis({normal,offset:V.dot(normal,info.center)},info.center),polygonInset=info.radius*(1-Math.cos(Math.PI/info.rimSegments)),overlap=Math.max(TOL.snapGeometry*THREAD_POLICY.radialOverlapToleranceFactor,TOL.minimumEdge*THREAD_POLICY.radialOverlapToleranceFactor),surfaceOverlap=polygonInset+overlap,radialSign=(info.kind==='external'?1:-1)*(operation==='add'?1:-1),sweepSegments=requestedSegments,profile=threadSweepProfileGeometry(info.radius,depth,halfWidth,surfaceOverlap,overlap,sweepSegments,radialSign),tipRadius=profile.tipRadius,rootRadius=profile.rootRadius,rootHalfWidth=profile.rootHalfWidth,[sweepStart,sweepEnd]=threadSweepBounds(length,rootHalfWidth),sectionPositions=threadSweepSectionPositions(sweepStart,sweepEnd,pitch,sweepSegments,0,length,true),sections=sectionPositions.length;if(sections>THREAD_POLICY.maximumSweepSections)throw Error(`Thread is too detailed (${sections} sweep sections) with ${info.rimSegments} rim-aligned segments per turn. Reduce the source circle/cylinder segment count, increase pitch, or shorten the thread.`);
  const sign=direction==='right'?-1:1,rimPhase=Math.atan2(V.dot(info.referenceRadial,basis.v),V.dot(info.referenceRadial,basis.u)),startPhase=rimPhase;diagnostic?.('thread','tool-parameters',{requestedSegments,sweepSegments,sections,halfWidth,rootHalfWidth,tipRadius,rootRadius,polygonInset,overlap,surfaceOverlap,radialSign,sweepStart,sweepEnd,rimPhase,sectionStep:pitch/sweepSegments});
  if(rootHalfWidth*2>=pitch*THREAD_POLICY.maximumProfilePitchFraction+TOL.minimumEdge)throw Error(`Thread cannot represent this profile safely with the selected rim's ${info.rimSegments} aligned segments. Increase the source circle/cylinder segment count or reduce thread depth.`);
  if(Math.min(rootRadius,tipRadius)<=TOL.minimumEdge)throw Error('Thread depth is too large for the selected radius.');
  const rings:[Vec3,Vec3,Vec3][]=[];
  for(let i=0;i<sections;i++){
    const z=sectionPositions[i],theta=startPhase+sign*Math.PI*2*(z/pitch),radial=V.add(V.mul(basis.u,Math.cos(theta)),V.mul(basis.v,Math.sin(theta))),rootCenter=V.add(info.center,V.mul(radial,rootRadius)),tipCenter=V.add(info.center,V.mul(radial,tipRadius));
    rings.push([V.add(rootCenter,V.mul(info.axis,z-rootHalfWidth)),V.add(tipCenter,V.mul(info.axis,z)),V.add(rootCenter,V.mul(info.axis,z+rootHalfWidth))]);
  }
  const out:CSGPolygon[]=[];
  for(let i=0;i+1<rings.length;i++){
    const a=rings[i],b=rings[i+1],ca=V.mul(V.add(V.add(a[0],a[1]),a[2]),1/3),cb=V.mul(V.add(V.add(b[0],b[1]),b[2]),1/3),center=V.mul(V.add(ca,cb),.5);
    for(let k=0;k<3;k++){const n=(k+1)%3,edgeCenter=V.mul(V.add(V.add(a[k],a[n]),V.add(b[k],b[n])),.25),expected=V.sub(edgeCenter,center);out.push(orientedThreadTriangle([a[k],b[k],b[n]],expected),orientedThreadTriangle([a[k],b[n],a[n]],expected));}
  }
  const start=rings[0],next=rings[1],end=rings[rings.length-1],prev=rings[rings.length-2],startCenter=V.mul(V.add(V.add(start[0],start[1]),start[2]),1/3),nextCenter=V.mul(V.add(V.add(next[0],next[1]),next[2]),1/3),endCenter=V.mul(V.add(V.add(end[0],end[1]),end[2]),1/3),prevCenter=V.mul(V.add(V.add(prev[0],prev[1]),prev[2]),1/3);
  out.push(orientedThreadTriangle(start,V.sub(startCenter,nextCenter)),orientedThreadTriangle(end,V.sub(endCenter,prevCenter)));
  const transverse=Math.max(rootRadius,tipRadius)+Math.max(depth,TOL.minimumEdge*THREAD_POLICY.endClipMarginFactor),p=(u:number,v:number,z:number)=>V.add(V.add(V.add(info.center,V.mul(basis.u,u)),V.mul(basis.v,v)),V.mul(info.axis,z)),a=[p(-transverse,-transverse,0),p(transverse,-transverse,0),p(transverse,transverse,0),p(-transverse,transverse,0)],b=[p(-transverse,-transverse,length),p(transverse,-transverse,length),p(transverse,transverse,length),p(-transverse,transverse,length)],center=V.add(info.center,V.mul(info.axis,length*.5)),clip:CSGPolygon[]=[orientConvexFace(a,center),orientConvexFace(b,center)];
  for(let i=0;i<4;i++){const j=(i+1)%4;clip.push(orientConvexFace([a[i],b[i],b[j],a[j]],center));}
  diagnostic?.('thread','tool-before-clip',{sweepPolygons:out.length,clipPolygons:clip.length});const clipped=csgIntersectOwned(out,clip);diagnostic?.('thread','tool-complete',{polygons:clipped.length});return clipped;
}

function threadEdgeSolid(s:Solid,halfEdgeId:HalfEdgeId,pitch:number,depth:number,length:number,profileAngleDeg=60,direction:ThreadDirection='right',operation:ThreadOperation='add',report?:(update:ModelingProgressUpdate)=>void,reportDiagnostic?:(event:ModelingDiagnosticEvent)=>void):Solid{
  const started=profilerClock(),progress=(value:number,message:string)=>report?.({progress:Math.max(0,Math.min(100,value)),message}),diagnostic:ModelingDiagnosticReporter=(category,event,data={})=>reportDiagnostic?.({category,event,elapsedMs:profilerClock()-started,data});
  diagnostic('thread','start',{halfEdgeId,pitch,depth,length,profileAngleDeg,direction,operation,source:{vertices:s.vertices.size,halfEdges:s.halfEdges.size,loops:s.loops.size,faces:s.faces.size},tolerances:TOL,threadPolicy:THREAD_POLICY,csgRepairPolicy:CSG_REPAIR_POLICY});
  progress(2,'Analyzing selected rim…');
  const info=threadRimInfo(s,halfEdgeId);if(!info){diagnostic('thread','rim-rejected',{halfEdgeId});throw Error('Thread requires a circular hole rim or circular outer cylinder rim with a straight wall.');}
  diagnostic('thread','rim',{halfEdgeId:info.halfEdgeId,kind:info.kind,center:info.center,axis:info.axis,radius:info.radius,maxLength:info.maxLength,rimSegments:info.rimSegments,referenceRadial:info.referenceRadial});
  progress(6,'Preparing source solid…');
  const base=solidToCsg(s,true);diagnostic('csg','source-polygons',{count:base.length});
  progress(10,'Validating source solid…');
  const beforeVolume=validateSolid(s,false).volume,minimumVolumeChange=Math.max(1,Math.abs(beforeVolume))*THREAD_POLICY.minimumRelativeVolumeChange;diagnostic('brep','source-validation',{volume:beforeVolume,minimumVolumeChange});
  progress(14,'Building helical thread tool…');
  const tool=threadToolCsg(info,pitch,depth,length,profileAngleDeg,direction,operation,diagnostic);
  progress(30,'Applying Boolean operation…');
  const booleanStarted=profilerClock(),result=operation==='cut'?csgSubtractOwned(base,tool):csgUnionOwned(base,tool);diagnostic('csg','boolean-complete',{operation,sourcePolygons:base.length,toolPolygons:tool.length,resultPolygons:result.length,durationMs:profilerClock()-booleanStarted});
  progress(68,'Conforming CSG seams…');
  const out=csgToSolid(result,s.id,{kind:'boolean',label:'Thread'},true,diagnostic);
  progress(88,'Validating thread result…');
  const afterVolume=validateSolid(out,false).volume,delta=afterVolume-beforeVolume;diagnostic('thread','volume-check',{beforeVolume,afterVolume,delta,minimumVolumeChange});
  if(operation==='add'?delta<=minimumVolumeChange:delta>=-minimumVolumeChange){diagnostic('thread','no-intersection',{delta,minimumVolumeChange});throw Error('Thread did not intersect the selected wall.');}
  progress(100,'Thread complete');diagnostic('thread','complete',{durationMs:profilerClock()-started,result:{vertices:out.vertices.size,halfEdges:out.halfEdges.size,loops:out.loops.size,faces:out.faces.size},volume:afterVolume});
  return out;
}
