// Pure appearance and native-object codecs shared with the Open worker.
function deserializeObjectHidden(value:unknown):boolean{
  if(value===undefined)return false;
  if(typeof value!=='boolean')throw Error('Object visibility must be a boolean.');
  return value;
}
function deserializeObjectLocked(value:unknown):boolean{
  if(value===undefined)return false;
  if(typeof value!=='boolean')throw Error('Object lock state must be a boolean.');
  return value;
}
function deserializeObjectShininess(value:unknown):number {
  if(value===undefined)return 0;
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>100)throw Error('Object shininess must be a number from 0 to 100.');
  return value;
}
function objectShininess(object:{shininess?:number}):number{return object.shininess??0;}
function serializeObjectProperties(o:ModelObject):Omit<SerializedModelObject,'solid'>{return {id:o.id,name:o.name,kind:o.kind,...(o.hidden?{hidden:true}:{}),...(o.locked?{locked:true}:{}),color:o.color,...(objectShininess(o)>0?{shininess:objectShininess(o)}:{}),transform:{position:[...o.transform.position] as Vec3,rotation:[...o.transform.rotation] as Vec3}};}
function serializeObject(o:ModelObject):SerializedModelObject{return {...serializeObjectProperties(o),solid:serializeSolid(o.solid)};}
function deserializeProjectObject(x:any):ModelObject {const transform:Transform={position:[...(x.transform?.position||[0,0,0])] as Vec3,rotation:[...(x.transform?.rotation||[0,0,0])] as Vec3};return {id:String(x.id),name:String(x.name||'Object'),kind:x.kind==='surface'?'surface':'solid',hidden:deserializeObjectHidden(x.hidden),locked:deserializeObjectLocked(x.locked),color:/^#[\da-f]{6}$/i.test(x.color)?x.color:'#b7cec9',...(deserializeObjectShininess(x.shininess)>0?{shininess:x.shininess}:{}),transform,solid:x.kind==='surface'?deserializeProjectSurface(x.solid):deserializeProjectSolid(x.solid)};}
