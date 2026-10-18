// Append a validated native project through one document transaction. The source
// remains independent: document IDs are fresh, topology IDs stay local to solids.
const PROJECT_ADDITION_POLICY=Object.freeze({maximumObjects:PROJECT_CAPACITY_POLICY.maximumObjects,maximumGroups:300,maximumGuides:20000,maximumDimensions:20000});
type ProjectAdditionMode='photo-ai'|'native';
type ValidatedProject=ReturnType<typeof validateProject>;
function validateProjectReferenceCoordinates(project:ValidatedProject):void{
  const finite=(vector:Vec3)=>vector.length===3&&vector.every(Number.isFinite);
  for(const guide of project.guides){
    const vectors=guide.kind==='point'?[guide.point]:guide.kind==='line'?[guide.point,guide.direction,...(guide.planeNormal?[guide.planeNormal]:[])]:guide.kind==='circle'?[guide.center,guide.normal]:[guide.origin,guide.normal,...(guide.axis?[guide.axis]:[])];
    if(vectors.some(vector=>!finite(vector)))throw Error(`Guide ${guide.id} has non-finite coordinates.`);
  }
  for(const dimension of project.dimensions)for(const anchor of [dimension.a,dimension.b])if(!finite(anchor.kind==='world'?anchor.point:anchor.fallback))throw Error(`Dimension ${dimension.id} has non-finite coordinates.`);
}
function checkProjectAdditionCapacity(project:ValidatedProject,mode:ProjectAdditionMode='photo-ai'):void {
  if(mode==='photo-ai'&&!project.objects.length)throw Error('The result contains no editable objects.');
  if(mode==='native'&&!project.objects.length&&!project.guides.length&&!project.dimensions.length&&!project.buildPlates.length)throw Error('The project contains no objects or references to import.');
  if(mode==='native'&&buildPlates.length+project.buildPlates.length>BUILD_PLATE_POLICY.maximumPlates)throw Error(`Adding the project would exceed the limit of ${BUILD_PLATE_POLICY.maximumPlates} build plates.`);
  for(const [label,count,maximum] of [
    ['objects',objects.length+project.objects.length,PROJECT_ADDITION_POLICY.maximumObjects],
    ['groups',groups.length+project.groups.length,PROJECT_ADDITION_POLICY.maximumGroups],
    ['construction guides',guides.length+project.guides.length,PROJECT_ADDITION_POLICY.maximumGuides],
    ['dimensions',dimensions.length+project.dimensions.length,PROJECT_ADDITION_POLICY.maximumDimensions],
  ] as const)if(count>maximum)throw Error(`Adding the result would exceed the project limit of ${maximum.toLocaleString('en-US')} ${label}.`);
}
function remapImportedAnchor(anchor:GeometryAnchor,idMap:Map<ObjectId,ObjectId>,imported:ModelObject[]):GeometryAnchor {
  if(anchor.kind==='world')return cloneAnchor(anchor);
  const objectId=idMap.get(anchor.objectId),object=imported.find(item=>item.id===objectId);
  const exists=object&&(anchor.kind==='vertex'?geometryApi.hasVertex(object.solid,anchor.vertexId):geometryApi.hasVertex(object.solid,anchor.vertexA)&&geometryApi.hasVertex(object.solid,anchor.vertexB));
  // An unresolved external reference must never attach to an existing object
  // merely because it happens to have the same ID.
  if(objectId&&exists){const copy=cloneAnchor(anchor);if(copy.kind!=='world')copy.objectId=objectId;return copy;}
  return {kind:'world',point:[...anchor.fallback] as Vec3};
}
function addImportedProject(project:ValidatedProject,sourceRevision:number,mode:ProjectAdditionMode='photo-ai'):ModelObject[] {
  if(modelRevision!==sourceRevision)throw Error('The project changed. Check the result again.');
  checkProjectAdditionCapacity(project,mode);
  return executeDocumentCommand<ModelObject[]>({type:mode==='native'?'import-project':'import-photo-ai',label:mode==='native'?'Import project':'Add Photo AI result',parameters:{buildPlates:mode==='native'?project.buildPlates.length:0,objects:project.objects.length,groups:project.groups.length,guides:project.guides.length,dimensions:project.dimensions.length},execute(){
    const objectIds=new Set(objects.map(object=>object.id)),groupIds=new Set(groups.map(group=>group.id)),guideIds=new Set(guides.map(guide=>guide.id)),dimensionIds=new Set(dimensions.map(dimension=>dimension.id)),plateIds=new Set(buildPlates.map(plate=>plate.id));
    const allocate=(used:Set<string>,next:()=>string):string=>{let id=next();while(used.has(id))id=next();used.add(id);return id;};
    const idMap=new Map<ObjectId,ObjectId>();
    const imported=project.objects.map(source=>{
      const object=cloneObject(source);object.id=allocate(objectIds,()=> 'o'+nextObjectId++);object.solid.id='s_'+object.id;idMap.set(source.id,object.id);return object;
    });
    const importedGroups=project.groups.map(source=>({id:allocate(groupIds,()=> 'grp'+nextGroupId++),name:source.name,objectIds:source.objectIds.map(id=>{const mapped=idMap.get(id);if(!mapped)throw Error('An imported group references a missing object.');return mapped;})}));
    const importedGuides=project.guides.map(source=>{const guide=cloneGuide(source);guide.id=allocate(guideIds,()=> 'g'+nextGuideId++);return guide;});
    const importedDimensions=project.dimensions.map(source=>({...cloneDimension(source),id:allocate(dimensionIds,()=> 'd'+nextDimensionId++),a:remapImportedAnchor(source.a,idMap,imported),b:remapImportedAnchor(source.b,idMap,imported)}));
    if(mode==='native')for(const source of project.buildPlates){const plate=cloneBuildPlate(source);plate.id=allocate(plateIds,()=>{if(!Number.isSafeInteger(nextBuildPlateId)||nextBuildPlateId>=Number.MAX_SAFE_INTEGER)nextBuildPlateId=1;return 'bp'+nextBuildPlateId++;});buildPlates.push(plate);}
    objects.push(...imported);groups.push(...importedGroups);guides.push(...importedGuides);dimensions.push(...importedDimensions);
    const first=imported.find(isObjectVisible),group=first&&importedGroups.find(item=>item.objectIds.includes(first.id));
    if(mode==='native'&&!imported.length)return {value:imported,surfaceSketch:null};
    return {value:imported,selection:group?{kind:'group',groupId:group.id}:first?{kind:'object',objectId:first.id}:null,objectSelection:imported.filter(isObjectVisible).map(object=>object.id),surfaceSketch:null};
  }})!;
}
