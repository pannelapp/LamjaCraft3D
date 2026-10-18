import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),{sandbox,get}=createAppFixture(root),run=code=>vm.runInContext(code,sandbox),plain=value=>JSON.parse(JSON.stringify(value));
run(`(()=>{
 const first=objects[0];first.name='Rear';first.transform.position=[0,0,0];
 const front=makeObject('box');front.name='Front';front.transform.position=[0,0,30];objects.push(front);
 const distant=makeObject('cylinder');distant.name='Distant';distant.transform.position=[300,0,0];objects.push(distant);
 dimensions.push({id:'anchored',kind:'linear',a:{kind:'vertex',objectId:front.id,vertexId:[...front.solid.vertices.keys()][0],fallback:[0,0,30]},b:{kind:'world',point:[20,0,30]}});
 dimensions.push({id:'world',kind:'linear',a:{kind:'world',point:[0,0,0]},b:{kind:'world',point:[20,0,0]}});
 guides.push({id:'independent',kind:'line',point:[0,0,0],direction:[1,0,0]});
 setSelection({kind:'face',objectId:front.id,faceId:[...front.solid.faces.values()].find(f=>f.plane.normal[2]>.999).id});
 camera.target=[0,0,20];camera.distance=120;setView('top');updateUI();
})()`);
const ids=plain(run('objects.map(o=>o.id)')),[rear,front,distant]=ids;
const distantSnap=()=>run(`(()=>{const target=camera.target;camera.target=[300,0,20];cameraBasis();const o=objects[2],top=[...o.solid.faces.values()].find(f=>f.plane.normal[2]>.999),point=transformPoint(geometryApi.faceTopologyEdges(o.solid,top.id)[0].a,o.transform),q=project(point);const result=bestWorldEdgeSnap(q[0],q[1],point,allWorldEdges(),undefined,[],false,allWorldCenters());camera.target=target;cameraBasis();return result;})()`);
get('geomSnap').checked=true;assert.ok(distantSnap(),'Visible distant geometry should snap');assert.ok(run('objectWorldCenters(objects[2]).length')>0);
const geometry=()=>run('JSON.stringify(objects.map(o=>({id:o.id,solid:serializeProjectSolid(o.solid),transform:o.transform})))'),before=geometry();
const selectButton=id=>get('objectList').children.flatMap(row=>row.children).find(button=>button.dataset.objectId===id);
const eye=id=>{
 const buttons=()=>get('objectList').children.flatMap(row=>row.children),find=()=>buttons().find(button=>button.dataset.visibilityIds===id);
 if(!find()){
  const groupRow=get('objectList').children.find(row=>row.children.some(button=>button.dataset.visibilityIds?.split(',').includes(id)));
  groupRow?.children.find(button=>button.dataset.groupToggleId)?.onclick();
 }
 return find();
};
const history=run('undoStack.length');assert.equal(run('hitTest(W/2,H/2).id'),front);
assert.equal(eye(front).getAttribute('aria-pressed'),'true');assert.match(eye(front).title,/Hide object: Front/);
eye(front).onclick();assert.equal(run('hitTest(W/2,H/2).id'),rear);assert.equal(run('undoStack.length'),history+1);assert.equal(run('lastCommandEntry().type'),'hide-objects');assert.equal(run('modelDocument.selection'),null);assert.equal(run('dirty'),true);assert.equal(geometry(),before);
assert.equal(selectButton(front).disabled,true);assert.equal(eye(front).getAttribute('aria-pressed'),'false');assert.match(eye(front).title,/Show object: Front/);assert.equal(get('objectList').children.length,3);assert.equal(get('objectCount').textContent,'3');assert.match(get('visibilityHint').textContent,/1 hidden/);
assert.equal(run("allWorldEdges().some(e=>e.source?.objectId==='"+front+"')"),false);assert.equal(run("allWorldCenters().some(c=>c.source?.objectId==='"+front+"')"),false);assert.equal(run("faceSnapEdges(objects[1],[...objects[1].solid.faces.keys()][0]).length"),0);
assert.equal(run("dimensionScreenSegment(dimensions[0])"),null);assert.ok(run("dimensionScreenSegment(dimensions[1])"));assert.equal(run('guides.length'),1);assert.equal(run('dimensions.length'),2);
run('ensureScene()');assert.equal(run('triCount'),run('visibleObjects().reduce((sum,o)=>sum+sceneGeometry.mesh(o).triangles.length*3,0)'));assert.equal(run('lineCount'),run('visibleObjects().reduce((sum,o)=>sum+sceneGeometry.mesh(o).edges.length*2,0)'));assert.equal(run('topologyPointCount()'),run('visibleObjects().reduce((sum,o)=>sum+o.solid.vertices.size,0)'));
run('undo()');assert.equal(run('objects[1].hidden'),false);assert.equal(run('selectedFaceRef().objectId'),front);assert.equal(run('hitTest(W/2,H/2).id'),front);run('redo()');assert.equal(run('objects[1].hidden'),true);
eye(front).onclick();assert.equal(run('objects[1].hidden'),false);assert.equal(geometry(),before);
// Multi-selection and one-command isolation, with finite fit and explicit export semantics.
sandbox.wanted=[rear,front];run('setObjectSelection(wanted)');const isolationHistory=run('undoStack.length');get('isolateSelectedBtn').onclick();assert.deepEqual(plain(run('visibleObjects().map(o=>o.id)')),[rear,front]);assert.equal(run('undoStack.length'),isolationHistory+1);assert.equal(run('lastCommandEntry().type'),'isolate-objects');assert.equal(distantSnap(),null,'Hidden distant geometry still snapped');assert.equal(run('allWorldCenters().some(c=>c.source?.objectId===objects[2].id)'),false);assert.deepEqual(plain(run('selectedObjectIds()')),[rear,front]);
run('fit()');assert.ok(run('camera.target[0]')<100,'Fit included a distant hidden object');assert.ok(Number.isFinite(run('camera.distance')));
get('exportScope').value='all';assert.deepEqual(plain(run('exportObjects().map(o=>o.id)')),ids);get('exportScope').value='selected';assert.deepEqual(plain(run('exportObjects().map(o=>o.id)')),[rear,front]);
const unchangedHistory=run('undoStack.length');get('isolateSelectedBtn').onclick();assert.equal(run('undoStack.length'),unchangedHistory,'No-op isolation added history');
get('hideSelectedBtn').onclick();assert.equal(run('visibleObjects().length'),0);assert.equal(run('hitTest(W/2,H/2)'),null);assert.equal(run('modelDocument.selection'),null);run('ensureScene();fit()');assert.equal(run('triCount'),0);assert.equal(run('lineCount'),0);assert.equal(run('allWorldEdges().length'),0);assert.ok(run('camera.target.every(Number.isFinite)&&Number.isFinite(camera.distance)'));assert.equal(get('isolateSelectedBtn').disabled,true);assert.equal(get('hideSelectedBtn').disabled,true);assert.equal(get('showAllObjectsBtn').disabled,false);
const allHidden=plain(run('projectData()'));assert.ok(allHidden.objects.every(o=>o.hidden===true));sandbox.saved=allHidden;run('loadProject(saved)');assert.equal(run('visibleObjects().length'),0);assert.equal(run('selectedObjectIds().length'),0);assert.equal(run('modelDocument.selection.kind'),'guide');assert.equal(geometry(),before);
get('showAllObjectsBtn').onclick();assert.equal(run('visibleObjects().length'),3);const shownHistory=run('undoStack.length');get('showAllObjectsBtn').onclick();assert.equal(run('undoStack.length'),shownHistory);assert.equal(get('showAllObjectsBtn').disabled,true);
const legacy=plain(run('projectData()'));legacy.objects.forEach(o=>delete o.hidden);sandbox.saved=legacy;run('loadProject(saved)');assert.equal(run('visibleObjects().length'),3);assert.equal(run('projectData().version'),7);
for(const malformed of [null,1,'false',{},[]]){const bad=structuredClone(legacy);bad.objects[0].hidden=malformed;sandbox.saved=bad;const document=run('JSON.stringify(projectData())');assert.throws(()=>run('loadProject(saved)'),/visibility must be a boolean/);assert.equal(run('JSON.stringify(projectData())'),document);}
// Groups remain atomic organizational selections; partial member visibility is explicit.
sandbox.wanted=[rear,front];run('setObjectSelection(wanted);createGroupFromSelection()');const groupId=run('selectedGroupId()'),groupEye=()=>eye(rear+','+front);
eye(front).onclick();assert.equal(groupEye().getAttribute('aria-pressed'),'mixed');assert.equal(run('selectedGroupId()'),groupId);assert.deepEqual(plain(run('selectedObjectIds()')),[rear,front]);get('isolateSelectedBtn').onclick();assert.deepEqual(plain(run('visibleObjects().map(o=>o.id)')),[rear,front]);assert.equal(groupEye().getAttribute('aria-pressed'),'true');
const groupHistory=run('undoStack.length');groupEye().onclick();assert.equal(run('undoStack.length'),groupHistory+1);assert.equal(run('modelDocument.selection'),null);assert.equal(groupEye().getAttribute('aria-pressed'),'false');assert.equal(run('groups.length'),1);run('undo()');assert.equal(run('selectedGroupId()'),groupId);run('redo()');groupEye().onclick();assert.deepEqual(plain(run('visibleObjects().map(o=>o.id)')),[rear,front]);assert.equal(run('groups.length'),1);
// Ungrouping a partially hidden group must choose a visible primary object.
run('setGroupSelection(groups[0])');eye(rear).onclick();run('ungroupById(groups[0].id)');assert.equal(run('selectedObjectId()'),front);assert.deepEqual(plain(run('selectedObjectIds()')),[front]);assert.equal(run('objects[0].hidden'),true);run('undo()');assert.equal(run('selectedGroupId()'),groupId);get('showAllObjectsBtn').onclick();
// Visibility changes cancel a transform preview and clear tool/hover targets.
run(`ungroupById(groups[0].id);selectObject(objects[0]);setTool('move');pointer={type:'move-object',object:objects[0],position:[...objects[0].transform.position],rotation:[...objects[0].transform.rotation]};objects[0].transform.position=[99,98,97];`);
run('carveTarget={objectId:objects[0].id};textureTarget={objectId:objects[0].id};chamferHover={objectId:objects[0].id};debugPickHit={id:objects[0].id};');eye(rear).onclick();assert.equal(run('carveTarget'),null);assert.equal(run('textureTarget'),null);assert.equal(run('chamferHover'),null);assert.deepEqual(plain(run('objects[0].transform.position')),[0,0,0]);assert.equal(run('pointer'),null);assert.equal(run('hoverHit'),null);assert.equal(run('debugPickHit'),null);assert.equal(geometry(),before);
const busyDocument=run('JSON.stringify(projectData())'),busyHistory=run('undoStack.length');run("beginModelingOperation('Busy');updateUI()");assert.equal(eye(rear).disabled,true);assert.equal(get('showAllObjectsBtn').disabled,true);eye(rear).onclick();get('showAllObjectsBtn').onclick();get('isolateSelectedBtn').onclick();assert.equal(run('JSON.stringify(projectData())'),busyDocument);assert.equal(run('undoStack.length'),busyHistory);run('endModelingOperation();updateUI()');
get('showAllObjectsBtn').onclick();assert.equal(run('visibleObjects().length'),3);assert.equal(geometry(),before);
console.log('Object visibility passed: R176 eye controls, multi/group isolation, render/pick/snap/dimension/fit filtering, geometry preservation, commands/Undo/Redo, format-7 defaults/round-trip/rejection, gesture cancellation, busy guards and full/selected export semantics.');
