// Clipboard shortcuts use the existing Move gesture, snapping and numeric
// entry. Only the final placement enters the document command/history path.
function copyObjectsFromUI():boolean{
  if(modelingOperationBusy)return false;
  if(!selectedObjectIds().length){toast('Select one or more objects or groups to copy.');return false;}
  prepareToolForDocumentChange();
  const count=copySelectedObjects();
  if(!count){toast('Select one or more objects or groups to copy.');return false;}
  updateUI();toast(`${count} object${count===1?'':'s'} copied.`);return true;
}
function pasteObjectsFromUI():boolean{
  if(modelingOperationBusy)return false;
  try{
    // Check before switching tools so an empty/full paste cannot discard a
    // valid unfinished gesture. Copy data survives New/Open and Undo/Redo.
    if(!objectClipboard?.objects.length)throw Error('Copy one or more objects or groups first.');
    assertPasteCapacity(objectClipboard);
    setTool('move');setMoveTargetMode('object');setAxis('free');cameraBasis();
    const draft=createPastePlacement(),object=draft.objects.find(isObjectVisible)||draft.objects[0],bounds=sceneBounds(draft.objects),anchor:Vec3=[(bounds.min[0]+bounds.max[0])/2,(bounds.min[1]+bounds.max[1])/2,bounds.min[2]],xy=debugPointerXY||[W/2,H/2];
    pastePlacement=draft;pastePreviewRevision++;
    pointer={type:'move-object',object,pasteDraft:draft,groupId:null,objectTransforms:null,start:[anchor[0],anchor[1],0],startX:xy[0],startY:xy[1],lastX:xy[0],lastY:xy[1],position:[...object.transform.position],rotation:[...object.transform.rotation],lastDelta:[0,0,0],sourceAnchorWorld:anchor,sourceAnchorKind:'Center',targetSnapWorld:null,numericOnly:false};
    updateMovePointer(xy[0],xy[1]);clearHover();updateUI();requestRender();
    toast('Paste placement · move the pointer and click to place. Escape cancels.');return true;
  }catch(error){toast(errorMessage(error));return false;}
}
function resumePasteMovePointer(x:number,y:number):void{
  if(pointer?.type!=='move-object'||!pointer.pasteDraft)return;
  cameraBasis();const planePoint=ground(x,y,false),delta=pointer.lastDelta as Vec3;
  if(planePoint)pointer.start=V.sub(planePoint,[delta[0],delta[1],0]);
  pointer.startX=x;pointer.startY=y+delta[2]*H/camera.distance;pointer.lastX=x;pointer.lastY=y;
}
