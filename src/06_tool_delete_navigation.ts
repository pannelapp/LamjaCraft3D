// Delete and Orbit controllers.
const DELETE_TOOL_OPTIONS=Object.freeze({
  sketch:{id:'deleteSketches',label:'Sketches on faces',defaultEnabled:true},
  hole:{id:'deleteHoles',label:'Holes',defaultEnabled:true},
  pocket:{id:'deletePockets',label:'Pockets',defaultEnabled:true},
  boss:{id:'deleteProtrusions',label:'Protrusions',defaultEnabled:true},
  object:{id:'deleteObjects',label:'Objects',defaultEnabled:false},
  group:{id:'deleteGroups',label:'Groups',defaultEnabled:false},
  guide:{id:'deleteGuides',label:'Guide lines / circles',defaultEnabled:true},
  dimension:{id:'deleteDimensions',label:'Dimensions',defaultEnabled:true},
  point:{id:'deletePoints',label:'Points · dissolve / trim',defaultEnabled:false},
  edge:{id:'deleteTrimEdges',label:'Edges · flatten / trim',defaultEnabled:false},
});
interface DeleteEdgePreview {objectId:ObjectId;source:Solid;halfEdgeId:HalfEdgeId;revision:number;result:GeometryEdgeTrimResult|null;}
let deleteEdgePreview:DeleteEdgePreview|null=null,deleteEdgeViewRevision=0;
let deleteEdgePreviewTask:Promise<void>|null=null;
function clearDeleteEdgePreview(){if(deleteEdgePreview){deleteEdgePreview=null;deleteEdgeViewRevision++;sceneKey='';}if($('deleteEdgeStatus'))$('deleteEdgeStatus').textContent='';requestRender();}
function currentDeleteEdgePreview():DeleteEdgePreview|null {
  const p=deleteEdgePreview,o=p&&objects.find(o=>o.id===p.objectId);
  return p&&o&&tool==='delete'&&!modelingOperationBusy&&$('deleteTrimEdges').checked&&isObjectVisible(o)&&!groupForObjectId(o.id)&&o.solid===p.source&&modelRevision===p.revision?p:null;
}
function deleteEdgePreviewSolidFor(o:ModelObject):Solid|null{const p=currentDeleteEdgePreview();return p?.objectId===o.id&&p.result?.ok?p.result.result.solid:null;}
function deleteEdgeDisplayColor(objectId:ObjectId,faceId:FaceId):number[]|null{const p=currentDeleteEdgePreview();if(p?.objectId!==objectId||!p.result?.ok)return null;return faceId===p.result.result.faceId?[.22,.64,.46]:p.result.result.affectedFaceIds.includes(faceId)?[.96,.70,.32]:null;}
function updateDeleteEdgeStatus(){
  const p=currentDeleteEdgePreview();if(!p){if(deleteEdgePreview)clearDeleteEdgePreview();return;}
  const r=p.result,text=!r?'Preparing edge preview…':!r.ok?r.message:r.result.mode==='dissolve'?'Coplanar edge · no shape change · click to flatten':`Edge cut · removes ${Number((r.result.volumeBefore-r.result.volumeAfter).toPrecision(6))} mm³ · click to apply`;
  $('deleteEdgeStatus').textContent=text;$('coordinates').textContent=text;
}
function prepareDeleteEdgePreview(o:ModelObject,halfEdgeId:HalfEdgeId):DeleteEdgePreview|null {
  if(isObjectLocked(o))return null;
  if(modelingOperationBusy||!isObjectVisible(o)||groupForObjectId(o.id)||!$('deleteTrimEdges').checked)return null;
  const edge=geometryApi.edge(o.solid,halfEdgeId),id=[edge.id,edge.twinId].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))[0],existing=currentDeleteEdgePreview();
  if(existing?.objectId===o.id&&existing.halfEdgeId===id)return existing;
  clearDeleteEdgePreview();const p:DeleteEdgePreview={objectId:o.id,source:o.solid,halfEdgeId:id,revision:modelRevision,result:null};deleteEdgePreview=p;deleteEdgeViewRevision++;
  // Let the target highlight paint first. Work is bounded, cached for this
  // source/edge and discarded if settings, revision or tool change meanwhile.
  deleteEdgePreviewTask=new Promise<void>(resolve=>setTimeout(()=>{
    try{if(currentDeleteEdgePreview()!==p){if(deleteEdgePreview===p)clearDeleteEdgePreview();return;}p.result=geometryApi.trimEdge(p.source,p.halfEdgeId);deleteEdgeViewRevision++;sceneKey='';updateDeleteEdgeStatus();requestRender();}
    catch(error){if(currentDeleteEdgePreview()===p){p.result={ok:false,reason:'invalid',message:`Edge preview failed: ${errorMessage(error)}`};updateDeleteEdgeStatus();}}
    finally{resolve();}
  },0));
  return p;
}
type DeleteToolTarget =
  | {kind:'dimension';dimensionId:DimensionId}
  | {kind:'guide';guideId:GuideId}
  | {kind:'group';group:ObjectGroup;hit:HitResult}
  | {kind:'feature';object:ModelObject;edge:Extract<EntityRef,{kind:'edge'}>;candidate:GeometryDeleteFeatureCandidate;hit:HitResult}
  | {kind:'sketch';object:ModelObject;faceId:FaceId;hit:HitResult}
  | {kind:'point';object:ModelObject;point:Extract<EntityRef,{kind:'vertex'}>;hit:HitResult}
  | {kind:'edge';object:ModelObject;edge:Extract<EntityRef,{kind:'edge'}>;hit:HitResult}
  | {kind:'object';object:ModelObject;hit:HitResult};
function deleteToolTargetOption(target:DeleteToolTarget){return DELETE_TOOL_OPTIONS[target.kind==='feature'?target.candidate.kind:target.kind];}
function deleteToolTargetEnabled(target:DeleteToolTarget):boolean{return !!$(deleteToolTargetOption(target).id).checked;}
function resolveDeleteToolTarget(x:number,y:number,hit?:HitResult|null):DeleteToolTarget|null {
  // Preserve target priority. Disabling a recognized feature must never turn
  // the same rim click into deletion of the enclosing object.
  const dimensionId=hitTestDimension(x,y);if(dimensionId)return {kind:'dimension',dimensionId};
  const guideId=hitTestGuideLine(x,y);if(guideId)return {kind:'guide',guideId};
  const h=hit||hitTest(x,y);if(!h)return null;const group=groupForObjectId(h.id);if(group)return {kind:'group',group,hit:h};
  const o=objects.find(v=>v.id===h.id);if(!o)return null;if(o.kind==='surface')return {kind:'object',object:o,hit:h};if($('deletePoints').checked){const point=topologyVertexAt(x,y,h);if(point)return {kind:'point',object:o,point,hit:h};}const edge=topologyEdgeAt(x,y,h);
  if(edge?.kind==='edge'&&$('deleteTrimEdges').checked)return {kind:'edge',object:o,edge,hit:h};
  if(edge?.kind==='edge'){const candidate=geometryApi.deleteFeatureCandidate(o.solid,edge.halfEdgeId);if(candidate)return {kind:'feature',object:o,edge,candidate,hit:h};}
  const sketchFaceId=geometryApi.sketchDeleteCandidate(o.solid,h.face,edge?.kind==='edge'?edge.halfEdgeId:undefined);
  if(sketchFaceId)return {kind:'sketch',object:o,faceId:sketchFaceId,hit:h};
  return {kind:'object',object:o,hit:h};
}
function updateDeleteToolHover(x:number,y:number){
  debugPreviewSolid=null;snapIndicator=null;deleteFeatureHover=null;deleteObjectHoverId=null;
  const target=resolveDeleteToolTarget(x,y);debugPickHit=target&&'hit' in target?target.hit:null;
  if(target?.kind!=='edge')clearDeleteEdgePreview();if(target?.kind!=='point')clearDeletePointPreview();
  if(!target){clearHover();requestRender();return;}
  const locked=deleteTargetLockedObject(target);if(locked){clearDeleteEdgePreview();clearDeletePointPreview();setHoverEntity('object' in target?{kind:'object',objectId:target.object.id}:target.kind==='group'?{kind:'group',groupId:target.group.id}:null);$('coordinates').textContent=objectLockMessage(locked);requestRender();return;}
  if(!deleteToolTargetEnabled(target)){clearHover();$('coordinates').textContent=`${deleteToolTargetOption(target).label} deletion is off`;requestRender();return;}
  switch(target.kind){
    case 'point':setHoverEntity(target.point,target.hit);prepareDeletePointPreview(target.object,target.point.vertexId);updateDeletePointStatus();break;
    case 'edge':setHoverEntity(target.edge,target.hit);prepareDeleteEdgePreview(target.object,target.edge.halfEdgeId);updateDeleteEdgeStatus();break;
    case 'dimension':{setHoverEntity({kind:'dimension',dimensionId:target.dimensionId});const d=dimensions.find(v=>v.id===target.dimensionId);$('coordinates').textContent=d?`Dimension ${fmt(dimensionValue(d))} mm · click to delete`:'Dimension · click to delete';break;}
    case 'guide':setHoverEntity({kind:'guide',guideId:target.guideId});$('coordinates').textContent='Construction guide · click to delete';break;
    case 'group':deleteObjectHoverId=target.hit.id;setHoverEntity({kind:'group',groupId:target.group.id},target.hit);$('coordinates').textContent=`${target.group.name} · ${target.group.objectIds.length} objects · click to delete group`;break;
    case 'feature':deleteFeatureHover={objectId:target.object.id,candidate:target.candidate};setHoverEntity(target.edge,target.hit);$('coordinates').textContent=`${target.candidate.kind==='hole'?'Hole':target.candidate.kind==='pocket'?'Pocket':'Protrusion'} · click to remove and heal`;break;
    case 'sketch':setHoverEntity({kind:'face',objectId:target.object.id,faceId:target.faceId},target.hit);$('coordinates').textContent='Sketch on face · click to remove outline';break;
    case 'object':deleteObjectHoverId=target.object.id;setHoverEntity({kind:'object',objectId:target.object.id},target.hit);$('coordinates').textContent=`${target.object.name} · whole object · click to delete`;break;
  }
  requestRender();
}
function refreshDeleteToolOptions(){
  clearDeleteEdgePreview();clearDeletePointPreview();
  deleteFeatureHover=null;deleteObjectHoverId=null;debugPickHit=null;clearHover();sceneKey='';
  if(tool==='delete'&&debugPointerXY)updateDeleteToolHover(debugPointerXY[0],debugPointerXY[1]);else requestRender();
}
const deleteToolController:ToolController={
  name:'delete',parameters:TOOL_PARAMETERS.none,
  cancel(){clearDeleteEdgePreview();clearDeletePointPreview();},
  pointerDown({x,y,hit}){
    if(modelingOperationBusy)return true;
    const target=resolveDeleteToolTarget(x,y,hit);if(!target)return true;
    const locked=deleteTargetLockedObject(target);if(locked){toast(objectLockMessage(locked));return true;}
    if(!deleteToolTargetEnabled(target)){refreshDeleteToolOptions();toast(`${deleteToolTargetOption(target).label} deletion is off.`);return true;}
    if(target.kind!=='point')clearDeletePointPreview();if(target.kind!=='edge')clearDeleteEdgePreview();
    try{
      switch(target.kind){
        case 'point':{
          clearDeleteEdgePreview();const preview=prepareDeletePointPreview(target.object,target.point.vertexId);
          if(!preview?.result){updateDeletePointStatus();toast('Preparing the point preview. Check it, then click again.');return true;}
          if(!preview.result.ok){toast(preview.result.message);return true;}
          applyPreparedPointDelete(target.object.id,preview.source,preview.result.result);clearDeletePointPreview();toast('The point was deleted.');break;
        }
        case 'edge':{
          const preview=prepareDeleteEdgePreview(target.object,target.edge.halfEdgeId);
          if(!preview?.result){updateDeleteEdgeStatus();toast('Preparing the edge preview. Check it, then click again.');return true;}
          if(!preview.result.ok){toast(preview.result.message);return true;}
          applyPreparedEdgeTrim(target.object.id,preview.source,preview.halfEdgeId,preview.result.result);clearDeleteEdgePreview();toast('The edge was flattened / trimmed.');break;
        }
        case 'dimension':removeDimension(target.dimensionId);toast('The dimension was deleted.');break;
        case 'guide':removeGuide(target.guideId);toast('The construction guide was deleted.');break;
        case 'group':removeGroupById(target.group.id);toast(`The group “${target.group.name}” was deleted.`);break;
        case 'feature':{const deleted=deleteRecognizedFeature(target.object,target.edge.halfEdgeId);toast(`The ${deleted?.kind==='hole'?'hole':deleted?.kind==='pocket'?'pocket':'protrusion'} was removed.`);break;}
        case 'sketch':deleteSketchBoundary(target.object,target.faceId);toast('The sketch outline was removed.');break;
        case 'object':{const o=target.object;removeObjectById(o.id);toast(`The object “${o.name}” was deleted.`);break;}
      }
      deleteFeatureHover=null;deleteObjectHoverId=null;clearHover();
    }catch(err){toast(errorMessage(err));}
    return true;
  }
};

const orbitToolController:ToolController={name:'orbit',navigation:'orbit',parameters:TOOL_PARAMETERS.none};

function deleteTargetLockedObject(target:DeleteToolTarget):ModelObject|null{
  if(target.kind==='group')return lockedObjectsIn(target.group.objectIds)[0]||null;
  return 'object' in target&&isObjectLocked(target.object)?target.object:null;
}
