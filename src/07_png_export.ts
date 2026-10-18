interface PngPreviewState {generation:number;snapshot:PngImageSnapshot;signature:string;}
let pngPreviewGeneration=0,pngPreviewState:PngPreviewState|null=null;
function pngExportVisibleObjects():ModelObject[]{const selected=new Set(selectedObjectIds());return visibleObjects().filter(o=>$('exportScope').value!=='selected'||selected.has(o.id));}
function pngExportSignature():string{return JSON.stringify({revision:modelRevision,camera,viewport:[W,H],scope:$('exportScope').value,selected:selectedObjectIds(),style:$('pngStyle').value,shadows:!!$('pngShadows').checked,background:$('pngBackground').value,scale:$('pngScale').value,references:['pngGrid','pngGuides','pngDimensions','pngBuildPlates'].map(id=>!!$(id).checked),guidesThrough:guideLinesThroughSolids(),name:filename(),objects:pngExportVisibleObjects().map(o=>[o.id,o.color,objectShininess(o),derivedTransformKey(o.transform)])});}
function capturePngImage():PngImageSnapshot {
  let pending=pointer;if(pending?.type==='orbit-camera'||pending?.type==='pan-camera')pending=pending.suspendedPointer;
  if(pending?.type==='move-object'||pending?.type==='rotate-object')throw Error('Finish or cancel the active Move/Rotate preview before exporting PNG.');
  assertSplitSurfacePreviewFinished();
  const scale=Number($('pngScale').value);if(![1,2,4].includes(scale))throw Error('Choose Normal, 2× or 4× resolution.');
  const width=Math.round(W*scale),height=Math.round(H*scale);if(width<1||height<1||width>PNG_IMAGE_POLICY.maximumDimension||height>PNG_IMAGE_POLICY.maximumDimension||width*height>PNG_IMAGE_POLICY.maximumPixels)throw Error(`PNG is limited to ${PNG_IMAGE_POLICY.maximumPixels/(1024*1024)} megapixels and ${PNG_IMAGE_POLICY.maximumDimension} pixels per side. Requested ${width} × ${height} pixels. Choose a lower resolution.`);
  const list=pngExportVisibleObjects();if(!list.length)throw Error('There are no visible objects in this export scope.');
  const background=$('pngBackground').value;if(background!=='current'&&background!=='white'&&background!=='transparent')throw Error('Choose a PNG background.');
  const state=structuredClone(camera),frame=sceneCameraFrame(state),imageGuides:ImageGuide[]=[];let referenceSegments=0;
  if($('pngGuides').checked)for(const guide of guides){let image:ImageGuide;
    if(guide.kind==='point')image={paths:[],point:[...guide.point] as Vec3,label:guide.label};
    else if(guide.kind==='line'){const segment=guideLineCameraSegment(guide,state,frame,W,H);image={paths:segment?[segment]:[]};}
    else if(guide.kind==='circle')image={paths:[guideCircleWorldPoints(guide,PNG_IMAGE_POLICY.guideCircleSegments)],point:[...guide.center] as Vec3,label:guide.label};
    else if(guide.surface){const grid=guide.surface,points=splitSurfaceWorldPoints(grid,splitSurfaceGuideFrame(guide)),paths:Vec3[][]=[];for(let y=0;y<grid.rows;y++)paths.push(points.slice(y*grid.columns,(y+1)*grid.columns));for(let x=0;x<grid.columns;x++)paths.push(Array.from({length:grid.rows},(_,y)=>points[y*grid.columns+x]));image={paths,point:points[0],label:guide.label};}
    else{const f=guidePlaneFrame(guide);image={paths:[[...f.corners,f.corners[0]],[V.add(guide.origin,V.mul(f.u,-f.scale)),V.add(guide.origin,V.mul(f.u,f.scale))],[V.add(guide.origin,V.mul(f.v,-f.scale)),V.add(guide.origin,V.mul(f.v,f.scale))]],point:[...guide.origin] as Vec3,label:guide.label};}
    referenceSegments+=image.paths.reduce((sum,path)=>sum+Math.max(0,path.length-1),0);if(referenceSegments>PNG_IMAGE_POLICY.maximumReferenceSegments)throw Error('PNG has too many guide segments. Hide guides for this export.');imageGuides.push(image);
  }
  const included=new Set(list.map(o=>o.id)),imageDimensions:ImageDimension[]=[];
  if($('pngDimensions').checked)for(const d of dimensions)if(isDimensionVisible(d)&&[d.a,d.b].every(a=>a.kind==='world'||included.has(a.objectId)))imageDimensions.push({a:resolveGeometryAnchor(d.a),b:resolveGeometryAnchor(d.b),text:(d.label?d.label+' · ':'')+fmt(dimensionValue(d))+' mm'});
  return {revision:modelRevision,camera:state,viewportWidth:W,viewportHeight:H,width,height,style:modelViewStyle($('pngStyle').value),shadows:!!$('pngShadows').checked,background,objects:list.map(o=>({...o,transform:structuredClone(o.transform)})),guides:imageGuides,dimensions:imageDimensions,plates:$('pngBuildPlates').checked?buildPlates.filter(p=>p.visible&&p.opacity>0).map(cloneBuildPlate):[],grid:!!$('pngGrid').checked,guidesThrough:guideLinesThroughSolids()};
}
function invalidatePngPreview():void{pngPreviewGeneration++;pngPreviewState=null;}
function updatePngExportSummary():void {
  invalidatePngPreview();const generation=pngPreviewGeneration,scale=Number($('pngScale').value),list=pngExportVisibleObjects(),canvas=$('pngPreview') as HTMLCanvasElement;
  $('exportFormatNote').textContent='PNG of the current camera angle, zoom and projection. Only visible objects are included. Normal object colors are used; selections, unfinished geometry, debug overlays and the interface are excluded. Display smoothing does not change model geometry.';
  $('exportSummary').textContent=`${list.length} visible object${list.length===1?'':'s'} · ${Math.round(W*scale)} × ${Math.round(H*scale)} px · current ${camera.orthographic?'orthographic':'perspective'} view`;$('belowPlane').textContent='';$('downloadSTL').textContent='Download PNG';$('downloadSTL').disabled=true;canvas.classList.add('hidden');$('pngPreviewStatus').textContent='Preparing image…';
  void (async()=>{
    await yieldSTLExport();if(generation!==pngPreviewGeneration||exchangeFormat()!=='png'||!($('exportDialog') as HTMLDialogElement).open)return;
    try{
      const signature=pngExportSignature(),snapshot=capturePngImage();pngImageRenderer??=new PngImageRenderer();pngImageRenderer.render(snapshot,canvas);
      if(generation!==pngPreviewGeneration)return;pngPreviewState={generation,snapshot,signature};canvas.classList.remove('hidden');$('pngPreviewStatus').textContent=`${snapshot.width} × ${snapshot.height} px · preview is the image to download`;$('downloadSTL').disabled=false;
    }catch(error){if(generation!==pngPreviewGeneration)return;$('pngPreviewStatus').textContent='Image unavailable';showExportError(errorMessage(error));}
  })();
}
function pngCanvasBlob(canvas:HTMLCanvasElement):Promise<Blob>{return new Promise((resolve,reject)=>{canvas.toBlob(blob=>blob?resolve(blob):reject(Error('The browser could not encode this PNG. Choose a lower resolution.')),'image/png');});}
async function downloadPngImage():Promise<void> {
  const preview=pngPreviewState;if(modelingOperationBusy||!preview)return;
  if(preview.signature!==pngExportSignature()){exportSummary();showExportError('The view or model changed. Review the refreshed PNG preview before downloading.');return;}
  const name=filename()+'-view.png';let cancelled=false;clearExportFeedback();beginModelingOperation('Encoding PNG image…',{progress:0,onCancel:()=>{cancelled=true;}});
  try{
    await yieldSTLExport();if(cancelled)return;updateModelingOperation(30,'Encoding the preview image…');const blob=await pngCanvasBlob($('pngPreview') as HTMLCanvasElement);
    if(cancelled)return;if(preview.generation!==pngPreviewGeneration||preview.signature!==pngExportSignature())throw Error('The PNG settings or model changed while the image was encoded. Review the preview again.');
    updateModelingOperation(100,'PNG ready');download(blob,name);$('saveStatus').textContent='PNG exported';($('exportDialog') as HTMLDialogElement).close();toast('PNG downloaded successfully.');
  }catch(error){if(!cancelled)showExportError(errorMessage(error));}
  finally{endModelingOperation();if(cancelled)toast('PNG export cancelled. No file was downloaded.');}
}
$('pngStyle').value='illustration';$('pngBackground').value='current';$('pngScale').value='2';$('pngShadows').checked=false;
for(const id of ['pngStyle','pngBackground','pngScale','pngShadows','pngGrid','pngGuides','pngDimensions','pngBuildPlates'])$(id).addEventListener('change',exportSummary);
$('exportDialog').addEventListener('close',()=>{invalidatePngPreview();pngImageRenderer?.releaseImage();const canvas=$('pngPreview') as HTMLCanvasElement;canvas.width=1;canvas.height=1;});
