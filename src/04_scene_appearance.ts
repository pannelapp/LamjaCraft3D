const MODEL_APPEARANCE_POLICY=Object.freeze({creaseAngleDeg:30,facingEpsilon:1e-8,keyDirection:[-.5,-.7,1.4] as Vec3,fillDirection:[.8,.3,.6] as Vec3,ambient:.38,keyStrength:.48,fillStrength:.20,highlightStrength:.14,highlightPower:24});
function deriveSceneAppearance(mesh:Mesh):SceneAppearance {
  const normals=mesh.triangles.map(t=>V.unit(V.cross(V.sub(mesh.vertices[t[1]],mesh.vertices[t[0]]),V.sub(mesh.vertices[t[2]],mesh.vertices[t[0]])))),parent=Int32Array.from({length:mesh.triangles.length*3},(_,i)=>i),edgeMap=new Map<string,{a:number;b:number;triangles:number[]}>(),minimumDot=Math.cos(MODEL_APPEARANCE_POLICY.creaseAngleDeg*Math.PI/180);
  const root=(i:number):number=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  for(let ti=0;ti<mesh.triangles.length;ti++){const ids=mesh.triangles[ti];for(let j=0;j<3;j++){const a=ids[j],b=ids[(j+1)%3],key=a<b?`${a}|${b}`:`${b}|${a}`,edge=edgeMap.get(key);if(edge)edge.triangles.push(ti);else edgeMap.set(key,{a,b,triangles:[ti]});}}
  // Join corners only across an actual shared edge at this vertex. A path
  // elsewhere around a curved shell must not smooth over a local sharp crease.
  for(const edge of edgeMap.values())if(edge.triangles.length===2){const [a,b]=edge.triangles;if(V.dot(normals[a],normals[b])>minimumDot)for(const vertex of [edge.a,edge.b]){const x=a*3+mesh.triangles[a].indexOf(vertex),y=b*3+mesh.triangles[b].indexOf(vertex);parent[root(y)]=root(x);}}
  const sums=new Map<number,Vec3>();
  for(let ti=0;ti<mesh.triangles.length;ti++)for(let j=0;j<3;j++){const ids=mesh.triangles[ti],p=mesh.vertices[ids[j]],a=V.unit(V.sub(mesh.vertices[ids[(j+1)%3]],p)),b=V.unit(V.sub(mesh.vertices[ids[(j+2)%3]],p)),weight=Math.acos(clamp(V.dot(a,b),-1,1)),id=root(ti*3+j);sums.set(id,V.add(sums.get(id)||[0,0,0],V.mul(normals[ti],weight)));}
  for(const [id,sum] of sums)sums.set(id,V.unit(sum));
  const cornerNormals=mesh.triangles.map((_,ti)=>[0,1,2].map(j=>sums.get(root(ti*3+j))!));
  const edges=mesh.edges.map(([a,b])=>{const key=a<b?`${a}|${b}`:`${b}|${a}`,ns=(edgeMap.get(key)?.triangles||[]).map(t=>normals[t]);return {a,b,normals:ns,sharp:ns.length!==2||V.dot(ns[0],ns[1])<=minimumDot};});
  return {normals,cornerNormals,edges};
}
