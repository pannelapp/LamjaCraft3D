const TOOL_INFO:Record<ToolName,[string,string]>={
  sketcheditor:["Sketch Editor","Choose a planar model face. Draw connected contours in the 2D workspace, then Return, position the origin with the mouse and click to insert. Escape during placement returns to editing. Drafts, guides and measurements are temporary."],
  shapes:["Shapes","Choose a shape and dimensions, then click its bottom center onto the ground, or enter X/Y/Z and Create shape."],
  select:["Objects/groups","Objects and Groups is the default. Click or drag a through-selection frame. A grouped member selects its complete group, including hidden members. Objects selects individual visible members; Groups ignores ungrouped objects. Shift/Ctrl/Cmd-click toggles a target; modifier frames add targets. Escape cancels a frame. Dedicated editing tools pick their own faces, edges and points."],
  roundchamfer:["Chamfer","Click a convex edge to round it. Setback bias 45° gives equal face distances; Curve segments controls faceting. Hover highlights the side or rim; generation starts after click with progress and Cancel. Ctrl-click toggles individual sides; Shift-click follows a connected chain turning less than 45° per vertex. Keep Shift held to add more chains on the same object; release the last modifier to start one combined operation. Escape cancels the selection."],
  thread:["Thread","Choose Add or Cut, then click a circular hole rim or circular cylinder rim. Add builds a helical ridge; Cut removes a helical groove. Hover only highlights the rim; the heavy geometry is generated after click."],
  mergefaces:["Merge Faces","Click neighboring faces on one object, Preview, then Merge Faces. Choose a reference plane and maximum adjustment. Green shows the merged face; amber shows adjusted neighbors. Undo restores the whole edit."],
  text:["Text","Enter text, hover a face to preview, then click its text center. Change size, depth or rotation and Apply Text. Click again to reposition."],
  texture:["Surface Texture","Choose Planar patch for nearby faces or Wrapped band around a round object. Click faces to add or remove them, preview, then Apply Texture. Add raises details; Cut recesses them."],
  carve:["Carve Out","Click one planar face to use as the opening. A lightweight inset on that same face shows the selected opening and wall thickness; then hollow the object inward with progress and Cancel."],
  delete:["Delete","Enable the target categories in the Tool panel. Hover a target and click. Points · dissolve / trim (off by default) removes one point with a checked closing-face preview. Esc returns to Objects/groups."],
  chamfer:["Chamfer","Click a convex edge to bevel it. Only the selected straight side is beveled; collinear split segments are treated as one side. Hole rims and circular outer rims are detected as complete loops. Ctrl-click toggles individual sides; Shift-click follows a connected chain turning less than 45° per vertex. Keep Shift held to add more chains on the same object; release the last modifier to apply together. Escape cancels. Set distance and setback bias in the Tool panel first."],
  rect:["Rectangle","Draw a rectangle. On bare ground, move upward after drawing and click to choose the extrusion height. On a face, portions outside the face are clipped automatically."],
  circle:["Circle","Choose the segment count in the Tool panel. On bare ground, draw the circle, move upward and click to choose the extrusion height. On a face it remains a normal sketch region."],
  gear:["Involute Gear","Place the center, then rotate the preview. While rotating, you can edit the gear parameters and see the outline update live before the placement click."],
  rack:["Gear Rack","Place the left pitch-line point, rotate the rack direction, then click. Rack parameters remain live during placement and use the same module and pressure-angle convention as the involute gear."],
  slot:["Slot","Place the slot center, choose its direction, and click. Length, width, and curve quality remain live while placing."],
  arcslot:["Arc Slot","Place the arc center, rotate the slot, and click. Radius, sweep, width, and curve quality update the preview live."],
  boltcircle:["Bolt Circle","Place the pattern center, rotate the first hole, and click. Count, pitch circle, hole diameter, and circle quality remain live."],
  arc:["Arc","Start and end on face edges. The arc may extend beyond the face; only the portion on the face is kept."],
  poly:["Contour","Draw contour points on a face or the ground. Click the start or press Enter to close; Backspace removes the last point. On a face, finish at the same connected boundary for an edge-to-edge region. Ground profiles continue to height selection."],
  push:["Push/Pull","Drag the logical face along its normal. Twist angle rotates the pulled section around its area center; 0° keeps ordinary Push/Pull. Type a positive distance to continue the mouse direction; negative reverses it. Without prior motion, positive is outward. Panel distance uses + out / − in."],
  move:["Move","Choose Object (default) or Point. Object moves the complete selection together. Click a selected target, move the pointer, and click again to place it — or drag and release. Choose XY/X/Y/Z in the Tool panel. Snap to grid uses the chosen mm step for mouse movement; exact typed distances remain exact. Esc cancels the active move."],
  mirror:["Mirror","Select objects or groups, then choose Picked face or World XY/XZ/YZ. Click any model face as the mirror plane, including a face on another object. World planes pass through the global origin. Keep original creates mirrored copies; turn it off to mirror the selection in place. Apply Mirror or Enter commits one Undo step. Escape clears the chosen plane."],
  rotate:["Rotate","Picked face is the default. You can also choose World XY, XZ or YZ. Click a selected face to rotate the complete selection around its center and normal. World modes use the full selection center. Drag and release, click then move and click, or type an angle. Positive continues the started rotation; negative reverses it. The angle display wraps each 360°. Esc cancels the preview."],
  guide:["Guide Line","Click two free points for a guide line. Click a model edge or an existing guide line for an offset; move the pointer or enter an exact distance in mm and press Enter."],
  guidecircle:["Guide Circle","Click the center, then choose the radius. Direct numeric input uses radius; the Tool panel uses Diameter. The center is a reusable Center snap and the circumference is construction geometry."],
  splitplane:["Split Plane","Create or select a construction plane, adjust it in the right panel, then click an ungrouped solid to split it into two closed objects. The plane is removed after a successful split; Undo restores it."],
  measure:["Measure","Click two points on the ground plane or model faces. The dimension is stored as a passive annotation and does not drive the geometry."],
  orbit:["Orbit","Drag to orbit the camera."]
};
const TOOL_PANEL_SUMMARY:Record<ToolName,string>={
  sketcheditor:"Choose a model face to open the 2D workspace. Return validates closed contours before mouse placement. One model Undo removes the complete insertion.",
  shapes:"Set dimensions and curve quality. Click to place, or enter the bottom-center X/Y/Z.",
  select:"Choose Objects and Groups (default), Objects, or Groups. Click or drag a frame through visible model geometry. Objects selects individual members; the other modes select complete groups including hidden members. Shift/Ctrl/Cmd-click toggles a target; modifier frames add targets. Escape cancels the frame. Guides and dimensions remain selectable in Objects and Groups. Selected-object properties remain available in the Selected object section.",
  roundchamfer:"Rounded is on. Set Base setback, Setback bias and Curve segments to round a convex side or complete rim. Turn Rounded off for a bevel. Extend adds an outward foot or fills an inside corner; Cut removes material. The corner angle is detected automatically.",
  thread:"Add or cut a simplified rim-aligned helical thread directly on a circular hole or cylinder rim. Presets set pitch/depth; the selected rim sets diameter and segment count.",
  mergefaces:"Click faces to add or remove them, then Preview and Merge Faces. The reference plane comes from the largest selected face by default. Adjust neighboring faces can change the shape within Maximum adjustment; disable it for a coplanar merge with fixed points.",
  text:"Create raised or engraved text with up to four centered lines and three embedded fonts. Local surface follows planar or connected curved areas automatically. Wrap around cylinder uses surface distances around a complete straight cylinder, including the seam; optional full-turn spacing keeps letter shapes unchanged. Cone/frustum and sphere wrapping follow changing circumference and may distort letters near tips or poles. Choose the object-local axis. Text must clear caps, boundaries and openings. Apply generates checked ordinary geometry with progress, Cancel and one Undo.",
  texture:"Choose Planar patch or Wrapped band. Click faces on one ungrouped object to select an area. Apply commits all selected faces together as raised or recessed geometry.",
  carve:"Hollow a supported convex solid, straight-extruded concave prism or checked concave 3D form from one planar opening. The inset marks the opening and wall thickness; progress, Cancel and Undo protect the original.",
  delete:"Checked categories control viewport deletion. Objects, Groups, Edges · flatten / trim and Points · dissolve / trim start off. Points removes a highlighted corner with a checked planar closing face, or dissolves a redundant point without changing shape. Retained points stay fixed. Hover, inspect the preview and click; pending or rejected points never delete another target. One Undo restores the edit. Keyboard/property Delete keeps its conservative selected-entity behavior.",
  chamfer:"Rounded is off. Set Distance and Setback bias to bevel a convex side or complete rim. Turn Rounded on to round it. Extend adds material; Cut removes it. The corner angle is detected automatically.",
  rect:"Drag a rectangle, or click its start and type width×height such as 20x10, then Enter. Face drawings are clipped to the face; ground profiles continue to height selection.",
  circle:"Choose 3–128 segments in the Tool panel, then click center and radius, or type a radius and Enter. Face drawings are clipped; ground profiles continue to height selection. Created circles are editable facets.",
  gear:"Create an involute spur-gear outline with an optional center hole. Parameters remain live while the oriented preview is waiting for placement.",
  rack:"Create an involute-matching straight gear rack. Place the left pitch-line point, choose direction, then extrude or Push/Pull.",
  slot:"Create a straight rounded slot as an ordinary planar region, with live dimensions and orientation.",
  arcslot:"Create a curved slot from centerline radius, sweep angle, and width, with live orientation.",
  boltcircle:"Create a circular pattern of equal circle regions. On ground, the pattern extrudes as separate solids with one shared height gesture.",
  arc:"Click a start point on a face edge, an endpoint on an edge, then a curvature point. Start → curvature → endpoint also works. Portions outside the face are clipped.",
  poly:"Click contour points on a face or ground. Close at the start or press Enter; Backspace removes the last point. On a face, finishing at the same connected boundary creates an edge-to-edge region. Ground profiles continue to height selection.",
  push:"Move a logical face along its normal. Snap ignores its own outline and centers and points hidden behind solids. Camera navigation preserves the current depth and refreshes mouse scaling. Choose Proportional Taper to scale the whole section including holes, or Edge angle for equal wall slopes. Taper and Twist can be combined on convex/concave and holed sections. Keep both at 0° for ordinary Push/Pull.",
  move:"Object (default) moves the complete selection, including multiple groups and extra objects. Point moves one highlighted corner on an ungrouped model; other corners stay fixed and warped faces become triangles. Use click → move → click, or drag → release. Choose XY/X/Y/Z; X/Y/Z keys lock an axis and A restores XY while Move is active. Positive typed distance continues the chosen direction; negative reverses it. With no prior motion, X/Y/Z uses the positive world axis. Esc cancels.",
  mirror:"Choose the mirror plane, then Apply Mirror. Picked face uses any clicked face. World XY/XZ/YZ pass through the global origin. Keep original creates mirrored copies of the complete selection.",
  rotate:"Picked face is the default: click a selected face to set one axis and pivot for the complete selection. World XY/XZ/YZ use global Z/Y/X, with the selection bounds center for multiple objects or the origin for one object. Drag, click → move → click, or type an angle. Positive continues the started direction; negative reverses it. With no prior motion, positive follows the plane normal. Esc cancels.",
  guide:"Click two free points for a guide line, or an edge/existing guide for a parallel offset. Move or type the offset in mm and press Enter. Show through solids controls visibility only.",
  guidecircle:"Click the center on a face or ground, then set the radius by pointer or direct numeric input. The Tool panel uses Diameter. The guide provides center/circumference snaps and does not change solid geometry.",
  splitplane:"Create or select a construction plane, then click a solid to split it. The plane is consumed by a successful split and restored by Undo.",
  measure:"Create a passive point-to-point dimension annotation.",
  orbit:"Orbit with the Orbit tool or right-drag. Shift+right-drag or middle-drag pans; the wheel zooms toward the cursor. F fits visible objects. Navigation preserves a pending modeling gesture."
};
const TOOL_OPTION_PANELS:Partial<Record<ToolName,string>>={delete:'deleteToolOptions',shapes:'shapeToolOptions',select:'selectToolOptions',push:'pushToolOptions',move:'moveToolOptions',rotate:'rotateToolOptions',mirror:'mirrorToolOptions',circle:'circleToolOptions',gear:'gearToolOptions',rack:'rackToolOptions',slot:'slotToolOptions',arcslot:'arcSlotToolOptions',boltcircle:'boltCircleToolOptions',guide:'guideToolOptions',guidecircle:'guideCircleToolOptions',splitplane:'splitPlaneToolOptions',chamfer:'chamferToolOptions',roundchamfer:'roundedChamferToolOptions',thread:'threadToolOptions',mergefaces:'mergeFacesToolOptions',text:'textToolOptions',texture:'textureToolOptions',carve:'carveToolOptions'};
let toastTimer:any=null;
let modelingOperationBusy=false,modelingOperationCancel:(()=>void)|null=null;
function toast(msg:string){const el=$('toast');el.textContent=msg;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2600);}
function updateModelingOperation(progress:number,message?:string){
  if(message)$('modelingBusyText').textContent=message;const value=Math.max(0,Math.min(100,progress)),bar=$('modelingBusyProgress') as HTMLProgressElement;bar.value=value;$('modelingBusyPercent').textContent=`${Math.round(value)}%`;$('modelingBusySpinner').classList.add('hidden');$('modelingBusyProgressWrap').classList.remove('hidden');
}
function beginModelingOperation(message:string,options:{progress?:number;onCancel?:()=>void}={}){
  modelingOperationBusy=true;modelingOperationCancel=options.onCancel||null;const el=$('modelingBusy'),cancel=$('modelingBusyCancel') as HTMLButtonElement;$('modelingBusyText').textContent=message;$('modelingBusySpinner').classList.toggle('hidden',options.progress!==undefined);$('modelingBusyProgressWrap').classList.toggle('hidden',options.progress===undefined);cancel.classList.toggle('hidden',!modelingOperationCancel);cancel.disabled=false;el.classList.add('show');el.setAttribute('aria-hidden','false');if(options.progress!==undefined)updateModelingOperation(options.progress,message);
}
function cancelModelingOperation(){if(!modelingOperationCancel)return;const cancel=modelingOperationCancel;modelingOperationCancel=null;const button=$('modelingBusyCancel') as HTMLButtonElement;button.disabled=true;$('modelingBusyText').textContent='Cancelling…';cancel();}
function endModelingOperation(){modelingOperationBusy=false;modelingOperationCancel=null;const el=$('modelingBusy');el.classList.remove('show');el.setAttribute('aria-hidden','true');$('modelingBusyCancel').classList.add('hidden');}
function showObjectCheckReport(name:string,report:ObjectCheckResult){
  $('objectCheckTitle').textContent=`Object check · ${name}`;
  $('objectCheckSummary').textContent=report.status==='passed'?'Passed — no errors found by the current integrity checks.':report.status==='failed'?`Failed — ${report.errors.length} issue${report.errors.length===1?'':'s'} found.`:'Incomplete — the object could not be fully checked.';
  const c=report.counts;
  $('objectCheckCounts').textContent=`${c.faces} faces · ${c.vertices} vertices · ${c.halfEdges} half-edges · ${c.loops} loops · Volume: ${report.volume===null?'unavailable':`${fmt(report.volume)} mm³`}`;
  $('objectCheckAdvice').textContent=report.status==='passed'?'If a new edit reports Open edge, its candidate result may have failed even though this object passes. The failed edit is rejected.':report.status==='failed'?'The current object has integrity errors. Open edge means an edge lacks its opposite neighbor. Keep a project copy and investigate the geometry or return to an earlier valid state.': 'This result is not a pass. Keep a project copy for diagnosis.';
  $('objectCheckErrors').textContent=report.errors.join('\n');
  $('objectCheckErrors').classList.toggle('hidden',report.errors.length===0);
  $('objectCheckDialog').showModal();
}
function checkSelectedObject(){
  if(modelingOperationBusy)return;
  const object=current();
  if(!object||selectedGroup()||selectedObjectIds().length!==1){toast('Select one ungrouped object to check.');return;}
  if(pointer){toast('Finish or cancel the active gesture before checking.');return;}
  const sourceSolid=object.solid,revision=modelRevision,name=object.name;
  let cancelled=false;
  const job=geometryApi.checkObjectAsync(sourceSolid);
  beginModelingOperation('Checking the complete selected object…',{onCancel:()=>{cancelled=true;job.cancel();}});
  $('checkObjectBtn').disabled=true;
  void job.promise.then(report=>{
    if(cancelled)return;
    if(modelRevision!==revision||objects.find(o=>o.id===object.id)?.solid!==sourceSolid){toast('The model changed during the check. Run Check Object again.');return;}
    endModelingOperation();
    showObjectCheckReport(name,report);
  }).catch(error=>{if(!cancelled)toast(`Object check could not complete: ${errorMessage(error)}`);}).finally(()=>{
    endModelingOperation();
    $('checkObjectBtn').disabled=!current()||!!selectedGroup()||selectedObjectIds().length!==1;
  });
}
$('checkObjectBtn').onclick=checkSelectedObject;
type SidebarHelpTopic='tool'|'object'|'objects';
let sidebarHelpTrigger:HTMLElement|null=null;
function sidebarHelpParagraphs(sourceId:string):string[]{
  const source=document.getElementById(sourceId);
  return source?Array.from(source.children).map(node=>(node.textContent||'').trim()).filter(Boolean):[];
}
function openSidebarHelp(topic:SidebarHelpTopic){
  if(modelingOperationBusy)return;
  let title:string,paragraphs:string[];
  if(topic==='tool'){
    title=(TOOL_INFO[tool]?.[0]||'Tool')+' help';paragraphs=[$('toolPanelSummary').textContent||''];
    const panel=TOOL_OPTION_PANELS[tool],source=tool==='sketcheditor'?'sketchEditorHelp':panel?panel+'Help':null;if(source)paragraphs.push(...sidebarHelpParagraphs(source));
  }else if(topic==='objects'){
    title='Objects and visibility';paragraphs=sidebarHelpParagraphs('objectsSectionHelp');
  }else if(selectedGroup()){
    title='Group properties';paragraphs=sidebarHelpParagraphs('groupPropertiesHelp');
  }else if(modelDocument.selection?.kind==='guide'&&guidePlaneById(modelDocument.selection.guideId)){
    title='Split plane properties';paragraphs=sidebarHelpParagraphs('guidePlanePropertiesHelp');
  }else{
    title='Object properties';paragraphs=sidebarHelpParagraphs('objectPropertiesHelp');
    if(!$('sketchPanel').classList.contains('hidden'))paragraphs.push(...sidebarHelpParagraphs('sketchPanelHelp'));
  }
  $('sidebarHelpTitle').textContent=title;
  const body=$('sidebarHelpBody');body.replaceChildren();
  for(const text of paragraphs.filter(value=>value.trim())){const paragraph=document.createElement('p');paragraph.textContent=text;body.append(paragraph);}
  sidebarHelpTrigger=$(topic==='tool'?'toolHelpBtn':topic==='objects'?'objectsHelpBtn':'objectHelpBtn');
  const dialog=$('sidebarHelpDialog') as HTMLDialogElement;if(!dialog.open)dialog.showModal();
}
$('toolHelpBtn').onclick=()=>openSidebarHelp('tool');
$('objectHelpBtn').onclick=()=>openSidebarHelp('object');
$('objectsHelpBtn').onclick=()=>openSidebarHelp('objects');
$('closeSidebarHelpBtn').onclick=()=>($('sidebarHelpDialog') as HTMLDialogElement).close();
$('sidebarHelpDialog').addEventListener('close',()=>{sidebarHelpTrigger?.focus();sidebarHelpTrigger=null;});
function isChamferTool(name:ToolName):boolean{return name==='chamfer'||name==='roundchamfer';}
function selectChamferTool(){setTool($('chamferRounded').checked?'roundchamfer':'chamfer');}
function changeChamferMode(){
  if(modelingOperationBusy){$('chamferRounded').checked=tool==='roundchamfer';return;}
  selectChamferTool();
}
function syncChamferMode(name:ToolName){
  if(!isChamferTool(name))return;
  const rounded=name==='roundchamfer',previous=isChamferTool(tool)?tool==='roundchamfer':!!$('chamferRounded').checked;
  if(previous!==rounded){
    $(rounded?'roundedChamferRadius':'chamferDistance').value=$(previous?'roundedChamferRadius':'chamferDistance').value;
    $(rounded?'roundedChamferAngle':'chamferAngle').value=$(previous?'roundedChamferAngle':'chamferAngle').value;
  }
  $('chamferRounded').checked=rounded;
}
function updateToolPanel(){
  $('toolPanelTitle').textContent=TOOL_INFO[tool]?.[0]||'Tool';
  $('toolHelpBtn').title='Help for '+(TOOL_INFO[tool]?.[0]||'the active tool');$('toolHelpBtn').setAttribute('aria-label',$('toolHelpBtn').title);
  $('toolPanelSummary').textContent=TOOL_PANEL_SUMMARY[tool]||'';
  const pending=pointer?.suspendedPointer||pointer,groundHeightStep=isGroundExtrusionPointer(pending);
  $('groundExtrudeControls').classList.toggle('hidden',!groundHeightStep);$('pushFaceControls').classList.toggle('hidden',groundHeightStep);
  if(groundHeightStep){$('toolPanelTitle').textContent='Push/Pull · ground height';$('toolPanelSummary').textContent='Choose height, Taper mode and angles; Taper and Twist can be combined. Completion returns to the drawing tool.';$('groundHeight').value=String(pending.height);}
  updateRotateToolUI();
  updateMirrorToolUI();
  updateMoveToolUI();
  updateChamferSelectionStatus();
  updateMergeFacesButtons();
  updateDeleteEdgeStatus();updateDeletePointStatus();
  $('chamferFamilyToolOptions').classList.toggle('hidden',!isChamferTool(tool));
  if(isChamferTool(tool))$('chamferRounded').checked=tool==='roundchamfer';
  const activePanel=TOOL_OPTION_PANELS[tool]||null;
  for(const id of Object.values(TOOL_OPTION_PANELS))$(id).classList.toggle('hidden',id!==activePanel);
}
function setTool(name:ToolName){if(modelingOperationBusy)return;activateTool(name);if(name==='sketcheditor'){const ref=selectedFaceRef();if(ref)startSketchEditor(requireObject(ref.objectId),ref.faceId);}}
// Document replacement resets the controller while its progress overlay remains busy.
function activateTool(name:ToolName){syncChamferMode(name);cancelGesture();if(name!=='texture')clearSurfaceTextureTarget();if(name!=='text')clearFaceTextTarget();if(name!=='carve')carveTarget=null;tool=name;snapIndicator=null;clearHover();debugPreviewSolid=null;for(const b of qsa('[data-tool]'))b.classList.toggle('active',b.dataset.tool===name||(b.dataset.tool==='chamfer'&&name==='roundchamfer'));$('hint').textContent=TOOL_INFO[name]?.[1]||'';updateUI();if(name==='texture')refreshSurfaceTexturePreview();if(name==='shapes')refreshPrimitivePreview();else primitivePosition=null;requestRender();}
function setAxis(name:AxisName){axis=name;for(const b of qsa('[data-axis]'))b.classList.toggle('active',b.dataset.axis===name);}
function updateFaceSelect(o:ModelObject|null){if(o?.kind==='surface')o=null;const select=$('faceSelect');select.replaceChildren();if(!o){$('facePanel').classList.add('hidden');return;}$('facePanel').classList.remove('hidden');const ids=geometryApi.faceIds(o.solid);for(const id of ids){const opt=document.createElement('option');opt.value=id;opt.textContent=faceLabel(o,id)+' · '+id;select.append(opt);}const sf=selectedFaceRef();if(sf?.objectId===o.id&&geometryApi.hasFace(o.solid,sf.faceId))select.value=sf.faceId;else if(ids.length)select.value=ids[0];const fid=select.value;if(fid&&geometryApi.hasFace(o.solid,fid))$('faceStatus').textContent=`${faceLabel(o,fid)} · ${fmt(geometryApi.faceArea(o.solid,fid))} mm²`;else $('faceStatus').textContent='Click a face.';}
function updateSketchPanel(o:ModelObject|null){if(o?.kind==='surface')o=null;const panel=$('sketchPanel');const sf=selectedFaceRef();const fid=sf&&o&&sf.objectId===o.id?sf.faceId:null;const metadata=fid&&o&&geometryApi.hasFace(o.solid,fid)?geometryApi.faceMetadata(o.solid,fid):null;const isSketch=metadata?.provenance?.kind==='split'&&['Sketch','Contour','Circle','Gear','Rack','Slot','Arc Slot','Bolt Circle','Arc'].includes(metadata.provenance.label||'');panel.classList.toggle('hidden',!isSketch);if(!isSketch||!metadata||!o||!fid)return;const loops=geometryApi.faceLoops(o.solid,fid),basis=geometryApi.faceBasis(o.solid,fid),p2=loops.outer.map(p=>toPlane2(p,basis)),xs=p2.map(p=>p[0]),ys=p2.map(p=>p[1]),sketchLabel=metadata.provenance?.label;$('featureTitle').textContent=sketchLabel==='Contour'?'Contour region · direct face':sketchLabel==='Circle'?'Circle region · polygonized face':sketchLabel==='Arc'?'Arc region · direct face':sketchLabel==='Gear'?'Involute gear region · direct face':sketchLabel==='Rack'?'Gear rack region · direct face':sketchLabel==='Slot'?'Slot region · direct face':sketchLabel==='Arc Slot'?'Arc slot region · direct face':sketchLabel==='Bolt Circle'?'Bolt-circle region · direct face':'Sketch region · direct face';$('featureWidth').value=String(clean(Math.max(...xs)-Math.min(...xs),1e6));$('featureHeight').value=String(clean(Math.max(...ys)-Math.min(...ys),1e6));$('featureDepth').value='0';$('featureSegmentsLabel').classList.toggle('hidden',true);}
function runVisibilityAction(action:()=>void){
  if(modelingOperationBusy)return;
  cancelGesture();clearSurfaceTextureTarget();carveTarget=null;clearHover();
  chamferHover=null;roundedChamferHover=null;threadHover=null;deleteFeatureHover=null;deleteObjectHoverId=null;
  debugPickHit=null;debugSnapCandidates=[];hoverGround=null;
  try{action();}catch(error){toast(errorMessage(error));}
  requestRender();
}
function visibilityButton(ids:ObjectId[],name:string,group=false):HTMLButtonElement{
  const members=objects.filter(o=>ids.includes(o.id)),count=members.filter(isObjectVisible).length,visible=count>0;
  const button=document.createElement('button');button.type='button';button.className='visibility-button'+(!visible?' is-hidden':'');
  button.dataset.visibilityIds=ids.join(',');button.title=`${visible?'Hide':'Show'} ${group?'group':'object'}: ${name}`;
  button.setAttribute('aria-label',button.title);button.setAttribute('aria-pressed',count&&count<members.length?'mixed':String(visible));button.disabled=modelingOperationBusy;
  button.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'+(!visible?'<path d="M3 3 21 21"/>':'')+'</svg>';
  button.onclick=()=>runVisibilityAction(()=>setObjectsVisible(ids,!visible));return button;
}
function objectLockButton(ids:ObjectId[],name:string,group=false):HTMLButtonElement{
  const count=lockedObjectsIn(ids).length,allLocked=count===ids.length;
  const button=document.createElement('button');button.type='button';button.className='lock-button'+(count?' is-locked':'');
  button.dataset.lockIds=ids.join(',');button.title=`${allLocked?'Unlock':'Lock'} ${group?'group':'object'}: ${name}`;
  button.setAttribute('aria-label',button.title);button.setAttribute('aria-pressed',count&&!allLocked?'mixed':String(allLocked));button.disabled=modelingOperationBusy;
  button.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="'+(allLocked?'M8 10V6a4 4 0 0 1 8 0v4':'M8 10V6a4 4 0 0 1 7.5-2')+'"/><path d="M12 14v3"/>'+(count&&!allLocked?'<path d="M18 3h4"/>':'')+'</svg>';
  button.onclick=()=>{try{setObjectsLocked(ids,!allLocked);}catch(error){toast(errorMessage(error));}};return button;
}
// Object-list navigation belongs to the current view, never the saved project.
const expandedObjectGroups=new Set<GroupId>();
let objectListSelectionKey='',objectListPrimaryKey='',objectListSelectedIds:ObjectId[]=[],objectListSelectionRevision=-1;
function resetObjectListView():void{
  expandedObjectGroups.clear();objectListSelectionKey='';objectListPrimaryKey='';objectListSelectedIds=[];objectListSelectionRevision=-1;
  $('objectList').scrollTop=0;
}
function revealObjectListRow(box:HTMLElement,row:HTMLElement):void{
  if(!(box.clientHeight>0))return;
  const container=box.getBoundingClientRect(),item=row.getBoundingClientRect(),top=container.top+box.clientTop,bottom=top+box.clientHeight;
  if(item.top<top)box.scrollTop+=item.top-top;
  else if(item.bottom>bottom)box.scrollTop+=item.bottom-bottom;
}
function updateObjectList(disclosureFocus:GroupId|null=null){
  const box=$('objectList'),scrollTop=box.scrollTop,ids=selectedObjectIds(),selected=new Set(ids),activeGroup=selectedGroupId();
  const primaryKey=activeGroup?`group:${activeGroup}`:selectedObjectId()?`object:${selectedObjectId()}`:'',selectionKey=JSON.stringify([primaryKey,ids]);
  const reveal=selectionKey!==objectListSelectionKey||objectSelectionRevision!==objectListSelectionRevision;
  let targetKey=primaryKey;
  if(reveal&&primaryKey===objectListPrimaryKey){
    const previous=new Set(objectListSelectedIds),added=ids.filter(id=>!previous.has(id)),last=added[added.length-1];
    if(last){const group=groupForObjectId(last);targetKey=group&&group.objectIds.every(id=>selected.has(id))?`group:${group.id}`:`object:${last}`;}
  }
  if(reveal&&targetKey.startsWith('object:')){const group=groupForObjectId(targetKey.slice('object:'.length));if(group)expandedObjectGroups.add(group.id);}
  for(const id of expandedObjectGroups)if(!groupById(id))expandedObjectGroups.delete(id);
  objectListSelectionKey=selectionKey;objectListPrimaryKey=primaryKey;objectListSelectedIds=ids;objectListSelectionRevision=objectSelectionRevision;
  const grouped=new Set(groups.flatMap(g=>g.objectIds)),rows=new Map<string,HTMLElement>(),toggles=new Map<GroupId,HTMLButtonElement>();box.replaceChildren();
  const objectButton=(o:ModelObject,className='object',kindText=o.kind==='surface'?'Open surface':'B-rep')=>{const b=document.createElement('button');b.type='button';b.dataset.objectId=o.id;b.title=o.name;b.className=className+(selected.has(o.id)?' active':'')+(!isObjectVisible(o)?' is-hidden':'');b.disabled=!isObjectVisible(o)||modelingOperationBusy;const sw=document.createElement('span');sw.className='swatch';sw.style.background=o.color;const name=document.createElement('span');name.className='name';name.textContent=o.name;const kind=document.createElement('span');kind.className='kind';kind.textContent=isObjectVisible(o)?isObjectLocked(o)?'Locked':kindText:'Hidden';b.append(sw,name,kind);return b;};
  const appendRow=(button:HTMLButtonElement,eye:HTMLButtonElement,lock:HTMLButtonElement,member=false,toggle?:HTMLButtonElement)=>{const row=document.createElement('div');row.className='object-row'+(member?' group-member-row':'');if(toggle)row.append(toggle);row.append(button,eye,lock);box.append(row);return row;};
  for(const g of groups){
    const members=groupMemberObjects(g),visible=members.filter(isObjectVisible).length,expanded=expandedObjectGroups.has(g.id),b=document.createElement('button');
    b.type='button';b.dataset.groupId=g.id;b.title=g.name;b.className='object group-row'+(activeGroup===g.id||g.objectIds.every(id=>selected.has(id))?' active':'')+(!visible?' is-hidden':'');b.disabled=!visible||modelingOperationBusy;
    const sw=document.createElement('span');sw.className='swatch';sw.style.background='#177568';const name=document.createElement('span');name.className='name';name.textContent=g.name;const kind=document.createElement('span');kind.className='kind';kind.textContent=visible===members.length?`${members.length} objects`:`${visible}/${members.length} visible`;b.append(sw,name,kind);
    b.onclick=(event:MouseEvent)=>{if(modelingOperationBusy)return;if(event?.shiftKey||event?.ctrlKey||event?.metaKey)addGroupToSelection(g);else setGroupSelection(g);};
    const toggle=document.createElement('button');toggle.type='button';toggle.className='group-toggle';toggle.dataset.groupToggleId=g.id;toggle.disabled=modelingOperationBusy;
    toggle.title=`${expanded?'Collapse':'Expand'} group: ${g.name}`;toggle.setAttribute('aria-label',toggle.title);toggle.setAttribute('aria-expanded',String(expanded));
    toggle.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 6 6 6-6 6"/></svg>';
    toggle.onclick=()=>{if(modelingOperationBusy)return;const focused=document.activeElement===toggle;if(expandedObjectGroups.has(g.id))expandedObjectGroups.delete(g.id);else expandedObjectGroups.add(g.id);updateObjectList(focused?g.id:null);};
    toggles.set(g.id,toggle);rows.set(`group:${g.id}`,appendRow(b,visibilityButton(g.objectIds,g.name,true),objectLockButton(g.objectIds,g.name,true),false,toggle));
    if(expanded)for(const o of members){const child=objectButton(o,'object group-member',o.kind==='surface'?'Open surface':'Member');child.onclick=(event:MouseEvent)=>{if(modelingOperationBusy||!isObjectVisible(o))return;if(event?.shiftKey||event?.ctrlKey||event?.metaKey)toggleObjectSelection(o);else setGroupSelection(g);};rows.set(`object:${o.id}`,appendRow(child,visibilityButton([o.id],o.name),objectLockButton([o.id],o.name),true));}
  }
  for(const o of objects)if(!grouped.has(o.id)){const b=objectButton(o);b.onclick=(event:MouseEvent)=>{if(modelingOperationBusy||!isObjectVisible(o))return;if(event?.shiftKey||event?.ctrlKey||event?.metaKey)toggleObjectSelection(o);else selectObject(o);};rows.set(`object:${o.id}`,appendRow(b,visibilityButton([o.id],o.name),objectLockButton([o.id],o.name)));}
  box.scrollTop=scrollTop;
  const target=rows.get(targetKey);if(reveal&&target)revealObjectListRow(box,target);
  if(disclosureFocus)toggles.get(disclosureFocus)?.focus({preventScroll:true});
  const hidden=objects.length-visibleObjects().length;$('objectCount').textContent=String(objects.length);
  $('hideSelectedBtn').disabled=modelingOperationBusy||!selected.size;
  $('isolateSelectedBtn').disabled=modelingOperationBusy||!selected.size;
  $('showAllObjectsBtn').disabled=modelingOperationBusy||!hidden;
  $('visibilityHint').textContent=hidden?`${hidden} hidden · included in full export.`:'';$('visibilityHint').classList.toggle('hidden',!hidden);
}
$('hideSelectedBtn').onclick=()=>runVisibilityAction(()=>setObjectsVisible(selectedObjectIds(),false));
$('isolateSelectedBtn').onclick=()=>runVisibilityAction(isolateSelectedObjects);
$('showAllObjectsBtn').onclick=()=>runVisibilityAction(showAllObjects);

function updateUI(){
  updateBuildPlateUI();
  updateSplitSurfaceUI();
  if(textureTarget&&textureTarget.revision!==modelRevision)clearSurfaceTextureTarget();
  updateToolPanel();
  $('maxInsetBtn').disabled=Number($('pushTwistAngle').value)!==0||Number($('pushTaperAngle').value)!==0;
  const o=current(),g=selectedGroup(),groupMode=!!g,selectedIds=selectedObjectIds(),extras=selectedGroupExtraIds(),multi=!groupMode&&selectedIds.length>1,detailObject=!groupMode&&!multi?o:null,guideRef=modelDocument.selection?.kind==='guide'?modelDocument.selection:null,selectedPlane=guideRef?guidePlaneById(guideRef.guideId):null,dimensionRef=modelDocument.selection?.kind==='dimension'?modelDocument.selection:null,ref=modelDocument.selection,entityInfo=$('entitySelectionInfo');
  if(entityInfo){let text='';if(ref?.kind==='edge')text=`Edge ${ref.halfEdgeId} selected.`;else if(ref?.kind==='vertex')text=`Point ${ref.vertexId} selected.`;else if(ref?.kind==='face')text=`Face ${ref.faceId} selected.`;entityInfo.textContent=text;entityInfo.classList.toggle('hidden',!text);}
  $('noSelection').classList.toggle('hidden',!pastePlacement&&(!!detailObject||groupMode||!!selectedPlane));$('properties').classList.toggle('hidden',!detailObject||!!pastePlacement);$('groupProperties').classList.toggle('hidden',!groupMode||!!pastePlacement);$('guidePlaneProperties').classList.toggle('hidden',!selectedPlane||!!pastePlacement);
  $('multipleSelectionActions').classList.toggle('hidden',!!pastePlacement||(!multi&&!extras.length));$('deleteSelectedObjectsBtn').disabled=modelingOperationBusy||selectedIds.length<1;
  updateSelectionColorUI(selectedIds);updateShininessUI();
  if(pastePlacement)$('selectionColorProperties').classList.add('hidden');
  if(!groupMode&&multi)$('noSelection').textContent=`${selectedIds.length} objects selected.`;
  else if(!o&&!groupMode&&guideRef&&!selectedPlane)$('noSelection').textContent='Construction geometry · '+guideRef.guideId;
  else if(!o&&!groupMode&&dimensionRef){const d=dimensions.find(v=>v.id===dimensionRef.dimensionId);$('noSelection').textContent=d?`Dimension · ${fmt(dimensionValue(d))} mm`:'Dimension selected.';}
  else if(!o&&!groupMode)$('noSelection').textContent='No object selected.';
  if(pastePlacement)$('noSelection').textContent=`Paste placement · ${pastePlacement.objects.length} objects · click to place or Escape to cancel.`;
  if(selectedPlane){$('guidePlaneTitle').textContent=selectedPlane.label||'Split plane';$('guidePlaneName').value=selectedPlane.label||'Split plane';$('guidePlaneX').value=String(clean(selectedPlane.origin[0],1e6));$('guidePlaneY').value=String(clean(selectedPlane.origin[1],1e6));$('guidePlaneZ').value=String(clean(selectedPlane.origin[2],1e6));$('guidePlaneNX').value=String(clean(selectedPlane.normal[0],1e6));$('guidePlaneNY').value=String(clean(selectedPlane.normal[1],1e6));$('guidePlaneNZ').value=String(clean(selectedPlane.normal[2],1e6));$('guidePlaneOffset').value='0';$('useGuidePlaneForSplit').textContent=activeSplitPlaneId===selectedPlane.id?'Active split plane':'Use for Split';const axisInfo=$('guidePlaneAxisInfo');if(axisInfo)axisInfo.textContent=selectedPlane.axis?`Tilt axis · ${selectedPlane.axis.map(v=>fmt(v)).join(', ')}`:'Tilt axis follows the plane';}
  if($('splitPlaneStatus'))$('splitPlaneStatus').textContent=splitPlaneStatusText();
  if(g){$('groupStatus').textContent=`${g.objectIds.length} members${extras.length?` · ${extras.length} extra selected`:''}`;$('groupTitle').textContent=g.name;$('groupName').value=g.name;$('groupScale').value='1';const pivotSelect=$('groupScalePivot') as HTMLSelectElement,previousPivot=pivotSelect.value;pivotSelect.replaceChildren();const centerOption=document.createElement('option');centerOption.value='';centerOption.textContent='Group center';pivotSelect.append(centerOption);for(const member of groupMemberObjects(g)){const option=document.createElement('option');option.value=member.id;option.textContent=`${member.name} origin`;pivotSelect.append(option);}pivotSelect.value=g.objectIds.includes(previousPivot)?previousPivot:'';$('groupSummary').textContent=`${g.objectIds.length} member object${g.objectIds.length===1?'':'s'} move, rotate and scale together.${extras.length?` ${extras.length} other object${extras.length===1?' is':'s are'} selected. Move and Rotate include the complete selection. Ctrl+C copies the complete selection.`:' Uniform scale also scales the spacing between members. Ungroup to edit faces, features, or individual object dimensions.'}`;}
  $('undoBtn').disabled=!undoStack.length;$('redoBtn').disabled=!redoStack.length;$('deleteBtn').disabled=groupMode||multi||(!o&&!guideRef&&!dimensionRef);$('duplicateBtn').disabled=groupMode||selectedIds.length!==1;if($('copyDebugObject'))$('copyDebugObject').disabled=groupMode||selectedIds.length!==1;
  $('copyObjectsBtn').disabled=modelingOperationBusy||selectedIds.length===0;$('pasteObjectsBtn').disabled=modelingOperationBusy||!objectClipboard?.objects.length;
  $('checkObjectBtn').disabled=modelingOperationBusy||!detailObject||detailObject.kind==='surface';
  $('subtractBtn').disabled=!subtractSelectionAvailable();
  const combine=$('combineBtn');if(combine){combine.disabled=modelingOperationBusy||selectedIds.length<2||selectedIds.some(id=>objects.some(o=>o.id===id&&o.kind==='surface'));combine.title='Combine selected objects or a complete group into one connected solid';}
  const groupBtn=$('groupBtn');if(groupBtn){const canGroup=!groupMode&&selectedIds.length>=2&&selectedIds.every(id=>!groupForObjectId(id));groupBtn.disabled=!canGroup;groupBtn.title=canGroup?`Group ${selectedIds.length} selected objects`:'Select at least two ungrouped objects';}
  const addToGroup=$('addToGroupBtn');if(addToGroup){addToGroup.classList.toggle('hidden',!groupMode);addToGroup.disabled=!groupMode||extras.length===0||extras.some(id=>!!groupForObjectId(id));addToGroup.textContent=extras.length?`Add selected (${extras.length})`:'Add selected';}
  const hint=$('multiSelectHint');if(hint){hint.textContent=groupMode&&extras.length?`${extras.length} extra selected · ready to add`:!groupMode&&selectedIds.length>1?`${selectedIds.length} objects selected`:'';hint.classList.toggle('hidden',!hint.textContent);}
  updateObjectList();
  if(detailObject){for(const axis of ['dimX','dimY','dimZ'])($(axis) as HTMLInputElement).disabled=detailObject.kind==='surface';$('objName').value=detailObject.name;$('objectScale').value='1';const d=objectDimensions(detailObject);$('dimX').value=String(clean(d[0],1e6));$('dimY').value=String(clean(d[1],1e6));$('dimZ').value=String(clean(d[2],1e6));$('posX').value=String(clean(detailObject.transform.position[0],1e6));$('posY').value=String(clean(detailObject.transform.position[1],1e6));$('posZ').value=String(clean(detailObject.transform.position[2],1e6));$('rotX').value=String(clean(detailObject.transform.rotation[0],1e6));$('rotY').value=String(clean(detailObject.transform.rotation[1],1e6));$('rotZ').value=String(clean(detailObject.transform.rotation[2],1e6));$('objColor').value=detailObject.color;$('segmentsLabel').classList.add('hidden');}
  if(!detailObject)for(const axis of ['dimX','dimY','dimZ'])($(axis) as HTMLInputElement).disabled=false;
  updateFaceSelect(tool==='push'?detailObject:null);updateSketchPanel(detailObject);
  updateObjectLockUI(detailObject,g,selectedIds);

}
function numberValue(id:string){const v=Number($(id).value);if(!Number.isFinite(v))throw Error('Enter a valid number.');return v;}
function debugObjectData(o:ModelObject){
  const solid=o.solid;
  const edgeKeys=new Set<string>();
  for(const he of solid.halfEdges.values()){
    const next=solid.halfEdges.get(he.next);if(!next)continue;
    const a=he.origin,b=next.origin;edgeKeys.add(a<b?`${a}|${b}`:`${b}|${a}`);
  }
  return {
    debugFormat:'lamjacraft-3d-object-runtime',
    version:1,
    object:{
      id:o.id,name:o.name,kind:o.kind,color:o.color,
      transform:{position:[...o.transform.position],rotation:[...o.transform.rotation]},
      solid:{
        id:solid.id,
        metadata:structuredClone(solid.metadata||{}),
        vertices:[...solid.vertices.values()].map(v=>({id:v.id,position:[...v.position]})),
        halfEdges:[...solid.halfEdges.values()].map(he=>({id:he.id,origin:he.origin,twin:he.twin,next:he.next,prev:he.prev,loop:he.loop,face:he.face})),
        loops:[...solid.loops.values()].map(l=>({id:l.id,firstHalfEdge:l.firstHalfEdge,kind:l.kind})),
        faces:[...solid.faces.values()].map(f=>({id:f.id,plane:{normal:[...f.plane.normal],offset:f.plane.offset},outerLoop:f.outerLoop,innerLoops:[...f.innerLoops],material:f.material,provenance:f.provenance?{...f.provenance}:undefined,boundaryGroup:f.boundaryGroup}))
      }
    },
    selection:structuredClone(modelDocument.selection),
    stats:{vertices:solid.vertices.size,edges:edgeKeys.size,halfEdges:solid.halfEdges.size,loops:solid.loops.size,faces:solid.faces.size}
  };
}
async function writeDebugClipboard(text:string):Promise<boolean>{
  try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);return true;}}catch{}
  try{const ta=document.createElement('textarea');ta.value=text;ta.setAttribute('readonly','');ta.style.position='fixed';ta.style.left='-10000px';ta.style.top='0';document.body.appendChild(ta);ta.focus();ta.select();const ok=!!document.execCommand?.('copy');ta.remove();return ok;}catch{return false;}
}
async function copySelectedObjectDebugJSON(){
  const o=current();if(!o){toast('Select an object first.');return;}
  const text=JSON.stringify(debugObjectData(o),null,2);
  const ok=await writeDebugClipboard(text);
  const status=$('debugCopyStatus');
  if(status)status.textContent=ok?`${(text.length/1024).toFixed(1)} kB copied`:'Clipboard access was blocked';
  toast(ok?'Selected object copied as debug JSON.':'The browser blocked clipboard access.');
}
$('copyDebugObject').onclick=()=>{void copySelectedObjectDebugJSON();};
function refreshThreadDiagnosticUI(){
  const button=$('downloadThreadDiagnostic') as HTMLButtonElement|null,status=$('threadDiagnosticStatus');if(!button||!status)return;const log=lastThreadDiagnosticLog;button.disabled=!log;if(!log){status.textContent='No run recorded';return;}const count=log.events.length,label=log.outcome==='running'?'Running':log.outcome==='success'?'Success':log.outcome==='cancelled'?'Cancelled':'Failed';status.textContent=`${label} · ${count} events`;
}
function downloadLastThreadDiagnostic(){
  const log=lastThreadDiagnosticLog;if(!log){toast('No Thread diagnostic log is available yet.');return;}const text=JSON.stringify(log,null,2),stamp=(log.finishedAt||log.startedAt).replace(/[:.]/g,'-'),name=`LamjaCraft-thread-diagnostic-${stamp}.json`;download(new Blob([text],{type:'application/json'}),name);toast(`Thread diagnostic downloaded · ${(text.length/1024).toFixed(1)} kB.`);
}
$('downloadThreadDiagnostic').onclick=downloadLastThreadDiagnostic;refreshThreadDiagnosticUI();

function refreshRoundedChamferDiagnosticUI(){
  const button=$('downloadRoundedChamferDiagnostic') as HTMLButtonElement|null,status=$('roundedChamferDiagnosticStatus');if(!button||!status)return;const log=lastRoundedChamferDiagnosticLog;button.disabled=!log;if(!log){status.textContent='No run recorded';return;}const count=log.events.length,label=log.outcome==='running'?'Running':log.outcome==='success'?'Success':log.outcome==='cancelled'?'Cancelled':'Failed';status.textContent=`${label} · ${count} events`;
}
function downloadLastRoundedChamferDiagnostic(){
  const log=lastRoundedChamferDiagnosticLog;if(!log){toast('No Rounded Chamfer diagnostic log is available yet.');return;}const text=JSON.stringify(log,null,2),stamp=(log.finishedAt||log.startedAt).replace(/[:.]/g,'-'),name=`LamjaCraft-rounded-chamfer-diagnostic-${stamp}.json`;download(new Blob([text],{type:'application/json'}),name);toast(`Rounded Chamfer diagnostic downloaded · ${(text.length/1024).toFixed(1)} kB.`);
}
$('downloadRoundedChamferDiagnostic').onclick=downloadLastRoundedChamferDiagnostic;refreshRoundedChamferDiagnosticUI();
function refreshTextureDiagnosticUI(){
  const last=textureDiagnosticLogs[textureDiagnosticLogs.length-1],status=$('textureDiagnosticStatus');
  for(const id of ['downloadTextureDiagnostic','downloadTextureDiagnostics']){const button=$(id) as HTMLButtonElement|null;if(button)button.disabled=!last;}
  const clear=$('clearTextureDiagnostics') as HTMLButtonElement|null;if(clear)clear.disabled=!last||last.outcome==='running';
  if(status)status.textContent=last?`${last.outcome==='running'?'Running':last.outcome==='success'?'Success':last.outcome==='cancelled'?'Cancelled':'Failed'} · ${textureDiagnosticLogs.length}/${TEXTURE_DIAGNOSTIC_POLICY.retainedRuns} runs · ${last.events.length} events${last.droppedEvents?' · events truncated':''}`:'No run recorded';
}
function downloadTextureDiagnostics(recent:boolean){
  const last=textureDiagnosticLogs[textureDiagnosticLogs.length-1];if(!last){toast('No Texture diagnostic log is available yet.');return;}
  const data=recent?{debugFormat:'lamjacraft-3d-texture-diagnostics',formatVersion:1,capturedAt:new Date().toISOString(),retainedLimit:TEXTURE_DIAGNOSTIC_POLICY.retainedRuns,runs:textureDiagnosticLogs}:last;
  const text=JSON.stringify(data,null,2),stamp=(last.finishedAt||last.startedAt).replace(/[:.]/g,'-');
  download(new Blob([text],{type:'application/json'}),`LamjaCraft-texture-${recent?'diagnostics':'diagnostic'}-${stamp}.json`);toast(`Texture diagnostic downloaded · ${(text.length/1024).toFixed(1)} kB.`);
}
$('downloadTextureDiagnostic').onclick=()=>downloadTextureDiagnostics(false);
$('downloadTextureDiagnostics').onclick=()=>downloadTextureDiagnostics(true);
$('clearTextureDiagnostics').onclick=()=>{if(textureDiagnosticLogs.some(log=>log.outcome==='running'))return;textureDiagnosticLogs.length=0;refreshTextureDiagnosticUI();};
refreshTextureDiagnosticUI();
function profilerMs(v:number){return `${v<10?v.toFixed(2):v<100?v.toFixed(1):Math.round(v)} ms`;}
function profilerAggregate(node:ProfilerNode):{label:string;ms:number}[]{const sums=new Map<string,number>();const walk=(n:ProfilerNode)=>{for(const c of n.children){const key=`${c.category}: ${c.label}`;sums.set(key,(sums.get(key)||0)+c.durationMs);walk(c);}};walk(node);return [...sums.entries()].map(([label,ms])=>({label,ms})).sort((a,b)=>b.ms-a.ms).slice(0,5);}
function profilerGrade(ms:number){return ms<=8?'smooth':ms<=16.7?'60 Hz':ms<=50?'fast commit':ms<=100?'noticeable':'heavy';}
function updateProfilerPanel(){
  const snap=profiler.snapshot(),status=$('profilerStatus'),recent=$('profilerRecent'),bench=$('profilerBenchmarks'),aggregate=$('profilerAggregate'),category=String(($('profilerCategory') as HTMLSelectElement|null)?.value||'all'),minMs=Number(($('profilerMinMs') as HTMLSelectElement|null)?.value||0),totalSamples=snap.aggregates.reduce((n,a)=>n+a.count,0),suppressed=snap.aggregates.reduce((n,a)=>n+a.suppressed,0);
  if(status)status.textContent=`${snap.enabled?'LIVE':'Off'} · ${snap.operations.length}/${snap.retainedLimit} retained · ${totalSamples} samples · ${suppressed} fast events aggregated`;
  if(aggregate){const rows=snap.aggregates.filter(a=>a.count>1||a.suppressed>0).sort((a,b)=>b.count-a.count||b.maxMs-a.maxMs).slice(0,8);aggregate.textContent=rows.map(a=>`${a.category} · ${a.label} × ${a.count}${a.suppressed?` · ${a.suppressed} komprimert`:''}\n  avg ${profilerMs(a.totalMs/a.count)} · max ${profilerMs(a.maxMs)} · last ${profilerMs(a.lastMs)}`).join('\n\n');}
  if(recent){const roots=snap.operations.filter(r=>(category==='all'||r.category===category)&&r.durationMs>=minMs).slice(-20).reverse();recent.textContent=roots.map(r=>{const parts=profilerAggregate(r);return `${r.error?'⚠ ':''}${r.category} · ${r.label} · ${profilerMs(r.durationMs)} · ${profilerGrade(r.durationMs)}${parts.length?'\n  '+parts.map(p=>`${p.label} ${profilerMs(p.ms)}`).join('\n  '):''}${r.error?'\n  ERROR: '+r.error:''}`;}).join('\n\n');}
  if(bench){bench.textContent=snap.benchmarks.map(b=>b.error?`${b.id} ${b.label}\n  ERROR: ${b.error}`:`${b.id} ${b.label}\n  median ${profilerMs(b.medianMs)} · mean ${profilerMs(b.meanMs)} · max ${profilerMs(b.maxMs)} · n=${b.iterations}`).join('\n\n');}
}
async function copyProfilerJSON(){const text=JSON.stringify({debugFormat:'lamjacraft-3d-performance-profile',version:2,capturedAt:new Date().toISOString(),profile:profiler.snapshot()},null,2),ok=await writeDebugClipboard(text);toast(ok?'Profiler data copied as JSON.':'The browser blocked clipboard access.');}
$('profilerEnabled').addEventListener('change',()=>{profiler.setEnabled(!!$('profilerEnabled').checked);updateProfilerPanel();});
for(const id of ['profilerCategory','profilerMinMs'])$(id).addEventListener('change',updateProfilerPanel);
$('clearProfiler').onclick=()=>{profiler.clear();updateProfilerPanel();toast('Profiler data cleared.');};
$('copyProfiler').onclick=()=>{void copyProfilerJSON();};
$('runBenchmarks').onclick=()=>{const b=$('runBenchmarks');b.disabled=true;$('profilerStatus').textContent='Running fixed benchmark scenarios…';setTimeout(()=>{try{const results=runPerformanceBenchmarks();toast(`Benchmark complete · ${results.length} scenarios.`);}catch(e){toast(errorMessage(e));}finally{b.disabled=false;updateProfilerPanel();requestRender();}},20);};
updateProfilerPanel();
function applyObjectFields(){const o=current();if(!o)return;try{applyObjectProperties(o,{name:String($('objName').value||'Object').slice(0,80),dimensions:[numberValue('dimX'),numberValue('dimY'),numberValue('dimZ')],position:[numberValue('posX'),numberValue('posY'),numberValue('posZ')],rotation:[numberValue('rotX'),numberValue('rotY'),numberValue('rotZ')],color:$('objColor').value});}catch(e){toast(errorMessage(e));updateUI();}}
for(const id of ['objName','dimX','dimY','dimZ','posX','posY','posZ','rotX','rotY','rotZ'])$(id).addEventListener('change',applyObjectFields);
let colorInputObjectId:ObjectId|null=null,colorInputCommitted=false;
function beginColorInput(){const o=current();colorInputObjectId=o?.id||null;colorInputCommitted=false;}
function applyLiveObjectColor(){const o=current();if(!o||selectedGroup()||selectedObjectIds().length!==1||modelingOperationBusy)return;if(colorInputObjectId!==o.id){colorInputObjectId=o.id;colorInputCommitted=false;}try{setObjectColor(o,$('objColor').value,colorInputCommitted);colorInputCommitted=true;}catch(e){toast(errorMessage(e));updateUI();}}
$('objColor').addEventListener('focus',beginColorInput);$('objColor').addEventListener('pointerdown',beginColorInput);$('objColor').addEventListener('input',applyLiveObjectColor);$('objColor').addEventListener('change',()=>{applyLiveObjectColor();colorInputObjectId=null;colorInputCommitted=false;});$('objColor').addEventListener('blur',()=>{colorInputObjectId=null;colorInputCommitted=false;});
interface SelectionColorSession {key:string;valid:boolean;revision:number;entry:HistoryEntry|null;}
let selectionColorSession:SelectionColorSession|null=null;
function updateSelectionColorUI(ids:readonly ObjectId[]):void {
  const key=objectColorTargetKey(ids);if(selectionColorSession&&selectionColorSession.key!==key)selectionColorSession.valid=false;
  const targets=ids.map(requireObject),shown=targets.length>1,locked=targets.some(isObjectLocked);
  $('selectionColorProperties').classList.toggle('hidden',!shown);$('selectionColor').disabled=modelingOperationBusy||locked||!shown;
  if(shown){const mixed=targets.some(o=>o.color.toLowerCase()!==targets[0].color.toLowerCase());$('selectionColor').value=targets[0].color;$('selectionColorStatus').textContent=locked?'Unlock all selected objects to change their color.':`${targets.length} objects · ${mixed?'Mixed colors — choose one for all':'Same color'}`;}
  else $('selectionColorStatus').textContent='';
}
function beginSelectionColorInput():void{selectionColorSession={key:objectColorTargetKey(selectedObjectIds()),valid:true,revision:modelRevision,entry:null};}
function applyLiveSelectionColor():void {
  const ids=selectedObjectIds();if(ids.length<2||modelingOperationBusy)return;
  if(!selectionColorSession)beginSelectionColorInput();const session=selectionColorSession!;
  if(!session.valid||session.key!==objectColorTargetKey(ids)){toast('The selection changed. Choose the color again.');updateUI();return;}
  const revision=modelRevision,coalesce=!!session.entry&&session.entry===lastCommandEntry()&&session.revision===revision;
  try{setObjectsColor(ids,$('selectionColor').value,coalesce);if(modelRevision!==revision){session.entry=lastCommandEntry();session.revision=modelRevision;}}
  catch(e){toast(errorMessage(e));updateUI();}
}
$('selectionColor').addEventListener('focus',beginSelectionColorInput);$('selectionColor').addEventListener('pointerdown',beginSelectionColorInput);$('selectionColor').addEventListener('input',applyLiveSelectionColor);$('selectionColor').addEventListener('change',()=>{applyLiveSelectionColor();selectionColorSession=null;});$('selectionColor').addEventListener('blur',()=>{selectionColorSession=null;});
$('scaleObjectBtn').onclick=()=>{const o=current();if(!o)return;try{scaleObjectUniform(o,numberValue('objectScale'));toast('The object was scaled uniformly around its origin.');}catch(e){toast(errorMessage(e));updateUI();}};
function applyGuidePlaneFields(){const ref=modelDocument.selection?.kind==='guide'?modelDocument.selection:null,g=ref?guidePlaneById(ref.guideId):null;if(!g)return;try{updateGuidePlane(g.id,[numberValue('guidePlaneX'),numberValue('guidePlaneY'),numberValue('guidePlaneZ')],[numberValue('guidePlaneNX'),numberValue('guidePlaneNY'),numberValue('guidePlaneNZ')],String($('guidePlaneName').value||'Split plane'));}catch(e){toast(errorMessage(e));updateUI();}}
for(const id of ['guidePlaneName','guidePlaneX','guidePlaneY','guidePlaneZ','guidePlaneNX','guidePlaneNY','guidePlaneNZ'])$(id).addEventListener('change',applyGuidePlaneFields);
for(const b of qsa('[data-plane-normal]'))b.onclick=()=>{const ref=modelDocument.selection?.kind==='guide'?modelDocument.selection:null,g=ref?guidePlaneById(ref.guideId):null;if(!g)return;const values=String(b.dataset.planeNormal||'0,0,1').split(',').map(Number),normal:[number,number,number]=[values[0],values[1],values[2]];try{updateGuidePlane(g.id,g.origin,normal,g.label);}catch(e){toast(errorMessage(e));}};
$('offsetGuidePlaneBtn').onclick=()=>{const ref=modelDocument.selection?.kind==='guide'?modelDocument.selection:null,g=ref?guidePlaneById(ref.guideId):null;if(!g)return;try{offsetGuidePlane(g.id,numberValue('guidePlaneOffset'));toast('Split plane moved along its normal.');}catch(e){toast(errorMessage(e));}};
$('rotateGuidePlaneBtn').onclick=()=>{const ref=modelDocument.selection?.kind==='guide'?modelDocument.selection:null,g=ref?guidePlaneById(ref.guideId):null;if(!g)return;const axisName=String($('guidePlaneRotateAxis').value||'x'),axis:Vec3=axisName==='y'?[0,1,0]:axisName==='z'?[0,0,1]:[1,0,0];try{rotateGuidePlane(g.id,axis,numberValue('guidePlaneRotateAngle'));toast('Split plane rotated.');}catch(e){toast(errorMessage(e));}};
$('useGuidePlaneForSplit').onclick=()=>{const ref=modelDocument.selection?.kind==='guide'?modelDocument.selection:null,g=ref?guidePlaneById(ref.guideId):null;if(!g)return;try{splitSurfaceMode='split';activateSplitPlane(g.id);setTool('splitplane');toast('Split plane active. Click an object to split it.');}catch(e){toast(errorMessage(e));}};
$('deleteGuidePlaneBtn').onclick=()=>{const ref=modelDocument.selection?.kind==='guide'?modelDocument.selection:null,g=ref?guidePlaneById(ref.guideId):null;if(!g)return;try{removeGuide(g.id);if(activeSplitPlaneId===g.id)activeSplitPlaneId=null;toast('Split plane deleted.');}catch(e){toast(errorMessage(e));}};
$('newSplitTwoPoint').onclick=prepareTwoPointSplitPlane;$('newSplitXY').onclick=()=>{try{createAxisSplitPlane([0,0,1],'Split plane XY');}catch(e){toast(errorMessage(e));}};$('newSplitXZ').onclick=()=>{try{createAxisSplitPlane([0,1,0],'Split plane XZ');}catch(e){toast(errorMessage(e));}};$('newSplitYZ').onclick=()=>{try{createAxisSplitPlane([1,0,0],'Split plane YZ');}catch(e){toast(errorMessage(e));}};$('newSplitFromClick').onclick=prepareSplitPlaneFromClick;
$('groupName').addEventListener('change',()=>{const g=selectedGroup();if(!g)return;try{renameGroup(g.id,String($('groupName').value||'Group'));}catch(e){toast(errorMessage(e));updateUI();}});$('scaleGroupBtn').onclick=()=>{const g=selectedGroup();if(!g)return;try{const pivotObjectId=String($('groupScalePivot').value||'')||null;scaleGroupUniform(g.id,numberValue('groupScale'),pivotObjectId);toast(pivotObjectId?'The group was scaled around the selected object origin.':'The group was scaled around its center.');}catch(e){toast(errorMessage(e));updateUI();}};$('groupGroundBtn').onclick=()=>{const g=selectedGroup();if(g)putGroupOnGround(g.id);};$('ungroupBtn').onclick=()=>{const g=selectedGroup();if(!g)return;try{const n=g.objectIds.length;ungroupById(g.id);toast(`Ungrouped ${n} objects.`);}catch(e){toast(errorMessage(e));}};$('duplicateGroupBtn').onclick=()=>{const g=selectedGroup();if(g)try{duplicateGroup(g.id);toast('Group duplicated.');}catch(e){toast(errorMessage(e));}};$('deleteGroupBtn').onclick=()=>{const g=selectedGroup();if(g)try{const name=g.name;removeGroupById(g.id);toast(`The group “${name}” was deleted.`);}catch(e){toast(errorMessage(e));}};
$('faceSelect').onchange=()=>{const o=current(),fid=$('faceSelect').value;if(o&&fid)setSelectedFace(o,fid);};
$('groundHeight').addEventListener('input',()=>{if(isGroundExtrusionPointer(pointer))previewGroundHeight(Number($('groundHeight').value));});
$('groundTwistAngle').addEventListener('input',()=>{if(isGroundExtrusionPointer(pointer))previewGroundHeight(pointer.height);});
$('applyGroundHeight').onclick=()=>{const raw=String($('groundHeight').value).trim();if(raw&&previewGroundHeight(Number(raw)))commitGroundHeight();else toast(isGroundExtrusionPointer(pointer)&&pointer.previewError||'Height must be greater than 0.');};
$('applyFace').onclick=()=>{const o=current(),fid=$('faceSelect').value;if(!o||!fid)return;try{const angle=pushTwistAngleValue(),taper=pushTaperAngleValue();if(taper!==0){commitTaperedFaceFromUI(o,fid,numberValue('faceDistance'),taper);return;}if(angle!==0){commitTwistedFaceFromUI(o,fid,numberValue('faceDistance'),angle);return;}const r=applyFaceMove(o,fid,numberValue('faceDistance'));toast(r.limited?`Moved ${fmt(r.distance)} mm · ${r.reason}`:`Moved ${fmt(r.distance)} mm`);}catch(e){toast(errorMessage(e));}};
$('pushTwistAngle').addEventListener('input',refreshPushSweepParameters);
$('maxInsetBtn').onclick=()=>{const o=current(),fid=$('faceSelect').value;if(!o||!fid||pushTwistAngleValue()!==0||pushTaperAngleValue()!==0)return;if(!geometryApi.hasFace(o.solid,fid))return;let step=-Math.max(...objectDimensions(o))*2;try{const r=applyFaceMove(o,fid,step);toast(`Stopped at ${fmt(r.distance)} mm`);}catch(e){toast(errorMessage(e));}};
$('deleteFeature').onclick=()=>{const o=current(),fid=selectedFaceId();if(!o||!fid)return;try{deleteSketchBoundary(o,fid);toast('The sketch boundary was removed.');}catch(e){toast(errorMessage(e));}};
$('applyFeatureSize').onclick=()=>{const o=current(),fid=selectedFaceId();if(!o||!fid)return;try{resizeSketchRegion(o,fid,numberValue('featureWidth'),numberValue('featureHeight'));}catch(e){toast(errorMessage(e));updateUI();}};
$('featureDepth').onchange=()=>{const o=current(),fid=selectedFaceId();if(!o||!fid)return;const d=numberValue('featureDepth');if(Math.abs(d)<TOL.minimumEdge)return;try{applyFaceMove(o,fid,d);toast('The sketch region was pushed/pulled '+fmt(d)+' mm.');}catch(e){toast(errorMessage(e));}};
function eventXY(e:any):[number,number]{const r=scene.getBoundingClientRect();return [e.clientX-r.left,e.clientY-r.top];}
function screenNormalScale(o:ModelObject,faceId:FaceId){cameraBasis();const f=geometryApi.face(o.solid,faceId),c=transformPoint(f.centroid,o.transform),n=transformDir(f.plane.normal,o.transform),a=project(c),b=project(V.add(c,V.mul(n,10)));const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy)||1;return {ux:dx/len,uy:dy/len,pxPerMm:len/10};}
function rectanglePoints(a:Vec2,b:Vec2):Vec2[]{return [[a[0],a[1]],[b[0],a[1]],[b[0],b[1]],[a[0],b[1]]];}
function circlePoints(c:Vec2,p:Vec2,n=48):Vec2[]{const r=v2.dist(c,p);return Array.from({length:n},(_,i)=>[c[0]+r*Math.cos(i*2*Math.PI/n),c[1]+r*Math.sin(i*2*Math.PI/n)] as Vec2);}
function faceClipPreview2(o:ModelObject,faceId:FaceId,basis:PlaneBasis,points:Vec2[]){try{const region=points.map(p=>fromPlane2(p,basis)),preview=geometryApi.previewFaceRegion(o.solid,faceId,region);return preview.components.map(c=>({outer:c.outer.map(p=>toPlane2(p,basis)),holes:c.holes.map(h=>h.map(p=>toPlane2(p,basis)))}));}catch{return [] as {outer:Vec2[];holes:Vec2[][]}[];}}
function duplicateObjectFromUI():void {if(modelingOperationBusy)return;try{duplicateObject();}catch(error){toast(errorMessage(error));}}
function addGroundPrismFromUI(profile:Vec2[],height=20){try{addGroundPrism(profile,height);}catch(e){toast(errorMessage(e));}}
function finishSurfacePolygon(){if(!pointer||pointer.type!=='poly-face')return;if(pointer.points.length<3){toast('A closed polygon requires at least three points.');return;}const {object,face,points}=pointer;try{createFaceSketch(object,face,points,'polygon');pointer=null;}catch(e){toast(errorMessage(e));requestRender();}}
function finishSurfaceOpenContour(end:Vec2){if(!pointer||pointer.type!=='poly-face')return;const p=pointer,points=[...p.points,end];try{createOpenFaceContour(p.object,p.face,points);pointer=null;}catch(e){toast(errorMessage(e));requestRender();}}
function finishSurfaceArc(endOrControl:Vec2){
  if(!pointer||pointer.type!=='arc-face'||pointer.points.length!==2)return;
  const p=pointer;
  try{
    const arc=p.arcOrder==='end-first'
      ? circularArcThrough3(p.points[0],endOrControl,p.points[1],48)
      : circularArcThrough3(p.points[0],p.points[1],endOrControl,48);
    createOpenFaceContour(p.object,p.face,arc,'Arc');pointer=null;
  }catch(e){toast(errorMessage(e));requestRender();}
}
function finishGroundPolygon(){if(!pointer||pointer.type!=='poly-ground'||pointer.points.length<3)return;const points=pointer.points.map((p:Vec2)=>[p[0],p[1]] as Vec2);pointer=null;beginGroundExtrusion(points,[],'Contour');}
scene.addEventListener('pointerdown',(event:any)=>{if(!exploreActive)dispatchToolPointerDown(event);});
scene.addEventListener('pointermove',(event:any)=>{if(!exploreActive)dispatchToolPointerMove(event);});
scene.addEventListener('pointerup',(event:any)=>{if(!exploreActive)dispatchToolPointerUp(event);});
scene.addEventListener('pointercancel',()=>{if(tool==='select')cancelGesture();});
scene.addEventListener('lostpointercapture',()=>{if(tool==='select'&&objectSelectionPointer())cancelGesture();});
scene.addEventListener('contextmenu',(e:any)=>e.preventDefault());
scene.addEventListener('wheel',(e:any)=>{if(exploreWheel(e))return;e.preventDefault();const [x,y]=eventXY(e);zoomCameraTowardCursor(x,y,e.deltaY);resumePushPointer(x,y);requestRender();},{passive:false});
function threadDimensionText(diameter:number):string{return `Ø ${fmt(diameter)} / R ${fmt(diameter*.5)}`;}
function renderThreadDimensionsReference(){const body=$('threadDimensionsBody');if(!body)return;body.textContent='';const selected=(($('threadPreset') as HTMLSelectElement|null)?.value)||'';for(const id of THREAD_PRESET_ORDER){const p=THREAD_PRESETS[id],row=document.createElement('tr');if(id===selected)row.className='current-thread';const values=[p.label,fmt(p.pitch),threadDimensionText(p.nominalDiameter),threadDimensionText(threadRecommendedRimDiameter(p,'external','add')),threadDimensionText(threadRecommendedRimDiameter(p,'external','cut')),threadDimensionText(threadRecommendedRimDiameter(p,'internal','add')),threadDimensionText(threadRecommendedRimDiameter(p,'internal','cut'))];for(const value of values){const cell=document.createElement('td');cell.textContent=value;row.appendChild(cell);}body.appendChild(row);}}
for(const id of ['textContent','textHeight','textDepth','textAngle','textOffsetX','textOffsetY','textOperation','textFont','textLineSpacing','textMapping','textCylinderAxis','textFitAround'])$(id).addEventListener('input',()=>{updateFaceTextMappingUI();if(tool==='text')refreshFaceTextPreview();});$('applyTextBtn').onclick=commitFaceTextFromUI;$('clearTextBtn').onclick=clearFaceTextTarget;
for(const b of qsa('[data-tool]'))b.onclick=()=>{if(b.dataset.tool==='chamfer')selectChamferTool();else setTool(b.dataset.tool);};for(const b of qsa('[data-axis]'))b.onclick=()=>setAxis(b.dataset.axis);for(const b of qsa('[data-view]'))b.onclick=()=>setView(b.dataset.view);for(const b of qsa('[data-close]'))b.onclick=()=>$(b.dataset.close).close();
$('threadDimensionsBtn').onclick=()=>{renderThreadDimensionsReference();$('threadDimensionsDialog').showModal();};$('modelingBusyCancel').onclick=cancelModelingOperation;
$('circleSegments').addEventListener('change',()=>{const n=circleSegmentCount();if((pointer?.type==='circle-face'||pointer?.type==='circle-ground')){pointer.segments=n;if(pointer.numericRadius>=TOL.minimumEdge)previewCircleRadius(pointer.numericRadius);}requestRender();});for(const id of ['chamferDistance','chamferAngle'])$(id).addEventListener('input',()=>{cancelChamferEdgeSelection();chamferHover=null;sceneKey='';if(tool==='chamfer'&&debugPointerXY)updateToolHoverFeedback(chamferToolController,debugPointerXY[0],debugPointerXY[1]);else requestRender();});for(const id of ['roundedChamferRadius','roundedChamferAngle','roundedChamferSegments'])$(id).addEventListener('input',()=>{cancelChamferEdgeSelection();roundedChamferHover=null;sceneKey='';if(tool==='roundchamfer'&&debugPointerXY)updateToolHoverFeedback(roundedChamferToolController,debugPointerXY[0],debugPointerXY[1]);else requestRender();});$('threadPreset').addEventListener('change',()=>{applyThreadPreset(threadHover?.kind||'external');requestRender();});for(const id of ['threadOperation','threadPitch','threadDepth','threadLength','threadProfileAngle','threadDirection'])$(id).addEventListener('input',requestRender);$('textureMapping').addEventListener('change',changeSurfaceTextureMapping);$('textureRingBtn').onclick=()=>addSurfaceTextureNeighbors(true);for(const id of ['textureBandAxis','textureBandRepeats','textureBandRows','textureType','textureOperation','textureSpacing','textureSize','textureDepth','textureAngle','textureMargin','textureOffsetX','textureOffsetY','textureReferenceX','textureReferenceY','textureReferenceZ'])$(id).addEventListener('input',()=>{if(tool==='texture')refreshSurfaceTexturePreview();});$('textureUseReference').addEventListener('change',()=>{if(tool==='texture')refreshSurfaceTexturePreview();});$('texturePickReferenceBtn').onclick=beginTextureReferencePick;$('applyMergeFacesBtn').onclick=commitMergeFacesFromUI;$('mergeFacesPreviewBtn').onclick=previewMergeFacesFromUI;$('mergeFacesClearBtn').onclick=clearMergeFacesTarget;$('mergeReferenceFace').addEventListener('change',changeMergeFacesParameters);$('mergeAdjustNeighbors').addEventListener('change',changeMergeFacesParameters);$('mergeMaximumAdjustment').addEventListener('input',changeMergeFacesParameters);$('applyTextureBtn').onclick=commitSurfaceTextureFromUI;$('textureMultiple').addEventListener('change',changeSurfaceTextureSelectionMode);$('textureClearFacesBtn').onclick=clearSurfaceTextureTarget;$('textureNeighborsBtn').onclick=()=>addSurfaceTextureNeighbors();for(const id of ['carveWallThickness','carveMinimumDetail'])$(id).addEventListener('input',()=>{if(carveTarget){const o=objects.find(v=>v.id===carveTarget!.objectId);if(o)carveStatus(carveSelectedStatus(o,carveTarget.faceId));}requestRender();});$('applyCarveBtn').onclick=commitCarveOutFromUI;for(const id of ['gearTeeth','gearModule'])$(id).addEventListener('input',()=>{syncGearPitchFromTeethModule();refreshActiveGearPreview();});$('gearPitchCircle').addEventListener('input',()=>{syncGearModuleFromPitch();refreshActiveGearPreview();});for(const id of ['gearPressureAngle','gearFlankSegments','gearCenterHole'])$(id).addEventListener('input',()=>{refreshActiveGearPreview();});for(const id of ['rackTeeth','rackModule','rackPressureAngle','rackBaseThickness'])$(id).addEventListener('input',()=>{refreshActiveRackPreview();});for(const id of ['slotLength','slotWidth','slotSegments'])$(id).addEventListener('input',()=>{refreshActiveSlotPreview();});for(const id of ['arcSlotRadius','arcSlotSweep','arcSlotWidth','arcSlotSegments'])$(id).addEventListener('input',()=>{refreshActiveArcSlotPreview();});for(const id of ['boltCircleCount','boltCirclePitch','boltCircleHole','boltCircleSegments'])$(id).addEventListener('input',()=>{refreshActiveBoltCirclePreview();});$('selectionMode').addEventListener('change',changeObjectSelectionMode);$('guideCircleDiameter').addEventListener('input',()=>{refreshActiveGuideCircleDiameter();});for(const id of ['showGroundPlane','showGuides','showDimensions','guideSnap','guideThroughSolids','inferenceSnap','livePushPreview','topologyPoints','debugEdges','debugHalfEdges','debugLoops','debugFaceIds','debugFaceNormals','debugFacePlane','debugProvenance','debugTriangulation','debugBVH','debugPicking','debugSnapCandidates','debugSketchPlane','debugPreviewSolid'])$(id).addEventListener('change',requestRender);$('debugBvhDepth').addEventListener('change',requestRender);$('groupBtn').onclick=()=>{try{const g=createGroupFromSelection();toast(`${g.objectIds.length} objects grouped.`);}catch(e){toast(errorMessage(e));}};$('addToGroupBtn').onclick=()=>{const g=selectedGroup();if(!g)return;try{const before=g.objectIds.length,target=addSelectedObjectsToGroup(g.id);toast(`${target.objectIds.length-before} object${target.objectIds.length-before===1?'':'s'} added to ${target.name}.`);}catch(e){toast(errorMessage(e));}};$('combineBtn').onclick=()=>{void runObjectCombineFromUI();};$('duplicateBtn').onclick=duplicateObjectFromUI;$('copyObjectsBtn').onclick=copyObjectsFromUI;$('pasteObjectsBtn').onclick=pasteObjectsFromUI;$('deleteBtn').onclick=removeSelectedEntity;$('deleteSelectedObjectsBtn').onclick=removeSelectedEntity;$('groundBtn').onclick=putOnGround;$('undoBtn').onclick=undo;$('redoBtn').onclick=redo;$('fitBtn').onclick=fit;$('exploreBtn').onclick=toggleExplore;$('helpBtn').onclick=()=>$('helpDialog').showModal();$('aboutBtn').onclick=()=>$('aboutDialog').showModal();$('downloadSourceProject').onclick=downloadEmbeddedSourceProject;$('inspectorToggle').onclick=()=>$('sidebar').classList.toggle('collapsed');
function handleApplicationKeyDown(e:KeyboardEvent):void {
  if(handleSketchEditorKeyDown(e))return;
  if(exploreKeyDown(e))return;
  if(modelingOperationBusy){if(e.key==='Escape'){e.preventDefault();cancelModelingOperation();}return;}
  if(document.querySelector('dialog[open]'))return;
  if(e.isComposing)return;
  const editing=['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName||'')||(document.activeElement as HTMLElement|null)?.isContentEditable===true,mod=e.ctrlKey||e.metaKey,command=mod&&!e.altKey,k=e.key.toLowerCase();
  if(command&&!e.shiftKey&&k==='s'){e.preventDefault();saveProject();return;}
  if(command&&!e.shiftKey&&k==='o'){e.preventDefault();$('fileInput').click();return;}
  if(e.key==='Escape'){e.preventDefault();if(editing)(document.activeElement as HTMLElement|null)?.blur();handleToolEscape();return;}
  if(editing)return;
  if(command&&k==='z'){e.preventDefault();e.shiftKey?redo():undo();return;}
  if(command&&!e.shiftKey&&k==='y'){e.preventDefault();redo();return;}
  if(command&&!e.shiftKey&&k==='c'){if(copyObjectsFromUI())e.preventDefault();return;}
  if(command&&!e.shiftKey&&k==='v'){e.preventDefault();pasteObjectsFromUI();return;}
  if(command&&!e.shiftKey&&k==='d'){e.preventDefault();duplicateObjectFromUI();return;}
  // Unhandled browser/OS combinations must not reach tool, axis or numeric input.
  if(mod||e.altKey)return;
  if(dispatchToolNumericKey(e))return;
  // Numeric symbols/separators may require Shift; tool letters do not. Caps Lock
  // still works because the key is normalized independently of the modifier.
  if(e.shiftKey&&/^[a-z]$/.test(k))return;
  if(dispatchToolKeyDown(e))return;
  if(['Delete','Backspace'].includes(e.key)){e.preventDefault();removeSelectedEntity();return;}
  if(k==='f'){fit();return;}
  const shortcuts:any={v:'select',r:'rect',c:'circle',i:'gear',k:'rack',s:'slot',b:'boltcircle',a:'arc',l:'poly',p:'push',m:'move',q:'rotate',g:'guide',j:'guidecircle',t:'measure',d:'delete',h:'chamfer',u:'roundchamfer',n:'thread',o:'orbit'};
  if(shortcuts[k])setTool(shortcuts[k]);
}
document.addEventListener('keydown',handleApplicationKeyDown);
document.addEventListener('keyup',e=>{if(!exploreKeyUp(e))dispatchToolKeyUp(e);});
document.addEventListener('mousemove',exploreMouseMove);
document.addEventListener('pointerlockchange',explorePointerLockChanged);
document.addEventListener('pointerlockerror',()=>{if(exploreRequestPending){exploreRequestPending=false;toast('Mouse pointer lock was not allowed. Explore was not started.');}});
window.addEventListener('blur',exitExplore);
document.addEventListener('visibilitychange',()=>{if(document.hidden)exitExplore();});
window.addEventListener('blur',cancelChamferEdgeSelection);
document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelChamferEdgeSelection();});

for(const option of Object.values(DELETE_TOOL_OPTIONS)){
  $(option.id).checked=option.defaultEnabled;
  $(option.id).addEventListener('change',refreshDeleteToolOptions);
}

$('chamferRounded').addEventListener('change',changeChamferMode);
$('chamferOperation').addEventListener('change',()=>{if(modelingOperationBusy)return;cancelChamferEdgeSelection();clearHover();sceneKey='';updateUI();if(debugPointerXY)updateToolHoverFeedback(tool==='roundchamfer'?roundedChamferToolController:chamferToolController,debugPointerXY[0],debugPointerXY[1]);else requestRender();});

$('moveTargetObject').onchange=()=>{if($('moveTargetObject').checked)setMoveTargetMode('object');};
$('moveTargetPoint').onchange=()=>{if($('moveTargetPoint').checked)setMoveTargetMode('point');};

function updateObjectLockUI(detailObject:ModelObject|null,group:ObjectGroup|null,selectedIds:readonly ObjectId[]):void{
  const lockedSelection=lockedObjectsIn(selectedIds).length>0,lockedDetail=!!detailObject&&isObjectLocked(detailObject),lockedGroup=!!group&&lockedObjectsIn(group.objectIds).length>0;
  for(const id of ['objName','objColor','dimX','dimY','dimZ','posX','posY','posZ','rotX','rotY','rotZ','objectScale','scaleObjectBtn','groundBtn','featureWidth','featureHeight','featureDepth','applyFeatureSize','deleteFeature','faceDistance','applyFace'])$(id).disabled=modelingOperationBusy||lockedDetail;
  $('maxInsetBtn').disabled=modelingOperationBusy||lockedDetail||Number($('pushTwistAngle').value)!==0||Number($('pushTaperAngle').value)!==0;
  for(const id of ['groupScale','groupScalePivot','scaleGroupBtn','groupGroundBtn','deleteGroupBtn'])$(id).disabled=modelingOperationBusy||lockedGroup;
  for(const id of ['deleteBtn','deleteSelectedObjectsBtn','combineBtn'])if(lockedSelection)$(id).disabled=true;
  // A retained cutter is a read-only input. An unlocked target may still use it.
  if(lockedSelection)$('subtractBtn').disabled=!subtractSelectionAvailable();
  const status=$('objectLockStatus');status.textContent=lockedDetail?'Locked · unlock in Objects to edit. Selection, visibility and export remain available.':'';status.classList.toggle('hidden',!lockedDetail);
  if(lockedGroup)$('groupSummary').textContent+=' A locked member protects the whole group from transforms and deletion.';
}

$('createSplitSurface').onclick=createSplitSurfaceFromUI;
$('splitSurfaceMode').onchange=()=>{if(modelingOperationBusy)return;cancelGesture();splitSurfaceMode=$('splitSurfaceMode').value==='edit'?'edit':'split';if(splitSurfaceMode==='edit'&&!activeSplitPlane()?.surface){const selected=modelDocument.selection?.kind==='guide'?guidePlaneById(modelDocument.selection.guideId):null;if(selected?.surface)activateSplitPlane(selected.id);else createSplitSurfaceFromUI();}else{updateUI();requestRender();}};
$('bendSplitSurfacePoint').onclick=bendSelectedSplitSurface;
$('resetSplitSurface').onclick=()=>{if(modelingOperationBusy)return;const g=activeSplitPlane();if(g?.surface){prepareToolForDocumentChange();setGuideSplitSurface(g.id,{...g.surface,heights:g.surface.heights.map(()=>0)});}};
$('saveSplitSurfaceTemplate').onclick=()=>{if(modelingOperationBusy)return;const g=activeSplitPlane();if(!g)return;try{prepareToolForDocumentChange();const template=splitSurfaceTemplate(g),name=(template.name||'split-surface').replace(/[<>:"/\\|?*\x00-\x1f]/g,'-');download(new Blob([JSON.stringify(template,null,2)],{type:'application/json'}),name+'.split-surface.json');toast('Split surface template downloaded.');}catch(error){toast(errorMessage(error));}};
$('loadSplitSurfaceTemplate').onclick=()=>{if(!modelingOperationBusy)$('splitSurfaceTemplateInput').click();};
$('splitSurfaceTemplateInput').onchange=async(event:Event)=>{const input=event.target as HTMLInputElement,file=input.files?.[0];input.value='';if(!file||modelingOperationBusy)return;if(file.size>SPLIT_SURFACE_POLICY.maximumTemplateBytes){toast('The split surface template is too large.');return;}const revision=modelRevision;try{const value:unknown=JSON.parse(await file.text());if(modelRevision!==revision||modelingOperationBusy)throw Error('The project changed. Load the template again.');loadSplitSurfaceTemplate(value);toast('Split surface template loaded. Move and rotate it before splitting.');}catch(error){toast(errorMessage(error));}};

for(const id of ['splitPlaneMoveAxis','splitPlaneTiltAxis'])$(id).onchange=()=>{if(modelingOperationBusy)return;cancelGesture();updateUI();requestRender();};
