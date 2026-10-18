let splitSurfaceMode:'split'|'edit'='split',splitSurfaceSelectedPoint:number|null=null,splitSurfaceUIKey='';
function assertSplitSurfacePreviewFinished():void {
  const pending=pointer?.suspendedPointer||pointer;
  if(pending?.type==='split-surface-bend')throw Error('Finish or cancel the active surface bend preview before saving or exporting.');
  if((pending?.type==='split-plane-move'||pending?.type==='split-plane-rotate')&&guidePlaneById(pending.guideId)?.surface)throw Error('Finish or cancel the curved split plane placement before saving or exporting.');
}
function splitSurfaceGuideFrame(g:GuidePlane):SplitSurfaceFrame{return {origin:[...g.origin] as Vec3,normal:[...g.normal] as Vec3,axis:g.axis?[...g.axis] as Vec3:splitPlaneDefaultAxis(g.normal)};}
function splitSurfaceGridFromUI():SplitSurfaceGrid {
  const width=numberValue('splitSurfaceWidth'),height=numberValue('splitSurfaceHeight'),columns=numberValue('splitSurfaceColumns'),rows=numberValue('splitSurfaceRows');
  if(!Number.isInteger(columns)||!Number.isInteger(rows)||columns<SPLIT_SURFACE_POLICY.minimumPoints||rows<SPLIT_SURFACE_POLICY.minimumPoints||columns>SPLIT_SURFACE_POLICY.maximumPoints||rows>SPLIT_SURFACE_POLICY.maximumPoints)throw Error('Choose between 2 and 30 grid points on each axis.');return validateSplitSurface({width,height,columns,rows,heights:Array(columns*rows).fill(0)});
}
function createSplitSurfaceFromUI():void {
  if(modelingOperationBusy)return;try{prepareToolForDocumentChange();const g=createSplitSurfaceGuide(splitSurfaceGridFromUI());splitSurfaceMode='edit';splitSurfaceSelectedPoint=null;activateSplitPlane(g.id);setTool('splitplane');toast('Drag grid points to bend the surface. Influence radius controls the surrounding bend.');}catch(error){toast(errorMessage(error));}
}
function updateSplitSurfaceUI():void {
  const g=activeSplitPlane(),grid=g?.surface,key=grid?`${g.id}|${grid.width}|${grid.height}|${grid.columns}|${grid.rows}`:'';
  $('splitSurfaceMode').value=splitSurfaceMode;$('splitSurfaceOptions').classList.toggle('hidden',splitSurfaceMode!=='edit'&&!grid);
  if(key!==splitSurfaceUIKey){splitSurfaceUIKey=key;splitSurfaceSelectedPoint=null;if(grid){$('splitSurfaceWidth').value=String(grid.width);$('splitSurfaceHeight').value=String(grid.height);$('splitSurfaceColumns').value=String(grid.columns);$('splitSurfaceRows').value=String(grid.rows);}}
  $('splitSurfacePointStatus').textContent=grid?(splitSurfaceSelectedPoint===null?'Choose a grid point to bend.':`Point ${splitSurfaceSelectedPoint+1} · height ${fmt(grid.heights[splitSurfaceSelectedPoint]||0)} mm`):'Create a flat grid first.';
  for(const id of ['saveSplitSurfaceTemplate','resetSplitSurface','bendSplitSurfacePoint'])$(id).disabled=modelingOperationBusy||!grid||id==='bendSplitSurfacePoint'&&splitSurfaceSelectedPoint===null;
  $('createSplitSurface').disabled=modelingOperationBusy;$('splitSurfaceMode').disabled=modelingOperationBusy;$('loadSplitSurfaceTemplate').disabled=modelingOperationBusy;$('splitPlaneMoveAxis').disabled=modelingOperationBusy;$('splitPlaneTiltAxis').disabled=modelingOperationBusy;
}
function splitSurfacePointHit(x:number,y:number,g:GuidePlane):number|null {
  if(!g.surface)return null;const points=splitSurfaceWorldPoints(g.surface,splitSurfaceGuideFrame(g));let best:number|null=null;let distance:number=SPLIT_SURFACE_POLICY.pointPickPixels;
  for(let i=0;i<points.length;i++){const p=project(points[i]),d=Math.hypot(x-p[0],y-p[1]);if(p[2]>0&&d<distance){best=i;distance=d;}}return best;
}
function beginSplitSurfaceBend(g:GuidePlane,index:number,x:number,y:number):void {
  if(!g.surface)return;const startGrid=validateSplitSurface(g.surface),point=splitSurfaceWorldPoints(startGrid,splitSurfaceGuideFrame(g))[index],p=project(point),q=project(V.add(point,V.mul(g.normal,SPLIT_SURFACE_POLICY.pointDragProbeMm))),dx=q[0]-p[0],dy=q[1]-p[1],length=Math.hypot(dx,dy),radius=numberValue('splitSurfaceRadius');
  bendSplitSurface(startGrid,index,0,radius);splitSurfaceSelectedPoint=index;pointer={type:'split-surface-bend',guideId:g.id,index,startGrid,startX:x,startY:y,radius,screenDir:length>SPLIT_SURFACE_POLICY.minimumDragPixels?[dx/length,dy/length]:[0,-1],pixelsPerMm:length>SPLIT_SURFACE_POLICY.minimumDragPixels?length/SPLIT_SURFACE_POLICY.pointDragProbeMm:Math.max(SPLIT_SURFACE_POLICY.minimumPixelsPerMm,H/Math.max(SPLIT_SURFACE_POLICY.fallbackMinimumSpan,camera.distance*SPLIT_SURFACE_POLICY.fallbackCameraFactor)),distance:0};setSelection({kind:'guide',guideId:g.id},false);updateSplitSurfaceUI();requestRender();
}
function updateSplitSurfaceBend(x:number,y:number):boolean {
  if(pointer?.type!=='split-surface-bend')return false;const p=pointer,g=guidePlaneById(p.guideId);if(!g)return true;let distance=((x-p.startX)*p.screenDir[0]+(y-p.startY)*p.screenDir[1])/p.pixelsPerMm;
  if($('snap')?.checked){const step=Math.max(SPLIT_SURFACE_POLICY.minimumSnapStepMm,Number($('snapStep').value||1));distance=Math.round(distance/step)*step;}
  try{g.surface=bendSplitSurface(p.startGrid,p.index,distance,p.radius);p.distance=distance;$('coordinates').textContent=`Surface bend ${distance>=0?'+':''}${fmt(distance)} mm · radius ${fmt(p.radius)} mm`;updateSplitSurfaceUI();requestRender();}catch(error){toast(errorMessage(error));}return true;
}
function cancelSplitSurfaceBend():void {if(pointer?.type!=='split-surface-bend')return;const g=guidePlaneById(pointer.guideId);if(g)g.surface=validateSplitSurface(pointer.startGrid);pointer=null;requestRender();}
function commitSplitSurfaceBend():boolean {
  if(pointer?.type!=='split-surface-bend')return false;const p=pointer,g=guidePlaneById(p.guideId),finalGrid=g?.surface?validateSplitSurface(g.surface):null;cancelSplitSurfaceBend();
  if(g&&finalGrid&&p.distance!==0)try{setGuideSplitSurface(g.id,finalGrid);}catch(error){toast(errorMessage(error));}updateUI();return true;
}
function bendSelectedSplitSurface():void {
  if(modelingOperationBusy)return;const g=activeSplitPlane();if(!g?.surface||splitSurfaceSelectedPoint===null)return;try{prepareToolForDocumentChange();const grid=bendSplitSurface(g.surface,splitSurfaceSelectedPoint,numberValue('splitSurfaceDistance'),numberValue('splitSurfaceRadius'));setGuideSplitSurface(g.id,grid);toast('Split surface bent.');}catch(error){toast(errorMessage(error));}
}
function splitSurfaceTemplate(g:GuidePlane):{format:string;version:number;name:string;surface:SplitSurfaceGrid}{if(!g.surface)throw Error('Choose a curved split surface first.');return {format:'lamjacraft-split-surface-template',version:1,name:g.label||'Curved split surface',surface:validateSplitSurface(g.surface)};}
function validateSplitSurfaceTemplate(value:unknown):{name:string;surface:SplitSurfaceGrid} {
  if(!value||typeof value!=='object')throw Error('This file is not a split surface template.');const t=value as Record<string,unknown>;if(t.format!=='lamjacraft-split-surface-template'||t.version!==1)throw Error('This file is not a split surface template.');return {name:typeof t.name==='string'?t.name.slice(0,80):'Curved split surface',surface:validateSplitSurface(t.surface)};
}
function loadSplitSurfaceTemplate(value:unknown):GuidePlane {if(modelingOperationBusy)throw Error('Finish or cancel the current operation before loading a template.');const template=validateSplitSurfaceTemplate(value);prepareToolForDocumentChange();const g=createSplitSurfaceGuide(template.surface,template.name);splitSurfaceMode='edit';activateSplitPlane(g.id);setTool('splitplane');return g;}
async function runSplitSurfaceFromUI(o:ModelObject,g:GuidePlane):Promise<void> {
  if(modelingOperationBusy)return;let source:SplitSurfaceSource;try{prepareToolForDocumentChange();source=captureSplitSurfaceSource(o,g);}catch(error){toast(errorMessage(error));return;}
  let cancelled=false,job:GeometrySplitSurfaceJob|null=null;beginModelingOperation('Splitting with curved surface…',{progress:0,onCancel:()=>{cancelled=true;job?.cancel();}});
  try{job=geometryApi.splitBySurfaceAsync(source.request,update=>updateModelingOperation(update.progress,update.message));const result=await job.promise;if(cancelled)return;applyPreparedSplitSurface(source,result);activeSplitPlaneId=null;splitPlaneCreateNext=true;splitSurfaceMode='split';splitSurfaceSelectedPoint=null;toast('Object split into two closed objects. Undo restores the object and curved surface.');}
  catch(error){toast(cancelled?'Curved split cancelled. The original was kept unchanged.':errorMessage(error));}
  finally{endModelingOperation();updateUI();requestRender();}
}
