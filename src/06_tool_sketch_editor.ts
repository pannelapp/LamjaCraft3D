// A modal 2D workspace owns an unsaved draft and local history. Return stages
// ordinary contours on the original support plane; a model click commits them.
type SketchEditorMode='select'|'line'|'rectangle'|'circle'|'arc'|'guide'|'measure';
interface SketchEditorDraft {
  object:ModelObject;solid:Solid;transform:Transform;revision:number;faceId:FaceId;frame:PlaneBasis;gridFrame:PlaneBasis;reference:Vec2[][];
  phase:'editing'|'placing';paths:SketchDraftPath[];undo:SketchDraftPath[][];redo:SketchDraftPath[][];
  mode:SketchEditorMode;pending:Vec2[];cursor:Vec2|null;snap:string;selected:number;
  zoom:number;center:Vec2;width:number;height:number;loops:Vec2[][];placement:Vec2|null;problems:Vec2[];
  pan:{x:number;y:number;center:Vec2}|null;
  drag:{before:SketchDraftPath[];point:Vec2}|null;
}
const SKETCH_EDITOR_POLICY=Object.freeze({snapRadiusPx:10,fitFraction:.75,minimumSpan:40,minimumZoom:.02,maximumZoom:2000,zoomWheelFactor:.001,historyLimit:100,curveSegments:64,gridPixelSpacing:12,pointRadiusPx:3,selectionRadiusPx:8,maximumGridLines:300});
let sketchEditorDraft:SketchEditorDraft|null=null;
const sketchEditorCanvas=$('sketchEditorCanvas') as HTMLCanvasElement;
function cloneSketchPaths(paths:readonly SketchDraftPath[]):SketchDraftPath[]{return paths.map(p=>({kind:p.kind,points:p.points.map(q=>[...q])}));}
function sketchEditorCurrent(d:SketchEditorDraft):boolean {
  const o=objects.find(o=>o.id===d.object.id);
  return o===d.object&&o.solid===d.solid&&modelRevision===d.revision&&isObjectVisible(o)&&!isObjectLocked(o)&&!groupForObjectId(o.id)&&o.transform.position.every((v,i)=>v===d.transform.position[i])&&o.transform.rotation.every((v,i)=>v===d.transform.rotation[i]);
}
function cancelSketchEditor():void{sketchEditorDraft=null;if($('sketchEditorDialog').open)$('sketchEditorDialog').close();$('sketchPlacementBar').classList.add('hidden');requestRender();}
function startSketchEditor(object:ModelObject,faceId:FaceId):boolean {
  if(modelingOperationBusy||object.kind==='surface'||!isObjectVisible(object)||groupForObjectId(object.id)||!allowObjectEdit(object))return false;
  if(!geometryApi.hasFace(object.solid,faceId))return false;
  const loops=geometryApi.faceLoops(object.solid,faceId),gridFrame=geometryApi.faceBasis(object.solid,faceId),frame={...gridFrame,origin:geometryApi.faceCentroid(object.solid,faceId)};
  sketchEditorDraft={object,solid:object.solid,transform:{position:[...object.transform.position],rotation:[...object.transform.rotation]},revision:modelRevision,faceId,frame,gridFrame,reference:[loops.outer,...loops.holes].map(loop=>loop.map(p=>toPlane2(p,frame))),phase:'editing',paths:[],undo:[],redo:[],mode:'line',pending:[],cursor:null,snap:'',selected:-1,zoom:1,center:[0,0],width:1,height:1,loops:[],placement:null,problems:[],pan:null,drag:null};
  const selected=selectedFaceRef();if(selected?.objectId!==object.id||selected.faceId!==faceId)setSelectedFace(object,faceId);
  $('sketchEditorDialog').showModal();resizeSketchEditor();fitSketchEditor();sketchEditorStatus('Draw a contour in several steps. Return validates it before placement.');return true;
}
function sketchEditorStatus(message:string):void{$('sketchEditorStatus').textContent=message;}
function resizeSketchEditor():void {
  const d=sketchEditorDraft;if(!d||d.phase!=='editing')return;
  const rect=sketchEditorCanvas.getBoundingClientRect();d.width=Math.max(1,rect.width);d.height=Math.max(1,rect.height);
  sketchEditorCanvas.width=Math.round(d.width*devicePixelRatio);sketchEditorCanvas.height=Math.round(d.height*devicePixelRatio);drawSketchEditor();
}
function fitSketchEditor():void {
  const d=sketchEditorDraft;if(!d)return;
  const pts=d.paths.flatMap(p=>p.points);if(!pts.length)pts.push(...d.reference[0]);
  const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]),min:Vec2=[Math.min(...xs),Math.min(...ys)],max:Vec2=[Math.max(...xs),Math.max(...ys)];
  d.center=[(min[0]+max[0])/2,(min[1]+max[1])/2];d.zoom=clamp(SKETCH_EDITOR_POLICY.fitFraction*Math.min(d.width/Math.max(SKETCH_EDITOR_POLICY.minimumSpan,max[0]-min[0]),d.height/Math.max(SKETCH_EDITOR_POLICY.minimumSpan,max[1]-min[1])),SKETCH_EDITOR_POLICY.minimumZoom,SKETCH_EDITOR_POLICY.maximumZoom);drawSketchEditor();
}
function sketchEditorScreen(p:Vec2,d:SketchEditorDraft):Vec2{return [d.width/2+(p[0]-d.center[0])*d.zoom,d.height/2-(p[1]-d.center[1])*d.zoom];}
function sketchEditorRaw(x:number,y:number,d:SketchEditorDraft):Vec2{return [d.center[0]+(x-d.width/2)/d.zoom,d.center[1]-(y-d.height/2)/d.zoom];}
function sketchEditorGridStep():number{const n=Number($('sketchEditorGrid').value);return Number.isFinite(n)&&n>0?n:1;}
function sketchEditorPoint(x:number,y:number,shift=false):Vec2 {
  const d=sketchEditorDraft!,raw=sketchEditorRaw(x,y,d),edges:SnapEdge[]=[],guides:ConstructionGuide[]=[],to3=(p:Vec2):Vec3=>[p[0],p[1],0];
  for(const [index,path] of (d.drag?.before||d.paths).entries()){
    if(d.drag&&path.points.some(p=>v2.dist(p,d.drag!.point)<=SKETCH_CONTOUR_POLICY.joinTolerance))continue;
    if(path.kind==='measure')continue;
    if(path.kind==='guide'&&path.points.length>1){guides.push({id:'sketch-guide-'+index,kind:'line',point:to3(path.points[0]),direction:V.sub(to3(path.points[1]),to3(path.points[0]))});continue;}
    for(let i=1;i<path.points.length;i++)edges.push({a:to3(path.points[i-1]),b:to3(path.points[i])});
  }
  for(let i=1;i<d.pending.length;i++)edges.push({a:to3(d.pending[i-1]),b:to3(d.pending[i])});
  if(d.pending.length===1)guides.push({id:'sketch-pending',kind:'point',point:to3(d.pending[0])});
  const anchor=d.pending.at(-1),snap=bestSnapCandidate({x,y,rawWorld:to3(raw),edges,guides,plane:{point:[0,0,0],normal:[0,0,1]},project:p=>{const q=sketchEditorScreen([p[0],p[1]],d);return [q[0],q[1],1];},radiusPx:SKETCH_EDITOR_POLICY.snapRadiusPx,geometryEnabled:true,guideEnabled:true,inferenceEnabled:!!anchor,inference:anchor?{origin:to3(anchor),referenceDirections:[[1,0,0],[0,1,0]]}:undefined}).best;
  let point:Vec2=snap?[snap.world[0],snap.world[1]]:raw;d.snap=snap?.kind||'';
  if(!snap&&$('sketchEditorSnapGrid').checked){const step=sketchEditorGridStep();point=[gridSnapValue(raw[0],true,step),gridSnapValue(raw[1],true,step)];d.snap='Grid';}
  if(shift&&anchor){point=Math.abs(point[0]-anchor[0])>=Math.abs(point[1]-anchor[1])?[point[0],anchor[1]]:[anchor[0],point[1]];d.snap='Axis';}
  return point;
}
function setSketchEditorMode(mode:SketchEditorMode):void{const d=sketchEditorDraft;if(!d)return;d.mode=mode;d.pending=[];d.cursor=null;d.selected=-1;d.problems=[];drawSketchEditor();sketchEditorStatus(mode==='arc'?'Arc: start, end, then a point on the curve.':mode==='line'?'Line: click successive endpoints. Escape ends this chain; continue from an endpoint later.':mode==='select'?'Select a stroke; drag a shared endpoint to reshape it. Delete removes the selected stroke.':`${mode[0].toUpperCase()+mode.slice(1)}: choose two points.`);}
function rememberSketchEdit(before:SketchDraftPath[]):void{const d=sketchEditorDraft!;d.undo.push(before);if(d.undo.length>SKETCH_EDITOR_POLICY.historyLimit)d.undo.shift();d.redo=[];d.problems=[];}
function appendSketchEditorPath(path:SketchDraftPath):boolean {
  const d=sketchEditorDraft;if(!d||path.points.length<2)return false;
  if(path.points.some(p=>!p.every(Number.isFinite))||path.points.some((p,i)=>i>0&&v2.dist(p,path.points[i-1])<TOL.minimumEdge)){sketchEditorStatus('Choose different points with a usable distance.');return false;}
  if(d.paths.reduce((n,p)=>n+p.points.length-1,0)+path.points.length-1>SKETCH_CONTOUR_POLICY.maximumSegments){sketchEditorStatus(`Use at most ${SKETCH_CONTOUR_POLICY.maximumSegments} sketch segments.`);return false;}
  rememberSketchEdit(cloneSketchPaths(d.paths));d.paths.push(...cloneSketchPaths([path]));d.selected=-1;d.problems=[];drawSketchEditor();return true;
}
function sketchEditorShape(mode:SketchEditorMode,points:Vec2[],cursor:Vec2):Vec2[] {
  const a=points[0];if(!a)return [];
  if(mode==='rectangle')return [a,[cursor[0],a[1]],cursor,[a[0],cursor[1]],a];
  if(mode==='circle'){const radius=v2.dist(a,cursor);return Array.from({length:SKETCH_EDITOR_POLICY.curveSegments+1},(_,i)=>{if(i===SKETCH_EDITOR_POLICY.curveSegments)return [a[0]+radius,a[1]] as Vec2;const t=i/SKETCH_EDITOR_POLICY.curveSegments*Math.PI*2;return [a[0]+radius*Math.cos(t),a[1]+radius*Math.sin(t)] as Vec2;});}
  if(mode==='arc'&&points.length===2)return geometryApi.sketchEditorArc(points[0],cursor,points[1],SKETCH_EDITOR_POLICY.curveSegments);
  return [a,cursor];
}
function sketchEditorClick(point:Vec2):void {
  const d=sketchEditorDraft;if(!d||d.phase!=='editing')return;
  if(d.mode==='select')return;
  if(!d.pending.length){d.pending=[point];drawSketchEditor();return;}
  if(d.mode==='arc'&&d.pending.length===1){if(v2.dist(point,d.pending[0])>=TOL.minimumEdge)d.pending.push(point);drawSketchEditor();return;}
  try{
    const points=sketchEditorShape(d.mode,d.pending,point);
    if(appendSketchEditorPath({kind:d.mode,points})){d.pending=d.mode==='line'?[point]:[];sketchEditorStatus(d.mode==='line'?'Segment added. Continue drawing, or Escape to end the chain.':'Stroke added. Draw another, or Return to place the closed contours.');}
  }catch(error){sketchEditorStatus(errorMessage(error));}
  drawSketchEditor();
}
function sketchEditorUndo(redo=false):void {
  const d=sketchEditorDraft;if(!d||d.phase!=='editing')return;
  if(d.drag)d.paths=d.drag.before;
  d.pending=[];d.drag=null;const source=redo?d.redo:d.undo,destination=redo?d.undo:d.redo,next=source.pop();if(next){destination.push(cloneSketchPaths(d.paths));d.paths=next;}d.selected=-1;d.problems=[];drawSketchEditor();
}
function deleteSketchEditorStroke():void{const d=sketchEditorDraft;if(!d||d.selected<0)return;rememberSketchEdit(cloneSketchPaths(d.paths));d.paths.splice(d.selected,1);d.selected=-1;drawSketchEditor();}
function returnFromSketchEditor():boolean {
  const d=sketchEditorDraft;if(!d||d.phase!=='editing')return false;
  if(!sketchEditorCurrent(d)){cancelSketchEditor();toast('The support changed. Choose the face and start a new sketch.');return false;}
  const result=geometryApi.validateSketchDraft(d.paths);if(!result.ok){d.problems=result.points;sketchEditorStatus(result.message);drawSketchEditor();return false;}
  d.loops=result.loops;d.phase='placing';d.pending=[];d.drag=null;d.placement=null;$('sketchEditorDialog').close();$('sketchPlacementBar').classList.remove('hidden');clearHover();snapIndicator=null;requestRender();return true;
}
function reopenSketchEditor():void{const d=sketchEditorDraft;if(!d)return;d.phase='editing';d.placement=null;$('sketchPlacementBar').classList.add('hidden');$('sketchEditorDialog').showModal();resizeSketchEditor();sketchEditorStatus('Continue editing. Return validates the contours again.');}
function updateSketchEditorPlacement(x:number,y:number):boolean {
  const d=sketchEditorDraft;if(!d||d.phase!=='placing')return false;
  if(!sketchEditorCurrent(d)){cancelSketchEditor();toast('The support changed. Choose the face and start a new sketch.');return true;}
  const hit=hitTest(x,y);if(!hit||hit.id!==d.object.id){d.placement=null;snapIndicator=null;requestRender();return true;}
  const hitPlane=geometryApi.faceMetadata(d.solid,hit.face).plane;
  if(V.dot(hitPlane.normal,d.frame.normal)<1-TOL.coplanarAngle||Math.abs(V.dot(hitPlane.normal,d.frame.origin)-hitPlane.offset)>TOL.plane){d.placement=null;snapIndicator=null;requestRender();return true;}
  // The unchanged source owns an already prepared frame. Hover must not request
  // full face views/areas, copy boundaries or triangulate this potentially large
  // support again. SnapEngine reuses the ordinary immutable world snap arrays.
  const plane={point:transformPoint(d.frame.origin,d.transform),normal:transformDir(d.frame.normal,d.transform)},raw=intersectPlaneWorld(x,y,plane.point,plane.normal);
  if(!raw){d.placement=null;snapIndicator=null;requestRender();return true;}
  const snapped=bestWorldEdgeSnap(x,y,raw,faceSnapEdges(d.object,d.faceId),plane,[transformDir(d.frame.u,d.transform),transformDir(d.frame.v,d.transform)],true,faceSnapCenters(d.object,d.faceId));
  snapIndicator=snapped;let local=inverseTransformPoint(snapped?.world||raw,d.transform);
  if(!snapped){const grid=toPlane2(local,d.gridFrame);local=fromPlane2([snapValue(grid[0]),snapValue(grid[1])],d.gridFrame);}
  d.placement=toPlane2(local,d.frame);
  $('coordinates').textContent=d.placement?'Sketch origin · click to insert on the source face · Esc to edit':'Move onto the source face';requestRender();return true;
}
function commitSketchEditorPlacement():boolean {
  const d=sketchEditorDraft;if(!d||d.phase!=='placing'||!d.placement||!sketchEditorCurrent(d))return false;
  const offset=d.placement,loops=d.loops.map(loop=>loop.map(p=>fromPlane2([p[0]+offset[0],p[1]+offset[1]],d.frame)));
  try{insertEditorSketch(d.object.id,d.faceId,loops);cancelSketchEditor();clearHover();toast('Sketch inserted. Its regions are ready for Push/Pull.');return true;}
  catch(error){
    // A rejected command restores the entire document. Rebind only after that
    // known rollback, so the user can edit or retry this unchanged draft.
    const restored=objects.find(o=>o.id===d.object.id);if(restored){d.object=restored;d.solid=restored.solid;d.revision=modelRevision;}
    toast(errorMessage(error));return false;
  }
}
function drawSketchEditorPlacement():void {
  const d=sketchEditorDraft;if(!ctx||!d||d.phase!=='placing'||!d.placement)return;
  for(const loop of d.loops){const world=loop.map(p=>transformPoint(fromPlane2([p[0]+d.placement![0],p[1]+d.placement![1]],d.frame),d.object.transform));path3([...world,world[0]],'#137c69',false,2.5);}
  const p=project(transformPoint(fromPlane2(d.placement,d.frame),d.object.transform));label('Sketch origin',[p[0],p[1]-18],'#137c69',true);
}
const sketchEditorToolController:ToolController={
  name:'sketcheditor',parameters:[],
  pointerDown({x,y,hit}){if(sketchEditorDraft?.phase==='placing'){updateSketchEditorPlacement(x,y);commitSketchEditorPlacement();return true;}if(hit)return startSketchEditor(requireObject(hit.id),hit.face);toast('Choose a planar face to start Sketch Editor.');return true;},
  cancel(){cancelSketchEditor();},
  cancelStep(){if(!sketchEditorDraft)return false;if(sketchEditorDraft.phase==='placing'){reopenSketchEditor();return true;}cancelSketchEditor();return true;},
};
function handleSketchEditorKeyDown(event:KeyboardEvent):boolean {
  const d=sketchEditorDraft;if(!d)return false;
  if(d.phase==='placing')return false;
  const key=event.key.toLowerCase(),mod=event.ctrlKey||event.metaKey,editing=['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName||'');
  if(event.isComposing)return true;
  if(key==='escape'){event.preventDefault();if(editing){(document.activeElement as HTMLElement|null)?.blur();return true;}if(d.pan)d.pan=null;else if(d.drag){d.paths=d.drag.before;d.drag=null;}else if(d.pending.length)d.pending=[];else cancelSketchEditor();drawSketchEditor();return true;}
  if(editing)return true;
  if(document.activeElement?.tagName==='BUTTON'&&(key==='enter'||key===' '))return true;
  if(mod&&key==='z'){event.preventDefault();sketchEditorUndo(event.shiftKey);return true;}
  if(mod&&key==='y'){event.preventDefault();sketchEditorUndo(true);return true;}
  if(mod)return true;
  if(key==='delete'||key==='backspace'){event.preventDefault();deleteSketchEditorStroke();return true;}
  if(key==='enter'){event.preventDefault();returnFromSketchEditor();return true;}
  const modes:Record<string,SketchEditorMode>={v:'select',l:'line',r:'rectangle',c:'circle',a:'arc',g:'guide',t:'measure'};
  if(modes[key]){event.preventDefault();setSketchEditorMode(modes[key]);}else if(key==='f'){event.preventDefault();fitSketchEditor();}
  return true;
}

function drawSketchEditor():void {
  const d=sketchEditorDraft;if(!d||d.phase!=='editing')return;const c=sketchEditorCanvas.getContext('2d');if(!c)return;
  c.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);c.clearRect(0,0,d.width,d.height);c.fillStyle='#fafcfd';c.fillRect(0,0,d.width,d.height);
  const line=(pts:Vec2[],color:string,dashed=false,width=1)=>{if(!pts.length)return;c.beginPath();pts.forEach((p,i)=>{const q=sketchEditorScreen(p,d);if(i)c.lineTo(...q);else c.moveTo(...q);});c.strokeStyle=color;c.lineWidth=width;c.setLineDash(dashed?[6,5]:[]);c.stroke();c.setLineDash([]);};
  const lower=sketchEditorRaw(0,d.height,d),upper=sketchEditorRaw(d.width,0,d);let step=sketchEditorGridStep();
  while(step*d.zoom<SKETCH_EDITOR_POLICY.gridPixelSpacing||Math.max(d.width,d.height)/(step*d.zoom)>SKETCH_EDITOR_POLICY.maximumGridLines)step*=10;
  for(let x=Math.ceil(lower[0]/step)*step;x<=upper[0];x+=step)line([[x,lower[1]],[x,upper[1]]],'#e4ebef');
  for(let y=Math.ceil(lower[1]/step)*step;y<=upper[1];y+=step)line([[lower[0],y],[upper[0],y]],'#e4ebef');
  line([[lower[0],0],[upper[0],0]],'#d88787');line([[0,lower[1]],[0,upper[1]]],'#8cae92');
  if($('sketchEditorReference').checked)for(const points of d.reference)line([...points,points[0]],'#b9c4ca',true);
  const dot=(p:Vec2,color:string,r:number=SKETCH_EDITOR_POLICY.pointRadiusPx)=>{const q=sketchEditorScreen(p,d);c.beginPath();c.arc(q[0],q[1],r,0,Math.PI*2);c.fillStyle=color;c.fill();};
  for(const [index,path] of d.paths.entries()){
    let points=path.points;if(path.kind==='guide'&&points.length===2){const a=points[0],b=points[1],length=v2.dist(a,b),extent=(d.width+d.height)/d.zoom;if(length>TOL.minimumEdge){const dx=(b[0]-a[0])/length*extent,dy=(b[1]-a[1])/length*extent;points=[[a[0]-dx,a[1]-dy],[a[0]+dx,a[1]+dy]];}}
    line(points,index===d.selected?'#d68a20':path.kind==='guide'?'#7099b0':path.kind==='measure'?'#9473ae':'#176d61',path.kind==='guide'||path.kind==='measure',index===d.selected?3:2);
    if(path.kind==='measure'){const a=sketchEditorScreen(path.points[0],d),b=sketchEditorScreen(path.points[1],d);c.fillStyle='#785d91';c.font='13px sans-serif';c.fillText(fmt(v2.dist(path.points[0],path.points[1]))+' mm',(a[0]+b[0])/2+8,(a[1]+b[1])/2-8);}
    if(path.kind==='line'||d.mode==='select'){dot(path.points[0],'#176d61');dot(path.points[path.points.length-1],'#176d61');}
  }
  if(d.pending.length&&d.cursor){try{line(sketchEditorShape(d.mode,d.pending,d.cursor),'#df9c30',false,2);}catch{line([...d.pending,d.cursor],'#c85b51',false,2);}}
  for(const p of d.pending)dot(p,'#df9c30');for(const p of d.problems)dot(p,'#c44343',5);
  if(d.cursor){dot(d.cursor,'#167fbc',4);const q=sketchEditorScreen(d.cursor,d);c.fillStyle='#436374';c.font='12px sans-serif';c.fillText(`${fmt(d.cursor[0])}, ${fmt(d.cursor[1])} mm${d.snap?' · '+d.snap:''}`,q[0]+12,q[1]-12);}
  for(const button of qsa('[data-sketch-mode]'))button.classList.toggle('active',button.dataset.sketchMode===d.mode);
  $('sketchEditorUndo').disabled=!d.undo.length;$('sketchEditorRedo').disabled=!d.redo.length;$('sketchEditorDelete').disabled=d.selected<0;
  $('sketchEditorScale').textContent=`Grid ${fmt(step)} mm · origin = placement anchor · ${d.paths.filter(p=>p.kind!=='guide'&&p.kind!=='measure').length} strokes`;
}

function sketchEditorEventPoint(event:PointerEvent|WheelEvent):Vec2{const rect=sketchEditorCanvas.getBoundingClientRect();return [event.clientX-rect.left,event.clientY-rect.top];}
sketchEditorCanvas.addEventListener('pointerdown',event=>{
  const d=sketchEditorDraft;if(!d)return;event.preventDefault();sketchEditorCanvas.focus();sketchEditorCanvas.setPointerCapture(event.pointerId);const [x,y]=sketchEditorEventPoint(event);
  if(event.button===1||event.button===2){d.pan={x,y,center:[...d.center]};return;}if(event.button!==0)return;
  if(d.mode==='select'){
    const raw=sketchEditorRaw(x,y,d),radius=SKETCH_EDITOR_POLICY.selectionRadiusPx/d.zoom;d.selected=-1;let best=radius;
    for(const [index,path] of d.paths.entries())for(let i=1;i<path.points.length;i++){const p=path.points[i-1],q=path.points[i],dx=q[0]-p[0],dy=q[1]-p[1],length2=dx*dx+dy*dy,t=length2?clamp(((raw[0]-p[0])*dx+(raw[1]-p[1])*dy)/length2,0,1):0,dist=v2.dist(raw,[p[0]+t*dx,p[1]+t*dy]);if(dist<best){best=dist;d.selected=index;}}
    let point:Vec2|null=null,pointDistance=radius;for(const path of d.paths)for(const p of path.points){const distance=v2.dist(p,raw);if(distance<pointDistance){pointDistance=distance;point=p;}}
    if(point)d.drag={before:cloneSketchPaths(d.paths),point:[...point]};drawSketchEditor();return;
  }
  sketchEditorClick(sketchEditorPoint(x,y,event.shiftKey));
});
sketchEditorCanvas.addEventListener('pointermove',event=>{
  const d=sketchEditorDraft;if(!d)return;const [x,y]=sketchEditorEventPoint(event);
  if(d.pan){d.center=[d.pan.center[0]-(x-d.pan.x)/d.zoom,d.pan.center[1]+(y-d.pan.y)/d.zoom];drawSketchEditor();return;}
  d.cursor=sketchEditorPoint(x,y,event.shiftKey);
  if(d.drag){const drag=d.drag;d.paths=cloneSketchPaths(drag.before);for(const path of d.paths)for(let i=0;i<path.points.length;i++)if(v2.dist(path.points[i],drag.point)<=SKETCH_CONTOUR_POLICY.joinTolerance)path.points[i]=[...d.cursor];}
  drawSketchEditor();
});
sketchEditorCanvas.addEventListener('pointerup',()=>{const d=sketchEditorDraft;if(!d)return;d.pan=null;if(d.drag){const before=d.drag.before;d.drag=null;if(JSON.stringify(before)!==JSON.stringify(d.paths))rememberSketchEdit(before);}drawSketchEditor();});
sketchEditorCanvas.addEventListener('pointercancel',()=>{const d=sketchEditorDraft;if(!d)return;if(d.drag)d.paths=d.drag.before;d.drag=null;d.pan=null;drawSketchEditor();});
sketchEditorCanvas.addEventListener('contextmenu',event=>event.preventDefault());
sketchEditorCanvas.addEventListener('wheel',event=>{const d=sketchEditorDraft;if(!d)return;event.preventDefault();const [x,y]=sketchEditorEventPoint(event),before=sketchEditorRaw(x,y,d);d.zoom=clamp(d.zoom*Math.exp(-event.deltaY*SKETCH_EDITOR_POLICY.zoomWheelFactor),SKETCH_EDITOR_POLICY.minimumZoom,SKETCH_EDITOR_POLICY.maximumZoom);const after=sketchEditorRaw(x,y,d);d.center=[d.center[0]+before[0]-after[0],d.center[1]+before[1]-after[1]];drawSketchEditor();},{passive:false});
new ResizeObserver(resizeSketchEditor).observe(sketchEditorCanvas);
for(const button of qsa('[data-sketch-mode]'))button.onclick=()=>setSketchEditorMode(button.dataset.sketchMode as SketchEditorMode);
$('sketchEditorUndo').onclick=()=>sketchEditorUndo();$('sketchEditorRedo').onclick=()=>sketchEditorUndo(true);$('sketchEditorDelete').onclick=deleteSketchEditorStroke;
$('sketchEditorFit').onclick=fitSketchEditor;$('sketchEditorReturn').onclick=returnFromSketchEditor;$('sketchEditorCancel').onclick=cancelSketchEditor;
$('sketchPlacementEdit').onclick=reopenSketchEditor;$('sketchPlacementCancel').onclick=cancelSketchEditor;
$('sketchEditorReference').onchange=drawSketchEditor;$('sketchEditorGrid').onchange=drawSketchEditor;
$('sketchEditorDialog').addEventListener('cancel',(event:Event)=>{event.preventDefault();handleSketchEditorKeyDown({key:'Escape',preventDefault(){}} as KeyboardEvent);});
$('sketchEditorExact').onclick=()=>{
  const d=sketchEditorDraft;if(!d||!d.pending.length)return;const a=d.pending.at(-1)!,first=Number($('sketchEditorValueA').value),second=Number($('sketchEditorValueB').value);
  if(!Number.isFinite(first)||!Number.isFinite(second)){sketchEditorStatus('Enter finite values.');return;}
  if(d.mode==='rectangle')sketchEditorClick([a[0]+first,a[1]+second]);
  else if(d.mode==='circle'){if(first<=0){sketchEditorStatus('Radius must be positive.');return;}sketchEditorClick([a[0]+first,a[1]]);}
  else if(d.mode==='line'||d.mode==='guide'||d.mode==='measure')sketchEditorClick([a[0]+first,a[1]+second]);
  else sketchEditorStatus('Use exact values for Line, Rectangle, Circle, Guide or Measure.');
};
