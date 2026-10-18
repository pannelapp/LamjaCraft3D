// Curved split guides stay independent construction geometry until one command
// replaces the target with the two checked canonical solids.
function setGuideSplitSurface(id:GuideId,grid:SplitSurfaceGrid):GuidePlane {
  const surface=validateSplitSurface(grid),g=guidePlaneById(id);if(!g)throw Error('Choose a split plane first.');
  return executeDocumentCommand<GuidePlane>({type:'edit-split-surface',label:'Edit split surface',parameters:{guideId:id,width:surface.width,height:surface.height,columns:surface.columns,rows:surface.rows},execute(){const guide=guidePlaneById(id);if(!guide)throw Error('The split surface no longer exists.');guide.surface=surface;guide.axis=guide.axis||splitPlaneDefaultAxis(guide.normal);return {value:guide,selection:{kind:'guide',guideId:id}};}},{validateChangedSolids:false});
}
function createSplitSurfaceGuide(grid:SplitSurfaceGrid,label='Curved split surface'):GuidePlane {
  const surface=validateSplitSurface(grid),existing=activeSplitPlane(),origin=existing?[...existing.origin] as Vec3:splitPlaneReferenceOrigin(),normal=existing?[...existing.normal] as Vec3:[0,0,1] as Vec3,axis=existing?.axis?[...existing.axis] as Vec3:splitPlaneDefaultAxis(normal);
  return executeDocumentCommand<GuidePlane>({type:'create-split-surface',label:'Create split surface',parameters:{width:surface.width,height:surface.height,columns:surface.columns,rows:surface.rows},execute(){for(let i=guides.length-1;i>=0;i--)if(guides[i].kind==='plane')guides.splice(i,1);const guide:GuidePlane={id:'g'+nextGuideId++,kind:'plane',origin,normal,axis,surface,label:String(label).slice(0,80)};guides.push(guide);return {value:guide,selection:{kind:'guide',guideId:guide.id}};}},{validateChangedSolids:false});
}
interface SplitSurfaceSource {objectId:ObjectId;guideId:GuideId;solid:Solid;revision:number;transform:Transform;guideKey:string;request:SplitSurfaceRequest;}
function captureSplitSurfaceSource(o:ModelObject,g:GuidePlane):SplitSurfaceSource {
  if(groupForObjectId(o.id))throw Error('Ungroup the object before splitting it.');assertProjectObjectCapacity(1,'Splitting');assertObjectsEditable([o.id]);if(!g.surface)throw Error('Choose a curved split surface first.');
  const normal=V.unit(inverseRotate(g.normal,o.transform.rotation)),axis=inverseRotate(g.axis||splitPlaneDefaultAxis(g.normal),o.transform.rotation),frame:SplitSurfaceFrame={origin:inverseTransformPoint(g.origin,o.transform),normal,axis};
  return {objectId:o.id,guideId:g.id,solid:o.solid,revision:modelRevision,transform:structuredClone(o.transform),guideKey:JSON.stringify(serializeGuide(g)),request:{type:'split-surface',solid:o.solid,frame,grid:validateSplitSurface(g.surface)}};
}
function applyPreparedSplitSurface(source:SplitSurfaceSource,result:SplitSurfaceResult):ModelObject[] {
  const o=requireObject(source.objectId),g=guidePlaneById(source.guideId);if(modelRevision!==source.revision||o.solid!==source.solid||JSON.stringify(o.transform)!==JSON.stringify(source.transform)||!g||JSON.stringify(serializeGuide(g))!==source.guideKey)throw Error('The object or split surface changed. Split it again.');
  if(groupForObjectId(o.id))throw Error('Ungroup the object before splitting it.');assertProjectObjectCapacity(1,'Splitting');
  return executeDocumentCommand<ModelObject[]>({type:'split-object-surface',label:'Split object by curved surface',parameters:{objectId:o.id,guideId:g.id,consumeGuide:true},execute(){
    freezeDimensionAnchorsForObjects(new Set([o.id]));o.solid=result.positive;o.solid.id='s_'+o.id;o.solid.metadata={...o.solid.metadata,name:o.name};
    const id='o'+nextObjectId++,name=`${o.name} (split)`,second:ModelObject={id,name,kind:'solid',color:o.color,...(objectShininess(o)>0?{shininess:objectShininess(o)}:{}),transform:structuredClone(o.transform),solid:result.negative};second.solid.id='s_'+id;second.solid.metadata={...second.solid.metadata,name};objects.splice(objects.indexOf(o)+1,0,second);guides.splice(guides.indexOf(g),1);
    return {value:[o,second],selection:{kind:'object',objectId:o.id},objectSelection:[o.id,id],surfaceSketch:null};
  }});
}
function splitObjectByGuideSurface(o:ModelObject,g:GuidePlane):ModelObject[]{const source=captureSplitSurfaceSource(o,g);return applyPreparedSplitSurface(source,geometryApi.splitBySurface(source.request));}
