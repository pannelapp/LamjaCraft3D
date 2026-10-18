// Basic planar sketch tools and shared ground-extrusion placement.

const GROUND_EXTRUDE_POLICY=Object.freeze({previewMinHeight:0.001});
function isGroundExtrusionPointer(value:unknown):value is GroundExtrusionPointer {return !!value&&typeof value==='object'&&'type' in value&&(value.type==='ground-extrude'||value.type==='ground-extrude-pattern');}
interface GroundExtrusionFrame {returnTool?:ToolName;height:number;startX:number;startY:number;ux:number;uy:number;pxPerMm:number;valid:boolean;name:string;twistAngleDeg?:number;twistPreviews?:TwistSweepPreview[];taperAngleDeg?:number;taperMode?:TaperMode;taperPreviews?:TaperSweepPreview[];previewError?:string|null;}
type GroundExtrusionPointer=GroundExtrusionFrame&(
  {type:'ground-extrude';profile:Vec2[];holes:Vec2[][];previewSolid:Solid|null}|
  {type:'ground-extrude-pattern';profiles:Vec2[][]}
);

function groundExtrudeScreenScale(profile:Vec2[]):{ux:number;uy:number;pxPerMm:number}{
  const c=profile.reduce((sum,p)=>[sum[0]+p[0],sum[1]+p[1]] as Vec2,[0,0] as Vec2).map(v=>v/profile.length) as Vec2,a=project([c[0],c[1],0]),b=project([c[0],c[1],10]),dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
  if(len>TOL.minimumEdge)return {ux:dx/len,uy:dy/len,pxPerMm:len/10};
  const x=project([c[0]+10,c[1],0]),fallback=Math.max(1,Math.hypot(x[0]-a[0],x[1]-a[1])/10);return {ux:0,uy:-1,pxPerMm:fallback};
}
function beginGroundExtrusion(profileInput:Vec2[],holesInput:Vec2[][]=[],name='Extruded shape'):boolean{
  const profile=profileInput.map(p=>[p[0],p[1]] as Vec2),holes=holesInput.map(loop=>loop.map(p=>[p[0],p[1]] as Vec2));if(profile.length<3)return false;const [startX,startY]=debugPointerXY||[W/2,H/2],scale=groundExtrudeScreenScale(profile),returnTool=tool;setTool('push');pointer={type:'ground-extrude',returnTool,profile,holes,name,startX,startY,...scale,height:0,previewSolid:null,valid:true};snapIndicator=null;$('coordinates').textContent='Move upward, then click to set height';updateUI();requestRender();return true;
}
function previewGroundExtrusionHeight(height:number):boolean{
  if(pointer?.type!=='ground-extrude')return false;return previewGroundExtrusionParameters(pointer,height);
}
function previewGroundExtrusionParameters(p:GroundExtrusionPointer,height:number):boolean {
  const h=Math.max(0,clean(height,1e6));p.height=h;p.twistPreviews=[];p.taperPreviews=[];p.previewError=null;if(p.type==='ground-extrude')p.previewSolid=null;
  p.valid=h>=GROUND_EXTRUDE_POLICY.previewMinHeight;
  try{
    const angle=Number($('groundTwistAngle').value);
    if(!Number.isFinite(angle)||Math.abs(angle)>geometryApi.maximumTwistAngleDeg)throw Error('Twist angle must be between -360° and 360°.');p.twistAngleDeg=angle;const taper=pushTaperAngleValue();p.taperAngleDeg=taper;const taperMode=pushTaperModeValue();p.taperMode=taperMode;
    if(p.valid){const profiles=p.type==='ground-extrude'?[p.profile]:p.profiles,holes=p.type==='ground-extrude'?p.holes:[];
      for(const profile of profiles){if(taper!==0)p.taperPreviews!.push(geometryApi.previewGroundTaper(profile,holes,h,taper,angle,taperMode));else if(angle!==0)p.twistPreviews.push(geometryApi.previewGroundTwist(profile,holes,h,angle));else{const solid=geometryApi.createPrismRegion(profile,holes,h,'preview_ground');if(p.type==='ground-extrude')p.previewSolid=solid;}}
    }
  }catch(error){p.valid=false;p.twistPreviews=[];p.taperPreviews=[];p.previewError=errorMessage(error);}
  $('groundHeight').value=String(p.height);requestRender();return p.valid;
}
function commitGroundSweep(p:GroundExtrusionPointer):boolean {
  if(modelingOperationBusy)return true;
  const profiles=p.type==='ground-extrude'?[p.profile]:p.profiles,holes=p.type==='ground-extrude'?p.holes:[],height=p.height,angle=p.twistAngleDeg||0,taper=p.taperAngleDeg||0,taperMode=p.taperMode||pushTaperModeValue(),revision=modelRevision,profileSnapshot=JSON.stringify([profiles,holes]);
  if(objects.length+profiles.length>PROJECT_CAPACITY_POLICY.maximumObjects){toast(`The shapes would exceed the project limit of ${PROJECT_CAPACITY_POLICY.maximumObjects} objects.`);return true;}
  let cancelled=false,job:GeometryPreparedJob|null=null,returnTool:ToolName|null=null;clearToolNumericEntry();
  beginModelingOperation(taper?'Preparing tapered ground shape…':'Preparing twisted ground shape…',{progress:0,onCancel:()=>{cancelled=true;job?.cancel();}});
  void (async()=>{
    const solids:Solid[]=[];
    for(let i=0;i<profiles.length;i++){
      if(cancelled)return;
      const report=(update:ModelingProgressUpdate)=>updateModelingOperation((i+update.progress/100)*100/profiles.length,update.message);
      job=taper?geometryApi.taperGroundPrismAsync(profiles[i],holes,height,taper,report,angle,taperMode):geometryApi.twistGroundPrismAsync(profiles[i],holes,height,angle,report);
      const result=await job.promise;if(cancelled)return;solids.push(result.solid);
    }
    if(pushTaperModeValue()!==taperMode||p.taperMode!==taperMode||JSON.stringify([p.type==='ground-extrude'?[p.profile]:p.profiles,p.type==='ground-extrude'?p.holes:[]])!==profileSnapshot||pointer!==p||p.height!==height||p.twistAngleDeg!==angle||(p.taperAngleDeg||0)!==taper||pushTaperAngleValue()!==taper||Number($('groundTwistAngle').value)!==angle)throw Error('The ground profile or settings changed while the sweep was generated.');
    addPreparedGroundSweeps(profiles,holes,height,angle,p.name,solids,revision,taper,taperMode);pointer=null;returnTool=p.returnTool||tool;toast(`Created shape · ${fmt(height)} mm · ${taper?`taper ${fmt(taper)}°`:''}${taper&&angle?' · ':''}${angle?`twist ${fmt(angle)}°`:''}`);
  })().catch(error=>{if(!cancelled)toast(errorMessage(error));}).finally(()=>{endModelingOperation();if(returnTool)setTool(returnTool);requestRender();});return true;
}
function groundExtrusionPointerHeight(x:number,y:number,p:{startX:number;startY:number;ux:number;uy:number;pxPerMm:number}):number{
  const raw=((x-p.startX)*p.ux+(y-p.startY)*p.uy)/p.pxPerMm;return gridSnapValue(raw,!!$('snap')?.checked,Number($('snapStep').value||1));
}
function updateGroundExtrusionPointer(x:number,y:number):boolean{
  if(pointer?.type!=='ground-extrude')return false;previewGroundExtrusionHeight(groundExtrusionPointerHeight(x,y,pointer));$('coordinates').textContent=`Height ${fmt(pointer.height)} mm · click to create`;return true;
}
function commitGroundExtrusionPointer():boolean{
  if(pointer?.type!=='ground-extrude')return false;const p=pointer;previewGroundExtrusionParameters(p,p.height);if(!p.valid||p.height<GROUND_EXTRUDE_POLICY.previewMinHeight){toast(p.previewError||'Move upward to choose a height greater than 0.');return true;}if(p.twistAngleDeg||p.taperAngleDeg)return commitGroundSweep(p);try{addGroundPrism(p.profile,p.height,p.holes,p.name);pointer=null;setTool(p.returnTool||tool);}catch(err){pointer=p;toast(errorMessage(err));requestRender();}return true;
}
function beginGroundPatternExtrusion(profilesInput:Vec2[][],name='Pattern'):boolean{
  const profiles=profilesInput.map(loop=>loop.map(p=>[p[0],p[1]] as Vec2));if(!profiles.length||profiles.some(loop=>loop.length<3))return false;const all=profiles.flat(),[startX,startY]=debugPointerXY||[W/2,H/2],scale=groundExtrudeScreenScale(all),returnTool=tool;setTool('push');pointer={type:'ground-extrude-pattern',returnTool,profiles,name,startX,startY,...scale,height:0,valid:true};snapIndicator=null;$('coordinates').textContent='Move upward, then click to set height';updateUI();requestRender();return true;
}
function previewGroundPatternExtrusionHeight(height:number):boolean{if(pointer?.type!=='ground-extrude-pattern')return false;return previewGroundExtrusionParameters(pointer,height);}
function updateGroundPatternExtrusionPointer(x:number,y:number):boolean{if(pointer?.type!=='ground-extrude-pattern')return false;previewGroundPatternExtrusionHeight(groundExtrusionPointerHeight(x,y,pointer));$('coordinates').textContent=`Height ${fmt(pointer.height)} mm · click to create ${pointer.profiles.length} solids`;return true;}
function commitGroundPatternExtrusionPointer():boolean{if(pointer?.type!=='ground-extrude-pattern')return false;const p=pointer;previewGroundExtrusionParameters(p,p.height);if(!p.valid||p.height<GROUND_EXTRUDE_POLICY.previewMinHeight){toast(p.previewError||'Move upward to choose a height greater than 0.');return true;}if(p.twistAngleDeg||p.taperAngleDeg)return commitGroundSweep(p);try{addGroundPrismPattern(p.profiles,p.height,p.name);pointer=null;setTool(p.returnTool||tool);}catch(err){pointer=p;toast(errorMessage(err));requestRender();}return true;}

function rectanglePointerHasArea(p:any):boolean{
  if(p?.type==='draw-face'&&p.previewPoints?.length>=4){const a=p.previewPoints[0],b=p.previewPoints[2];return Math.abs(b[0]-a[0])>=TOL.minimumEdge&&Math.abs(b[1]-a[1])>=TOL.minimumEdge;}
  if(p?.type==='draw-ground'&&p.profile?.length>=4){const a=p.profile[0],b=p.profile[2];return Math.abs(b[0]-a[0])>=TOL.minimumEdge&&Math.abs(b[1]-a[1])>=TOL.minimumEdge;}
  return false;
}
function previewRectangleDimensions(width:number,height:number):boolean{
  if((pointer?.type!=='draw-face'&&pointer?.type!=='draw-ground')||pointer.shape!=='rect')return false;
  if(width<TOL.minimumEdge||height<TOL.minimumEdge)return false;
  const last=pointer.lastCorner as Vec2|undefined,sx=last&&last[0]<pointer.start[0]?-1:1,sy=last&&last[1]<pointer.start[1]?-1:1,end:[number,number]=[pointer.start[0]+sx*width,pointer.start[1]+sy*height],prof=rectanglePoints(pointer.start,end);
  pointer.lastCorner=end;
  if(pointer.type==='draw-face'){pointer.previewPoints=prof;pointer.previewClipped=faceClipPreview2(pointer.object,pointer.face,pointer.basis,prof);}
  else{pointer.profile=prof;pointer.previewWorld=[...prof.map((v:Vec2)=>[v[0],v[1],0] as Vec3),[prof[0][0],prof[0][1],0]];}
  requestRender();return true;
}
function commitRectanglePointer():boolean{
  if(pointer?.type==='draw-face'){const p=pointer;if(!rectanglePointerHasArea(p))return false;pointer=null;try{createFaceSketch(p.object,p.face,p.previewPoints,'rectangle');}catch(err){toast(errorMessage(err));}return true;}
  if(pointer?.type==='draw-ground'){const p=pointer;if(!rectanglePointerHasArea(p))return false;pointer=null;return beginGroundExtrusion(p.profile,[],'Rectangle');}
  return false;
}
const rectangleToolController:ToolController={
  name:'rect',sketchHover:true,parameters:TOOL_PARAMETERS.rectangle,
  pointerDown({x,y,hit}){
    if((pointer?.type==='draw-face'||pointer?.type==='draw-ground')&&pointer.shape==='rect')return true;
    if(hit){const o=objects.find(o=>o.id===hit.id)!,q=onFacePoint(x,y,o,hit.face,true);if(!q)return true;const startSnap=snapIndicator;pointer={type:'draw-face',shape:'rect',object:o,face:hit.face,basis:faceBasisLocal(o,hit.face),start:q.uv,startWorld:q.world,startSnapKind:startSnap?.kind||null,points:[q.uv],previewPoints:[q.uv],lastCorner:q.uv};}
    else{const p=snappedGroundPoint(x,y);if(!p)return true;const startSnap=snapIndicator;pointer={type:'draw-ground',shape:'rect',start:[p[0],p[1]],startWorld:p,startSnapKind:startSnap?.kind||null,previewWorld:[p],lastCorner:[p[0],p[1]]};}
    requestRender();return true;
  },
  pointerMove({x,y}){
    if(pointer?.type==='draw-face'){const q=onFacePoint(x,y,pointer.object,pointer.face,true);if(!q)return true;pointer.lastCorner=q.uv;pointer.previewPoints=rectanglePoints(pointer.start,q.uv);pointer.previewClipped=faceClipPreview2(pointer.object,pointer.face,pointer.basis,pointer.previewPoints);requestRender();return true;}
    if(pointer?.type==='draw-ground'){const p=snappedGroundPoint(x,y);if(!p)return true;const q:[number,number]=[p[0],p[1]],prof=rectanglePoints(pointer.start,q);pointer.lastCorner=q;pointer.previewWorld=[...prof.map((v:Vec2)=>[v[0],v[1],0] as Vec3),[prof[0][0],prof[0][1],0]];pointer.profile=prof;requestRender();return true;}
    return false;
  },
  pointerUp(){if((pointer?.type!=='draw-face'&&pointer?.type!=='draw-ground')||pointer.shape!=='rect')return false;if(numericEntry?.tool==='rect')return true;if(!rectanglePointerHasArea(pointer)){requestRender();return true;}return commitRectanglePointer();},
  numericSeed(){return (pointer?.type==='draw-face'||pointer?.type==='draw-ground')&&pointer.shape==='rect';},
  numericPreview(values){return previewRectangleDimensions(values.width,values.height);},
  numericCommit(values){if(!previewRectangleDimensions(values.width,values.height)){toast('Width and height must be greater than 0.');return false;}return commitRectanglePointer();},
  cancel(){if((pointer?.type==='draw-face'||pointer?.type==='draw-ground')&&pointer.shape==='rect')pointer=null;}
};

const CIRCLE_TOOL_POLICY=Object.freeze({defaultSegments:48,minSegments:3,maxSegments:128});
function circleSegmentCount():number{
  const el=$('circleSegments') as HTMLInputElement|null,raw=Number(el?.value||CIRCLE_TOOL_POLICY.defaultSegments),n=Math.max(CIRCLE_TOOL_POLICY.minSegments,Math.min(CIRCLE_TOOL_POLICY.maxSegments,Math.round(Number.isFinite(raw)?raw:CIRCLE_TOOL_POLICY.defaultSegments)));
  if(el)el.value=String(n);
  return n;
}
function previewCircleRadius(radius:number):boolean{
  if((pointer?.type!=='circle-face'&&pointer?.type!=='circle-ground')||radius<TOL.minimumEdge)return false;
  const segments=Math.max(CIRCLE_TOOL_POLICY.minSegments,Math.min(CIRCLE_TOOL_POLICY.maxSegments,Math.round(pointer.segments??circleSegmentCount()))),q:[number,number]=[pointer.center[0]+radius,pointer.center[1]],prof=circlePoints(pointer.center,q,segments);pointer.numericRadius=radius;pointer.segments=segments;
  if(pointer.type==='circle-face'){pointer.previewPoints=prof;pointer.previewClipped=faceClipPreview2(pointer.object,pointer.face,pointer.basis,prof);}
  else pointer.previewWorld=[...prof.map((v:Vec2)=>[v[0],v[1],0] as Vec3),[prof[0][0],prof[0][1],0]];
  requestRender();return true;
}
function commitCirclePointer(radius?:number):boolean{
  if(pointer?.type==='circle-face'){const p=pointer,r=radius??p.numericRadius,segments=Math.max(CIRCLE_TOOL_POLICY.minSegments,Math.min(CIRCLE_TOOL_POLICY.maxSegments,Math.round(p.segments??circleSegmentCount())));if(!(r>=TOL.minimumEdge))return false;const prof=circlePoints(p.center,[p.center[0]+r,p.center[1]],segments);pointer=null;try{createFaceSketch(p.object,p.face,prof,'circle',segments);}catch(err){toast(errorMessage(err));requestRender();}return true;}
  if(pointer?.type==='circle-ground'){const p=pointer,r=radius??p.numericRadius,segments=Math.max(CIRCLE_TOOL_POLICY.minSegments,Math.min(CIRCLE_TOOL_POLICY.maxSegments,Math.round(p.segments??circleSegmentCount())));if(!(r>=TOL.minimumEdge))return false;const prof=circlePoints(p.center,[p.center[0]+r,p.center[1]],segments);pointer=null;return beginGroundExtrusion(prof,[],'Circle');}
  return false;
}
const circleToolController:ToolController={
  name:'circle',sketchHover:true,parameters:TOOL_PARAMETERS.circle,
  pointerDown({x,y,hit}){
    if(pointer?.type==='circle-face'){
      const q=onFacePoint(x,y,pointer.object,pointer.face,true);if(!q)return true;const r=v2.dist(pointer.center,q.uv);
      if(r<TOL.minimumEdge){toast('The circle requires a radius.');return true;}previewCircleRadius(r);commitCirclePointer(r);return true;
    }
    if(pointer?.type==='circle-ground'){
      const g=snappedGroundPoint(x,y);if(!g)return true;const r=v2.dist(pointer.center,[g[0],g[1]]);
      if(r<TOL.minimumEdge){toast('The circle requires a radius.');return true;}previewCircleRadius(r);commitCirclePointer(r);return true;
    }
    if(hit){const o=objects.find(o=>o.id===hit.id)!,q=onFacePoint(x,y,o,hit.face,true);if(!q)return true;const startSnap=snapIndicator;pointer={type:'circle-face',object:o,face:hit.face,basis:faceBasisLocal(o,hit.face),center:q.uv,previewPoints:[q.uv],startWorld:q.world,startSnapKind:startSnap?.kind||null,segments:circleSegmentCount()};}
    else{const g=snappedGroundPoint(x,y);if(!g)return true;const startSnap=snapIndicator;pointer={type:'circle-ground',center:[g[0],g[1]],previewWorld:[g],startWorld:g,startSnapKind:startSnap?.kind||null,segments:circleSegmentCount()};}
    requestRender();return true;
  },
  pointerMove({x,y}){
    if(pointer?.type==='circle-face'){const q=onFacePoint(x,y,pointer.object,pointer.face,true);if(!q)return true;const r=v2.dist(pointer.center,q.uv);if(r>=TOL.minimumEdge)previewCircleRadius(r);return true;}
    if(pointer?.type==='circle-ground'){const p=snappedGroundPoint(x,y);if(!p)return true;const r=v2.dist(pointer.center,[p[0],p[1]]);if(r>=TOL.minimumEdge)previewCircleRadius(r);return true;}
    return false;
  },
  pointerUp(){
    if(pointer?.type!=='circle-face'&&pointer?.type!=='circle-ground')return false;
    if(numericEntry?.tool==='circle')return true;
    if(!(pointer.numericRadius>=TOL.minimumEdge)){requestRender();return true;}
    return commitCirclePointer(pointer.numericRadius);
  },
  numericSeed(){return pointer?.type==='circle-face'||pointer?.type==='circle-ground';},
  numericPreview(values){return previewCircleRadius(values.radius);},
  numericCommit(values){if(!previewCircleRadius(values.radius)){toast('Radius must be greater than 0.');return false;}return commitCirclePointer(values.radius);},
  cancel(){if(pointer?.type==='circle-face'||pointer?.type==='circle-ground')pointer=null;}
};



const groundExtrusionToolController:ToolController={
  name:'push',parameters:[{id:'height',label:'Height',unit:'mm'}],
  numericSeed(){return isGroundExtrusionPointer(pointer);},
  numericPreview(values){return previewGroundHeight(values.height);},
  numericCommit(values){if(!previewGroundHeight(values.height)){toast(isGroundExtrusionPointer(pointer)&&pointer.previewError||'Height must be greater than 0.');return false;}return commitGroundHeight();},
  cancel(){if(isGroundExtrusionPointer(pointer))pointer=null;}
};
function previewGroundHeight(height:number):boolean {
  if(!Number.isFinite(height))return false;
  const valid=pointer?.type==='ground-extrude'?previewGroundExtrusionHeight(height):pointer?.type==='ground-extrude-pattern'?previewGroundPatternExtrusionHeight(height):false;
  if(isGroundExtrusionPointer(pointer))$('groundHeight').value=String(pointer.height);return valid;
}
function commitGroundHeight():boolean {return pointer?.type==='ground-extrude'?commitGroundExtrusionPointer():commitGroundPatternExtrusionPointer();}
