// Document-owned visual references. Build plates are never modeling entities.
const BUILD_PLATE_POLICY=Object.freeze({maximumPlates:128,defaultWidth:220,defaultDepth:220,defaultColor:'#6d93bd',defaultOpacity:.35,placementGap:20,maximumNameLength:80});
const buildPlates:BuildPlate[]=modelDocument.buildPlates;
let nextBuildPlateId=1;
function cloneBuildPlate(plate:BuildPlate):BuildPlate{return {...plate};}
function deserializeBuildPlate(value:unknown):BuildPlate{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid build plate.');
  const p=value as Record<string,unknown>;
  if(typeof p.id!=='string'||!p.id.trim())throw Error('Build plate is missing an ID.');
  for(const key of ['width','depth','x','y','opacity'])if(typeof p[key]!=='number'||!Number.isFinite(p[key]))throw Error(`Build plate ${key} must be a finite number.`);
  const width=p.width as number,depth=p.depth as number,x=p.x as number,y=p.y as number,opacity=p.opacity as number;
  if(width<=0||depth<=0)throw Error('Build plate width and depth must be greater than zero.');
  if(![x-width/2,x+width/2,y-depth/2,y+depth/2].every(v=>Number.isFinite(v)&&Number.isFinite(Math.fround(v))))throw Error('Build plate bounds are too large.');
  if(opacity<0||opacity>1)throw Error('Build plate opacity must be between 0% and 100%.');
  if(typeof p.color!=='string'||!/^#[\da-f]{6}$/i.test(p.color))throw Error('Build plate color must be a six-digit hex color.');
  if(p.visible!==undefined&&typeof p.visible!=='boolean')throw Error('Build plate visibility must be a boolean.');
  if(p.name!==undefined&&typeof p.name!=='string')throw Error('Build plate name must be text.');
  return {id:p.id,name:(typeof p.name==='string'&&p.name.trim()?p.name:'Build plate').slice(0,BUILD_PLATE_POLICY.maximumNameLength),width,depth,x,y,color:p.color.toLowerCase(),opacity,visible:p.visible!==false};
}
function deserializeBuildPlates(value:unknown):BuildPlate[]{
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>BUILD_PLATE_POLICY.maximumPlates)throw Error(`A project may contain up to ${BUILD_PLATE_POLICY.maximumPlates} build plates.`);
  const plates=value.map(deserializeBuildPlate),seen=new Set<string>();
  for(const p of plates){if(seen.has(p.id))throw Error(`Duplicate build plate ID ${p.id}.`);seen.add(p.id);}
  return plates;
}
function projectBuildPlates(references:unknown):BuildPlate[]{
  if(references===undefined)return [];
  if(!references||typeof references!=='object'||Array.isArray(references))throw Error('Invalid project references.');
  return deserializeBuildPlates((references as Record<string,unknown>).buildPlates);
}
function replaceBuildPlates(plates:readonly BuildPlate[]):void{buildPlates.splice(0,buildPlates.length,...plates.map(cloneBuildPlate));}
function inferredNextBuildPlateId():number{return Math.max(0,...buildPlates.map(p=>{const n=/^bp(\d+)$/.test(p.id)?Number(p.id.slice(2)):0;return Number.isSafeInteger(n)&&n<Number.MAX_SAFE_INTEGER?n:0;}))+1;}
function createBuildPlate(settings:Partial<Omit<BuildPlate,'id'>>={}):BuildPlate{
  if(modelingOperationBusy)throw Error('Wait for the current operation before editing build plates.');
  if(buildPlates.length>=BUILD_PLATE_POLICY.maximumPlates)throw Error(`A project may contain up to ${BUILD_PLATE_POLICY.maximumPlates} build plates.`);
  const width=settings.width??BUILD_PLATE_POLICY.defaultWidth;
  const x=buildPlates.length?Math.max(...buildPlates.map(p=>p.x+p.width/2))+BUILD_PLATE_POLICY.placementGap+width/2:0;
  return executeDocumentCommand<BuildPlate>({type:'add-build-plate',label:'Add build plate',parameters:{...settings},execute(){
    const allocateId=()=>{if(!Number.isSafeInteger(nextBuildPlateId)||nextBuildPlateId>=Number.MAX_SAFE_INTEGER)nextBuildPlateId=1;return 'bp'+nextBuildPlateId++;};
    let id=allocateId();while(buildPlates.some(p=>p.id===id))id=allocateId();
    const plate=deserializeBuildPlate({name:`Build plate ${buildPlates.length+1}`,width,depth:BUILD_PLATE_POLICY.defaultDepth,x,y:0,color:BUILD_PLATE_POLICY.defaultColor,opacity:BUILD_PLATE_POLICY.defaultOpacity,visible:true,...settings,id});
    buildPlates.push(plate);return {value:plate};
  }});
}
function updateBuildPlate(id:string,settings:Omit<BuildPlate,'id'>):void{
  if(modelingOperationBusy)throw Error('Wait for the current operation before editing build plates.');
  const index=buildPlates.findIndex(p=>p.id===id);if(index<0)throw Error('The build plate no longer exists.');
  const plate=deserializeBuildPlate({...settings,id});if(JSON.stringify(plate)===JSON.stringify(buildPlates[index]))return;
  executeDocumentCommand<void>({type:'edit-build-plate',label:'Edit build plate',parameters:{id,...settings},execute(){buildPlates[index]=plate;return {};}});
}
function removeBuildPlate(id:string):void{
  if(modelingOperationBusy)throw Error('Wait for the current operation before editing build plates.');
  const index=buildPlates.findIndex(p=>p.id===id);if(index<0)throw Error('The build plate no longer exists.');
  executeDocumentCommand<void>({type:'delete-build-plate',label:'Delete build plate',parameters:{id},execute(){buildPlates.splice(index,1);return {};}});
}
