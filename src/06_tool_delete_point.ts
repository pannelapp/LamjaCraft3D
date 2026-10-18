interface DeletePointPreview {objectId:ObjectId;source:Solid;vertexId:VertexId;revision:number;transform:Transform;result:GeometryPointDeleteResult|null;}
let deletePointPreview:DeletePointPreview|null=null,deletePointViewRevision=0;
let deletePointPreviewTask:Promise<void>|null=null;
function clearDeletePointPreview(){if(deletePointPreview){deletePointPreview=null;deletePointViewRevision++;sceneKey='';}if($('deletePointStatus'))$('deletePointStatus').textContent='';requestRender();}
function currentDeletePointPreview():DeletePointPreview|null {
  const p=deletePointPreview,o=p&&objects.find(o=>o.id===p.objectId);
  return p&&o&&tool==='delete'&&!modelingOperationBusy&&$('deletePoints').checked&&isObjectVisible(o)&&!groupForObjectId(o.id)&&o.solid===p.source&&modelRevision===p.revision&&JSON.stringify(o.transform)===JSON.stringify(p.transform)?p:null;
}
function deletePointPreviewSolidFor(o:ModelObject):Solid|null{const p=currentDeletePointPreview();return p?.objectId===o.id&&p.result?.ok?p.result.result.solid:null;}
function deletePointDisplayColor(objectId:ObjectId,faceId:FaceId):number[]|null{const p=currentDeletePointPreview();if(p?.objectId!==objectId||!p.result?.ok)return null;const r=p.result.result;return r.faceId===faceId?[.22,.64,.46]:r.affectedFaceIds.includes(faceId)?r.mode==='trim'?[.96,.70,.32]:[.22,.64,.46]:null;}
function updateDeletePointStatus(){
  const p=currentDeletePointPreview();if(!p){if(deletePointPreview)clearDeletePointPreview();return;}
  const r=p.result,text=!r?'Preparing point preview…':!r.ok?r.message:r.result.mode==='trim'?`Point cut · removes ${Number((r.result.volumeBefore-r.result.volumeAfter).toPrecision(6))} mm³ · click to apply`:'Redundant / planar point · no shape change · click to delete';
  $('deletePointStatus').textContent=text;$('coordinates').textContent=text;
}
function prepareDeletePointPreview(o:ModelObject,vertexId:VertexId):DeletePointPreview|null {
  if(isObjectLocked(o))return null;
  if(modelingOperationBusy||!isObjectVisible(o)||groupForObjectId(o.id)||!$('deletePoints').checked)return null;
  const existing=currentDeletePointPreview();if(existing?.objectId===o.id&&existing.vertexId===vertexId)return existing;
  clearDeletePointPreview();const p:DeletePointPreview={objectId:o.id,source:o.solid,vertexId,revision:modelRevision,transform:structuredClone(o.transform),result:null};deletePointPreview=p;deletePointViewRevision++;
  deletePointPreviewTask=new Promise<void>(resolve=>setTimeout(()=>{
    try{if(currentDeletePointPreview()!==p){if(deletePointPreview===p)clearDeletePointPreview();return;}p.result=geometryApi.deletePoint(p.source,p.vertexId);deletePointViewRevision++;sceneKey='';updateDeletePointStatus();requestRender();}
    catch(error){if(currentDeletePointPreview()===p){p.result={ok:false,reason:'invalid',message:`Point preview failed: ${errorMessage(error)}`};updateDeletePointStatus();}}
    finally{resolve();}
  },0));
  return p;
}
