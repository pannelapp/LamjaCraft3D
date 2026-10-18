import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),{sandbox,get}=createAppFixture(root),run=code=>vm.runInContext(code,sandbox),plain=value=>JSON.parse(JSON.stringify(value));
const setup=()=>plain(run(`(()=>{
 replaceObjects([]);replaceGroups([]);replaceDimensions([]);
 const target=makeObject('box'),cutter=makeObject('box'),hidden=makeObject('box'),extra=makeObject('box');
 target.name='Target';cutter.name='Cutter';cutter.transform.position=[80,0,0];hidden.hidden=true;hidden.transform.position=[110,0,0];extra.transform.position=[-80,0,0];
 objects.push(target,cutter,hidden,extra);const group={id:'order-group',name:'Cutter group',objectIds:[cutter.id,hidden.id]};groups.push(group);
 camera.target=[0,0,10];camera.distance=320;setView('top');cameraBasis();selectObject(target);updateUI();
 return {target:target.id,cutter:cutter.id,hidden:hidden.id,extra:extra.id,group:group.id};
})()`));
const button=(key,id)=>{
 const find=()=>get('objectList').children.flatMap(row=>row.children).find(element=>element.dataset?.[key]===id);
 if(key==='objectId'&&!find()){
  const groupRow=get('objectList').children.find(row=>row.children.some(element=>element.dataset.visibilityIds?.split(',').includes(id)));
  groupRow?.children.find(element=>element.dataset.groupToggleId)?.onclick();
 }
 return find();
};
const geometry=()=>run('JSON.stringify({objects:objects.map(o=>({id:o.id,solid:serializeSolid(o.solid),transform:o.transform,hidden:o.hidden})),groups,dimensions})');
function check(ids){
 assert.deepEqual(plain(run('selectedSubtractInputs()')),{targetId:ids.target,cutterGroupId:ids.group});
 assert.deepEqual(plain(run('selectedGroupExtraIds()')),[ids.target]);
 assert.deepEqual(new Set(plain(run('selectedObjectIds()'))),new Set([ids.target,ids.cutter,ids.hidden]));
 assert.equal(get('subtractBtn').disabled,false);get('subtractBtn').onclick();
 assert.equal(get('subtractTargetName').textContent,'Target');assert.equal(get('subtractCutterName').textContent,'Cutter group · 2 objects');assert.equal(get('swapSubtractBtn').disabled,true);
 get('objectSubtractDialog').close();
}
for(const modifier of ['shiftKey','ctrlKey','metaKey'])for(const route of ['group-row','member-row','viewport']){
 const ids=setup(),before=geometry(),history=run('undoStack.length'),dirty=run('dirty');
 if(route==='group-row')button('groupId',ids.group).onclick({[modifier]:true});
 if(route==='member-row')button('objectId',ids.cutter).onclick({[modifier]:true});
 if(route==='viewport'){
  const point=plain(run('project([80,0,20]).slice(0,2)'));assert.equal(run(`hitTest(${point[0]},${point[1]}).id`),ids.cutter);
  sandbox.event={button:0,buttons:1,pointerId:1,clientX:point[0],clientY:point[1],[modifier]:true};run('dispatchToolPointerDown(event)');sandbox.event.buttons=0;run('dispatchToolPointerUp(event)');
 }
 check(ids);assert.equal(geometry(),before,route);assert.equal(run('undoStack.length'),history);assert.equal(run('dirty'),dirty);
}
// Ordinary group clicks still replace selection; the earlier order is accepted.
let ids=setup();button('groupId',ids.group).onclick({});assert.deepEqual(plain(run('selectedGroupExtraIds()')),[]);assert.equal(get('subtractBtn').disabled,true);
button('objectId',ids.target).onclick({shiftKey:true});check(ids);
ids=setup();button('objectId',ids.cutter).onclick({});assert.deepEqual(plain(run('selectedGroupExtraIds()')),[]);
// Preserve all ungrouped selections rather than silently choosing one target.
ids=setup();run('toggleObjectSelection(objects[3])');button('groupId',ids.group).onclick({ctrlKey:true});assert.deepEqual(new Set(plain(run('selectedGroupExtraIds()'))),new Set([ids.target,ids.extra]));assert.equal(get('subtractBtn').disabled,true);
// Individual subtraction still uses target first and retains Swap.
ids=setup();button('objectId',ids.extra).onclick({metaKey:true});assert.deepEqual(plain(run('selectedSubtractInputs()')),{targetId:ids.target,cutterId:ids.extra});get('subtractBtn').onclick();get('swapSubtractBtn').onclick();assert.deepEqual(plain(run('objectSubtractPair')),{targetId:ids.extra,cutterId:ids.target});get('objectSubtractDialog').close();
// Busy and hidden selection handlers cannot introduce a partial selection.
ids=setup();const before=plain(run('selectedObjectIds()'));run('modelingOperationBusy=true');button('groupId',ids.group).onclick({shiftKey:true});assert.deepEqual(plain(run('selectedObjectIds()')),before);run('modelingOperationBusy=false');button('objectId',ids.hidden).onclick({ctrlKey:true});assert.deepEqual(plain(run('selectedObjectIds()')),before);
console.log('R237 Subtract selection order passed: target first for objects/groups, Shift/Ctrl/Cmd through viewport/group/member rows, complete hidden membership, direction/Swap, ordinary replacement, earlier order, ambiguous/busy/hidden guards and unchanged geometry/history.');
