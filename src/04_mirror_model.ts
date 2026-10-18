// One atomic reflection command for selected solid objects and flat groups.
const MIRROR_POLICY=Object.freeze({maximumNameLength:80,maximumGroups:300,nameSuffix:' mirror'});
function mirrorCopyName(name:string):string{return name.slice(0,MIRROR_POLICY.maximumNameLength-MIRROR_POLICY.nameSuffix.length)+MIRROR_POLICY.nameSuffix;}
function checkedMirrorPlane(plane:Plane):Plane{
  const length=Math.hypot(...plane.normal);
  if(!Number.isFinite(length)||length===0||!Number.isFinite(plane.offset))throw Error('Choose a finite mirror plane with a nonzero normal.');
  const normal=plane.normal.map(value=>value/length) as Vec3,offset=plane.offset/length;
  if(!Number.isFinite(offset))throw Error('The mirror plane is outside the supported coordinate range.');
  return {normal,offset};
}
function reflectMirrorPoint(point:Vec3,plane:Plane):Vec3{return V.sub(point,V.mul(plane.normal,2*(V.dot(plane.normal,point)-plane.offset)));}
function mirrorObjects(objectIds:readonly ObjectId[],requestedPlane:Plane,keepOriginal:boolean):ModelObject[]{
  if(modelingOperationBusy)throw Error('Wait for the modeling operation before mirroring objects.');
  const ids=[...new Set(objectIds)];if(!ids.length)throw Error('Select one or more solid objects to mirror.');
  const plane=checkedMirrorPlane(requestedPlane),sources=ids.map(requireObject),wanted=new Set(ids);
  const copiedGroups=keepOriginal?groups.filter(group=>group.objectIds.every(id=>wanted.has(id))):[];
  if(keepOriginal){
    assertProjectObjectCapacity(ids.length,'Mirroring');
    if(groups.length+copiedGroups.length>MIRROR_POLICY.maximumGroups)throw Error(`Mirroring would exceed the project limit of ${MIRROR_POLICY.maximumGroups} groups.`);
  }
  return executeDocumentCommand<ModelObject[]>({type:'mirror-objects',label:keepOriginal?'Mirror copies':'Mirror objects',parameters:{objectIds:ids,plane,keepOriginal},execute(){
    const mapping=new Map<ObjectId,ObjectId>(),made=sources.map(source=>{
      // Clone appearance/transform without a second full canonical geometry copy.
      const solid=geometryApi.reflectThroughOrigin(source.solid,inverseRotate(plane.normal,source.transform.rotation));
      const transform:Transform={position:reflectMirrorPoint(source.transform.position,plane),rotation:[...source.transform.rotation]};
      if([...transform.position].some(value=>!Number.isFinite(value)))throw Error('Mirroring produced coordinates outside the supported range.');
      if(!keepOriginal){source.solid=solid;source.transform=transform;return source;}
      const id='o'+nextObjectId++;mapping.set(source.id,id);solid.id='s_'+id;
      return {...source,id,name:mirrorCopyName(source.name),locked:false,transform,solid};
    });
    if(!keepOriginal)return {value:made,surfaceSketch:null};
    const madeGroups=copiedGroups.map(group=>({id:'grp'+nextGroupId++,name:mirrorCopyName(group.name),objectIds:group.objectIds.map(id=>mapping.get(id)!)}));
    objects.push(...made);groups.push(...madeGroups);
    const primary=made.find(isObjectVisible)||made[0],primaryGroup=madeGroups.find(group=>group.objectIds.includes(primary.id));
    return {value:made,selection:primaryGroup?{kind:'group',groupId:primaryGroup.id}:{kind:'object',objectId:primary.id},objectSelection:made.map(object=>object.id),surfaceSketch:null};
  }});
}
