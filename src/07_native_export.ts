// Native export assembles a scoped format-7/8/9/10 document through the existing
// canonical serializers. It never converts to meshes or mutates the source.
type ExportFormat=ExchangeFormat|'lamjacraft'|'png';
interface NativeExportSnapshot {header:Omit<ProjectData,'objects'>;objects:readonly ModelObject[];}
const NATIVE_EXPORT_POLICY=Object.freeze({maximumBytes:PROJECT_READ_POLICY.maximumFileBytes,minimumGroupMembers:2});
function nativeExportDimensions(ids:ReadonlySet<ObjectId>):DimensionAnnotation[]{
  return dimensions.filter(dimension=>{
    const anchors=[dimension.a,dimension.b];
    return anchors.some(anchor=>anchor.kind!=='world'&&ids.has(anchor.objectId))&&anchors.every(anchor=>anchor.kind==='world'||ids.has(anchor.objectId));
  }).map(serializeDimension);
}
function snapshotNativeExport(list:readonly ModelObject[],selected:boolean):NativeExportSnapshot{
  if(!selected)assertSplitSurfacePreviewFinished();
  const ids=new Set(list.map(object=>object.id));
  const exportGroups=groups.map(serializeGroup).map(group=>({...group,objectIds:group.objectIds.filter(id=>ids.has(id))})).filter(group=>group.objectIds.length>=NATIVE_EXPORT_POLICY.minimumGroupMembers);
  return {objects:list.map(object=>({...object,transform:structuredClone(object.transform)})),header:{
    format:'lamjacraft-3d',version:nativeProjectVersion(!selected,list.some(object=>object.kind==='surface'),list.some(object=>objectShininess(object)>0)),units:'mm',name:String($('projectName').value||'LamjaCraft 3D'),
    groups:exportGroups,construction:{guides:selected?[]:guides.map(serializeGuide)},
    annotations:{dimensions:selected?nativeExportDimensions(ids):dimensions.map(serializeDimension)},
    ...(!selected&&buildPlates.length?{references:{buildPlates:buildPlates.map(cloneBuildPlate)}}:{}),
  }};
}
function nativeExportJson(value:unknown):string{
  const result=JSON.stringify(value,(_key,item:unknown)=>{
    if(typeof item==='number'&&!Number.isFinite(item))throw Error('Native export contains a non-finite number.');
    return item;
  });
  if(result===undefined)throw Error('Native export contains an unsupported value.');
  return result;
}
function checkNativeExportSize(byteLength:number){
  if(byteLength>NATIVE_EXPORT_POLICY.maximumBytes)throw Error(`The LamjaCraft file exceeds ${NATIVE_EXPORT_POLICY.maximumBytes/(1024*1024)} MB. Export fewer objects.`);
}
async function nativeProjectFileAsync(snapshot:NativeExportSnapshot,control:ExchangeControl):Promise<Blob>{
  if(!snapshot.objects.length)throw Error('There are no objects to export.');
  const text=new ExchangeText();
  const flush=()=>{text.flush();checkNativeExportSize(text.byteLength);};
  await yieldExchange(control);text.line('{');
  for(const [key,value] of Object.entries(snapshot.header)){
    text.line(`  ${JSON.stringify(key)}: ${nativeExportJson(value)},`);flush();await yieldExchange(control);
  }
  text.line('  "objects": [');
  for(let i=0;i<snapshot.objects.length;i++){
    control.report(100*i/snapshot.objects.length,`Preparing LamjaCraft · object ${i+1} of ${snapshot.objects.length}`);
    await yieldExchange(control);
    text.line('    '+nativeExportJson(serializeProjectObject(snapshot.objects[i]))+(i+1<snapshot.objects.length?',':''));
    flush();await yieldExchange(control);
  }
  text.line('  ]');text.line('}');flush();control.report(100,'LamjaCraft project ready');checkExchangeCancellation(control);
  return new Blob(text.chunks,{type:'application/json'});
}
