// Match editable import capacity so accepted solids can be saved and reopened.
const PROJECT_READ_POLICY=Object.freeze({maximumFileBytes:512*1024*1024,maximumVerticesPerObject:STL_IMPORT_POLICY.maxEditableVerticesPerShell,maximumFacesPerObject:STL_IMPORT_POLICY.maxEditableFacesPerShell,maximumBoundarySegmentsPerObject:8*STL_IMPORT_POLICY.maxEditableFacesPerShell});
const PROJECT_FILE_OBJECT_LIMIT=1000;
function validateProjectHeader(data:any):asserts data is ProjectData{if(!data||data.format!=='lamjacraft-3d'&&data.format!=='doodlelab-3d'&&data.format!=='formverk'||(data.version!==7&&data.version!==8&&data.version!==9&&data.version!==10)||data.units!=='mm'||!Array.isArray(data.objects)||!data.construction||!Array.isArray(data.construction.guides))throw Error('This file is not a LamjaCraft 3D format 7, 8, 9 or 10 project. Project formats older than format 7 are not imported by this build.');if(data.objects.length>PROJECT_FILE_OBJECT_LIMIT)throw Error(`The file contains more than ${PROJECT_FILE_OBJECT_LIMIT} objects.`);if(data.construction.guides.length>20000)throw Error('The file contains too much construction geometry.');if((Array.isArray(data.groups)?data.groups:[]).length>300)throw Error('The file contains too many groups.');if((Array.isArray(data.annotations?.dimensions)?data.annotations.dimensions:[]).length>20000)throw Error('The file contains too many dimension annotations.');}
function validateProjectObject(x:any,i:number):ModelObject{
  if(!x||(x.kind!=='solid'&&x.kind!=='surface')||!x.solid||x.solid.schema!=='poly-brep-1'||!Array.isArray(x.solid.vertices)||!Array.isArray(x.solid.faces))throw Error(`Object ${i+1} is missing a canonical poly-B-rep solid.`);
  if(!x.transform||!Array.isArray(x.transform.position)||!Array.isArray(x.transform.rotation)||x.transform.position.length!==3||x.transform.rotation.length!==3||[...x.transform.position,...x.transform.rotation].some((n:any)=>!Number.isFinite(n)))throw Error(`Object ${i+1} has an invalid transform.`);
  const segmentCount=x.solid.faces.reduce((n:number,f:any)=>n+(Array.isArray(f?.outer)?f.outer.length:0)+(Array.isArray(f?.holes)?f.holes.reduce((m:number,h:any)=>m+(Array.isArray(h)?h.length:0),0):0),0);
  if(x.solid.vertices.length>PROJECT_READ_POLICY.maximumVerticesPerObject||segmentCount>PROJECT_READ_POLICY.maximumBoundarySegmentsPerObject||x.solid.faces.length>PROJECT_READ_POLICY.maximumFacesPerObject)throw Error('The project is too large.');
  const o=deserializeProjectObject(x);if(!o.id)throw Error(`Object ${i+1} is missing an ID.`);if(o.name.length>80)o.name=o.name.slice(0,80);if(!/^#[\da-f]{6}$/i.test(o.color))throw Error(`Object ${i+1} has an invalid color.`);
  if(o.kind==='surface')return o;
  const check=checkObjectSolid(o.solid);if(check.status!=='passed')throw Error(`Object ${i+1} failed geometry check: ${check.errors[0]||'incomplete validation'}`);return o;
}

type NativeOpenMetadata=Omit<ProjectData,'objects'>&{objects:{kind:unknown;shininess?:unknown}[]};
interface NativeOpenPreparedObject {object:ModelObject;snapshot:SerializedModelObject;mesh:Mesh;bounds:Bounds3;appearance:SceneAppearance;}
type NativeOpenResponse={type:'ready';metadata:NativeOpenMetadata}|{type:'object';index:number;prepared:NativeOpenPreparedObject}|{type:'progress';progress:number;message:string}|{type:'error';message:string};
