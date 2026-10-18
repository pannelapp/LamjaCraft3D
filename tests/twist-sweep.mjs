import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),messages=[];
const context={console,performance,structuredClone,postMessage:message=>messages.push(message)};
vm.createContext(context);vm.runInContext(fs.readFileSync(resolve(root,'build/edge-feature-worker.js'),'utf8'),context);
const evidence=vm.runInContext(`(()=>{
 const demand=(condition,message)=>{if(!condition)throw Error(message);};
 const top=s=>[...s.faces.values()].find(f=>f.plane.normal[2]>.999).id;
 const check=(source,faceId,distance,angle)=>{
   const before=JSON.stringify(serializeSolid(source)),layout=twistSweepLayout(source,faceId,distance,angle),wire=previewTwistSweep(source,faceId,distance,angle),start=performance.now(),result=twistFaceSweep(source,faceId,distance,angle),elapsed=performance.now()-start;
   demand(validateSolid(result.solid,false).ok,'Twist result must be valid');
   demand(JSON.stringify(serializeSolid(source))===before,'Twist changed source');
   demand(result.distance===distance&&!result.limited,'Twist rewrote requested distance');
   const expected=layout.loops.flat().map(p=>twistSweepPoint(p,layout,1));
   if(distance>0){for(const p of expected)demand([...result.solid.vertices.values()].some(v=>V.len(V.sub(v.position,p))<TOL.plane),'Twist cap omitted a requested rotated point');demand(result.solid.faces.get(faceId)?.plane.offset===layout.face.plane.offset+distance,'Twist lost moved face identity');}
   demand(wire.bands===layout.bands&&V.len(V.sub(wire.center,twistSweepPoint(layout.center,layout,1)))<TOL.plane,'Preview must match sweep axis and band count');
   return {solid:result.solid,elapsed};
 };
 const square=primitivePrism([[-5,-4],[5,-4],[5,4],[-5,4]],1,'twist-square'),faceId=top(square);
 const right=check(square,faceId,10,20),left=check(square,faceId,10,-20),rightVolume=validateSolid(right.solid,false).volume,leftVolume=validateSolid(left.solid,false).volume;
 demand(Math.abs(rightVolume-leftVolume)<1e-5,'Twist handedness changes volume');
 demand(Math.abs(rightVolume-880)<.3,'Twist faceting has excessive volume bias');
 const straight=twistFaceSweep(square,faceId,3,0),ordinary=moveFace(square,faceId,3);demand(JSON.stringify(serializeSolid(straight.solid))===JSON.stringify(serializeSolid(ordinary.solid)),'Zero twist must be ordinary Push/Pull');
 const gearProfile=involuteGearProfile2({teeth:24,module:1,pressureAngleDeg:20,flankSegments:3}),hole=Array.from({length:24},(_,i)=>[2*Math.cos(-2*Math.PI*i/24),2*Math.sin(-2*Math.PI*i/24)]),gear=prismRegion(gearProfile,[hole],.5,'helical-gear');
 const gearFace=top(gear),gearResult=check(gear,gearFace,8,16),gearCap=faceLoopPoints(gearResult.solid,gearFace);
 demand(gearCap.holes.length===1,'Helical gear must preserve center opening');
 demand(Math.abs(faceAreaLocal(gearResult.solid,gearFace)-faceAreaLocal(gear,gearFace))<1e-5,'Twist changes cap area');
 const mesh=solidMeshLocal(gearResult.solid);for(const ids of mesh.triangles){const points=ids.map(i=>mesh.vertices[i]),cross=(a,b)=>a[0]*b[1]-a[1]*b[0],area=cross(V.sub(points[1],points[0]),V.sub(points[2],points[0]));if(Math.abs(area)>1e-10){const signs=points.map((a,i)=>cross(V.sub(points[(i+1)%3],a),V.mul(a,-1)));demand(!(signs.every(v=>v>=-1e-10)||signs.every(v=>v<=1e-10)),'Mesh surface blocks the gear center ray');}}
 const repeated=check(right.solid,faceId,2,-8);demand(repeated.solid.faces.has(faceId),'Repeated twist lost cap identity');
 const l=twistSweepLayout(gear,gearFace,8,16);demand(V.len(V.sub(l.center,[0,0,.5]))<1e-6,'Symmetric gear must rotate around its center');
 // A centroid-centered helical opening stays open at every sampled height.
 for(const v of gearResult.solid.vertices.values())if(v.position[2]>.5)demand(Math.hypot(v.position[0],v.position[1])>1.9,'Twist filled the gear center opening');
 const raised=primitivePrism([[-8,-8],[8,-8],[8,8],[-8,8]],6,'twist-cut'),split=splitFaceWithRegion(raised,top(raised),[[-2,-1,6],[2,-1,6],[2,1,6],[-2,1,6]],'Sketch'),cutBefore=JSON.stringify(serializeSolid(split.solid));
 const cut=twistFaceSweep(split.solid,split.regionFaceId,-3,12);demand(validateSolid(cut.solid,false).ok&&validateSolid(cut.solid,false).volume<validateSolid(split.solid,false).volume,'Twist Cut failed');demand(JSON.stringify(serializeSolid(split.solid))===cutBefore,'Twist Cut changed source');
 demand(cut.solid.faces.get(split.regionFaceId)?.plane.offset===3,'Twist Cut lost floor identity');
 const withBoss=moveFace(split.solid,split.regionFaceId,2).solid,floor=[...withBoss.faces.values()].find(f=>f.plane.normal[2]>.999&&Math.abs(f.plane.offset-6)<TOL.plane),second=splitFaceWithRegion(withBoss,floor.id,[[4,-1,6],[6,-1,6],[6,1,6],[4,1,6]],'Sketch'),generalAdd=twistFaceSweep(second.solid,second.regionFaceId,3,12);
 demand(validateSolid(generalAdd.solid,false).ok&&validateSolid(generalAdd.solid,false).volume>validateSolid(second.solid,false).volume,'General non-supporting Twist Add failed');
 demand(generalAdd.solid.faces.get(second.regionFaceId)?.plane.offset===9,'General Twist Add lost cap identity');
 // The same supporting-plane rule works for a side face, not only top faces.
 const side=[...square.faces.values()].find(f=>f.plane.normal[0]>.999),sideResult=twistFaceSweep(square,side.id,3,12);demand(validateSolid(sideResult.solid,false).ok,'Side-normal twist failed');
 for(const [distance,angle] of [[0,20],[1,Infinity],[1,361]]){let rejected=false;try{twistFaceSweep(square,faceId,distance,angle);}catch{rejected=true;}demand(rejected,'Invalid twist input accepted');}
 const overBudget=twistSweepLayout(gear,gearFace,8,16);let budgetRejected=false;try{twistSweepLayout(gear,gearFace,8,360);}catch(error){budgetRejected=errorMessage(error).includes('budget');}demand(budgetRejected&&overBudget.bands===8,'Twist budget must preflight dense profiles');
 // Compare the exact supporting-plane attachment with the general union on the same facets.
 const benchLayout=twistSweepLayout(square,faceId,3,8),benchStart=performance.now(),generic=csgToSolid(csgUnion(solidToCsg(square,true),twistSweepFaces(square,benchLayout,true).map(f=>csgPolygon(f.points))),square.id,{kind:'pushpull'},true),genericMs=performance.now()-benchStart,attachStart=performance.now(),attached=twistFaceSweep(square,faceId,3,8),attachmentMs=performance.now()-attachStart;
 demand(Math.abs(validateSolid(generic,false).volume-validateSolid(attached.solid,false).volume)<1e-5,'Supporting attachment differs from Boolean union');
 return {rightVolume,leftVolume,gearFaces:gearResult.solid.faces.size,gearMs:gearResult.elapsed,genericMs,attachmentMs};
})()`,context,{timeout:120000});
vm.runInContext(`{const s=primitivePrism([[-3,-2],[3,-2],[3,2],[-3,2]],1,'worker-twist'),f=[...s.faces.values()].find(f=>f.plane.normal[2]>.999);onmessage({data:{type:'face-twist',solid:s,faceId:f.id,distance:4,angleDeg:-12}});}`,context);
const result=messages.find(message=>message.type==='result'),failure=messages.find(message=>message.type==='error');
assert.equal(failure,undefined,failure?.message);assert.ok(result?.solid,'R165 worker result missing');
context.resultSolid=result.solid;assert.ok(vm.runInContext('validateSolid(resultSolid,false).ok',context));
const progress=messages.filter(message=>message.type==='progress').map(message=>message.update.progress);
assert.ok(progress.length>=4&&progress.at(-1)===100&&progress.every((p,i)=>i===0||p>=progress[i-1]),'R165 worker progress is not monotonic');
console.log('R165 twisted Push/Pull passed:',JSON.stringify(evidence));
