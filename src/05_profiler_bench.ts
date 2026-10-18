function profilerFaceByPlane(s:Solid,normal:Vec3,offset:number,tol=1e-4):FaceId{
  let best:Face|null=null,score=Infinity;
  for(const f of s.faces.values()){const q=(1-V.dot(f.plane.normal,normal))*100+Math.abs(f.plane.offset-offset);if(q<score){score=q;best=f;}}
  if(!best||score>tol)throw Error(`Benchmark could not find face n=${normal.join(',')} d=${offset}`);
  return best.id;
}
function profilerCircle(center:Vec2,r:number,n=48):Vec2[]{return Array.from({length:n},(_,i)=>[center[0]+Math.cos(i*Math.PI*2/n)*r,center[1]+Math.sin(i*Math.PI*2/n)*r] as Vec2);}
function profilerTopRegion(s:Solid,center:Vec2,r:number,n=48,z=20):{solid:Solid;faceId:FaceId}{const top=profilerFaceByPlane(s,[0,0,1],z),region=profilerCircle(center,r,n).map(p=>[p[0],p[1],z] as Vec3),split=geometryApi.splitFaceRegion(s,top,region,'Benchmark');return {solid:split.solid,faceId:split.regionFaceId};}

function performanceBenchmarkDefinitions():PerformanceBenchmarkDefinition[]{
  return [
    {id:'B01',label:'Box · move face',iterations:7,run(){const s=geometryApi.createPrism([[-20,-15],[20,-15],[20,15],[-20,15]],20,'bench_b01'),top=profilerFaceByPlane(s,[0,0,1],20);geometryApi.moveFace(s,top,10);}},
    {id:'B02',label:'Nested pocket level 3',iterations:4,run(){let s=geometryApi.createPrism([[-20,-15],[20,-15],[20,15],[-20,15]],20,'bench_b02');for(const [z,box,d] of [[20,[-12,-9,12,9],-5],[15,[-8,-6,8,6],-3],[12,[-4,-3,4,3],-2]] as [number,number[],number][]){const f=profilerFaceByPlane(s,[0,0,1],z),r:Vec3[]=[[box[0],box[1],z],[box[2],box[1],z],[box[2],box[3],z],[box[0],box[3],z]],sp=geometryApi.splitFaceRegion(s,f,r,'Benchmark');s=geometryApi.moveFace(sp.solid,sp.regionFaceId,d).solid;}geometryApi.validate(s);}},
    {id:'B03',label:'8 circular holes · 32 segments',iterations:2,run(){let s=geometryApi.createPrism([[-40,-30],[40,-30],[40,30],[-40,30]],20,'bench_b03');const centers:Vec2[]=[[-27,-15],[-9,-15],[9,-15],[27,-15],[-27,15],[-9,15],[9,15],[27,15]];for(const c of centers){const reg=profilerTopRegion(s,c,4.5,32),m=geometryApi.moveFace(reg.solid,reg.faceId,-25);s=m.solid;}solidMeshLocal(s);geometryApi.validate(s);}},
    {id:'B04',label:'Through circle · 64 segments',iterations:4,run(){const s=geometryApi.createPrism([[-20,-15],[20,-15],[20,15],[-20,15]],20,'bench_b04'),reg=profilerTopRegion(s,[0,0],6,64);geometryApi.moveFace(reg.solid,reg.faceId,-25);}},
    {id:'B05',label:'128-segment cylinder · mesh/BVH/pick',iterations:4,run(){const profile=profilerCircle([0,0],20,128),o:ModelObject={id:'bench_scene',name:'Benchmark',kind:'solid',color:'#999999',transform:{position:[0,0,0],rotation:[0,0,0]},solid:geometryApi.createPrism(profile,35,'bench_b05')};sceneGeometry.invalidateObject(o.id);sceneGeometry.mesh(o);sceneGeometry.bvh(o);sceneGeometry.pick([o],{origin:[0,0,100],dir:[0,0,-1]});sceneGeometry.invalidateObject(o.id);}},
    {id:'B06',label:'SnapEngine · 1000 edges',iterations:8,run(){const edges:SnapEdge[]=[];for(let i=0;i<1000;i++){const x=(i%50)-25,y=Math.floor(i/50)-10;edges.push({a:[x,y,0],b:[x+.8,y+.35,0]});}bestSnapCandidate({x:400,y:300,rawWorld:[0,0,0],edges,guides:[],plane:{point:[0,0,0],normal:[0,0,1]},project:p=>[400+p[0]*8,300-p[1]*8,1],radiusPx:14,geometryEnabled:true,guideEnabled:false,inferenceEnabled:false});}},
    {id:'B07',label:'Complex top face · 3 circular holes',iterations:3,run(){let s=geometryApi.createPrism([[-20,-15],[20,-15],[20,15],[-20,15]],25,'bench_b07');const feature=(c:Vec2,r:number,d:number)=>{const top=profilerFaceByPlane(s,[0,0,1],25),region=profilerCircle(c,r,48).map(p=>[p[0],p[1],25] as Vec3),sp=geometryApi.splitFaceRegion(s,top,region,'Benchmark');s=geometryApi.moveFace(sp.solid,sp.regionFaceId,d).solid;};feature([14,-6],3.6,11);feature([14,10],3.6,7);feature([-2,-2],8.5,-16);const top=profilerFaceByPlane(s,[0,0,1],25);geometryApi.moveFace(s,top,12);}}
  ];
}

function benchmarkStats(times:number[]):{min:number;median:number;mean:number;max:number}{const a=[...times].sort((x,y)=>x-y),mean=a.reduce((s,v)=>s+v,0)/Math.max(1,a.length),mid=Math.floor(a.length/2),median=a.length%2?a[mid]:(a[mid-1]+a[mid])/2;return {min:a[0]||0,median,mean,max:a[a.length-1]||0};}
function runPerformanceBenchmarks(ids?:string[]):BenchmarkResult[]{
  const defs=performanceBenchmarkDefinitions().filter(d=>!ids||ids.includes(d.id)),wasEnabled=profiler.isEnabled(),results:BenchmarkResult[]=[];
  profiler.setEnabled(true);
  try{
    for(const d of defs){
      // Warm up once so JIT/first-allocation cost does not dominate the comparison.
      // Warm-up is intentionally not recorded in the live profile tree.
      try{profiler.setEnabled(false);d.run();profiler.setEnabled(true);}catch(e){profiler.setEnabled(true);results.push({id:d.id,label:d.label,iterations:0,minMs:0,medianMs:0,meanMs:0,maxMs:0,error:e instanceof Error?e.message:String(e)});continue;}
      const times:number[]=[];let error:string|undefined;
      for(let i=0;i<d.iterations;i++){
        const start=profilerClock();
        try{profiler.measure('benchmark',`${d.id} · ${d.label}`,()=>d.run(),{iteration:i+1});times.push(Math.max(0,profilerClock()-start));}
        catch(e){error=e instanceof Error?e.message:String(e);break;}
      }
      const s=benchmarkStats(times);results.push({id:d.id,label:d.label,iterations:times.length,minMs:s.min,medianMs:s.median,meanMs:s.mean,maxMs:s.max,error});
    }
  }finally{profiler.setEnabled(wasEnabled);profiler.setBenchmarks(results);}
  return results;
}
