// Shapes owns parameter/placement state. Canonical geometry is created only
// through geometryApi and committed by addParametricObject's document command.
const PRIMITIVE_FIELDS=geometryApi.primitiveFields;
let primitiveKind:PrimitiveKind='sphere';
const primitiveSettings=new Map<PrimitiveKind,PrimitiveParameters>();
let primitivePreview:{key:string;solid:Solid;edges:{a:Vec3;b:Vec3}[]}|null=null;
let primitivePosition:Vec3|null=null;
function primitiveInputId(field:PrimitiveField):string{return 'shape'+field[0].toUpperCase()+field.slice(1);}
function currentPrimitiveDefinition():PrimitiveDefinition{return geometryApi.primitiveDefinitions.find(d=>d.kind===primitiveKind)!;}
function readPrimitiveParameters():PrimitiveParameters {
  const p={...(primitiveSettings.get(primitiveKind)||geometryApi.primitiveDefaults(primitiveKind))};
  for(const field of [...currentPrimitiveDefinition().fields,'segments','profileSegments'] as PrimitiveField[]){const raw=String($(primitiveInputId(field)).value).trim();p[field]=raw===''?NaN:Number(raw);}
  return p;
}
function readPrimitivePosition():Vec3 {
  return ['shapeX','shapeY','shapeZ'].map(id=>{const raw=String($(id).value).trim();return raw===''?NaN:Number(raw);}) as Vec3;
}
function showPrimitiveError(message:string):void {
  primitivePreview=null;primitivePosition=null;$('shapeStatus').textContent=message;$('shapeStatus').classList.add('shape-error');$('createShapeBtn').disabled=true;requestRender();
}
function refreshPrimitivePreview():boolean {
  if(tool!=='shapes'||modelingOperationBusy)return false;
  try{
    const p=readPrimitiveParameters(),position=readPrimitivePosition();if(position.some(v=>!Number.isFinite(v)))throw Error('Enter finite X, Y and Z coordinates.');
    const key=JSON.stringify(p);
    if(primitivePreview?.key!==key){const solid=geometryApi.createPrimitive(p,'preview_shape');primitivePreview={key,solid,edges:geometryApi.edges(solid)};}
    primitiveSettings.set(primitiveKind,p);primitivePosition=position;
    const allowed=objects.length<PROJECT_CAPACITY_POLICY.maximumObjects;
    $('shapeStatus').textContent=allowed?`${primitivePreview.solid.faces.size} faces · click to place`:`Project limit: ${PROJECT_CAPACITY_POLICY.maximumObjects} objects.`;
    $('shapeStatus').classList.toggle('shape-error',!allowed);$('createShapeBtn').disabled=!allowed;requestRender();return allowed;
  }catch(error){showPrimitiveError(errorMessage(error));return false;}
}
function loadPrimitiveControls():void {
  const definition=currentPrimitiveDefinition(),p=primitiveSettings.get(primitiveKind)||geometryApi.primitiveDefaults(primitiveKind);
  for(const field of Object.keys(PRIMITIVE_FIELDS) as PrimitiveField[]){
    const shown=definition.fields.includes(field)||field==='segments'&&definition.curved||field==='profileSegments'&&definition.profile;
    $(primitiveInputId(field)+'Control').classList.toggle('hidden',!shown);$(primitiveInputId(field)).value=String(p[field]);
  }
  primitivePreview=null;if(tool==='shapes')refreshPrimitivePreview();
}
function updatePrimitivePlacement(x:number,y:number):boolean {
  if(tool!=='shapes'||modelingOperationBusy)return false;
  clearHover();debugPreviewSolid=null;
  const point=snappedGroundPoint(x,y);
  if(!point){primitivePosition=null;snapIndicator=null;$('coordinates').textContent='Ground plane is outside this view · use X/Y/Z or orbit';requestRender();return false;}
  $('shapeX').value=String(clean(point[0]));$('shapeY').value=String(clean(point[1]));
  if(!refreshPrimitivePreview())return false;
  $('coordinates').textContent=`${currentPrimitiveDefinition().label} · ${primitivePosition!.map(fmt).join(', ')} mm`;
  return true;
}
function commitPrimitiveFromUI():boolean {
  if(tool!=='shapes'||modelingOperationBusy)return false;
  if(!refreshPrimitivePreview())return false;
  try{addParametricObject(readPrimitiveParameters(),readPrimitivePosition());pointer=null;primitivePosition=null;clearToolNumericEntry();toast(`${currentPrimitiveDefinition().label} created. One Undo removes it.`);requestRender();return true;}
  catch(error){showPrimitiveError(errorMessage(error));return false;}
}
const primitiveToolController:ToolController={
  name:'shapes',parameters:TOOL_PARAMETERS.none,
  pointerDown({x,y}){if(updatePrimitivePlacement(x,y)){pointer={type:'shape-place'};return true;}return false;},
  pointerMove({x,y}){if(pointer?.type!=='shape-place')return false;updatePrimitivePlacement(x,y);return true;},
  pointerUp({x,y,event}){if(pointer?.type!=='shape-place'||event.button!==0)return false;pointer=null;if(updatePrimitivePlacement(x,y))commitPrimitiveFromUI();return true;},
  cancel(){primitivePosition=null;snapIndicator=null;requestRender();},
};
function drawPrimitivePreview():void {
  if(!ctx||tool!=='shapes'||!primitivePreview||!primitivePosition)return;
  for(const edge of primitivePreview.edges)path3([V.add(edge.a,primitivePosition),V.add(edge.b,primitivePosition)],'rgba(23,117,104,.60)',true,1);
  const center=project(primitivePosition);label(currentPrimitiveDefinition().label,[center[0],center[1]+20],'#177568');
}
function initializePrimitiveTool():void {
  const select=$('shapeKind') as HTMLSelectElement;
  for(const definition of geometryApi.primitiveDefinitions){const option=document.createElement('option');option.value=definition.kind;option.textContent=definition.label;select.append(option);}
  select.value=primitiveKind;
  select.addEventListener('change',()=>{if(modelingOperationBusy)return;primitiveKind=select.value as PrimitiveKind;pointer=null;loadPrimitiveControls();});
  for(const field of Object.keys(PRIMITIVE_FIELDS) as PrimitiveField[])$(primitiveInputId(field)).addEventListener('input',refreshPrimitivePreview);
  for(const id of ['shapeX','shapeY','shapeZ']){$(id).value='0';$(id).addEventListener('input',refreshPrimitivePreview);}
  $('createShapeBtn').onclick=commitPrimitiveFromUI;loadPrimitiveControls();
}
