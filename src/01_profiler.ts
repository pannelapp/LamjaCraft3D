function profilerClock():number{return typeof performance!=='undefined'&&typeof performance.now==='function'?performance.now():Date.now();}

const profiler:ProfilerService=(()=>{
  let enabled=false;
  let sequence=1;
  const roots:ProfilerNode[]=[];
  const stack:ProfilerNode[]=[];
  const aggregateMap=new Map<string,ProfilerAggregate>();
  let benchmarks:BenchmarkResult[]=[];
  // High-frequency scene/snap events are useful statistically, but should not evict
  // commits and geometry operations from the live history.
  const MAX_ROOTS=300,MAX_CHILDREN=320,FAST_EVENT_THRESHOLD_MS=.25;
  const cloneNode=(n:ProfilerNode):ProfilerNode=>({id:n.id,label:n.label,category:n.category,durationMs:n.durationMs,startedAt:n.startedAt,meta:n.meta?structuredClone(n.meta):undefined,error:n.error,children:n.children.map(cloneNode)});
  const aggregateRoot=(n:ProfilerNode,suppressed:boolean)=>{
    const key=`${n.category}\u0000${n.label}`,old=aggregateMap.get(key);
    if(old){old.count++;old.totalMs+=n.durationMs;old.maxMs=Math.max(old.maxMs,n.durationMs);old.lastMs=n.durationMs;old.lastAt=n.startedAt;if(suppressed)old.suppressed++;}
    else aggregateMap.set(key,{key,category:n.category,label:n.label,count:1,totalMs:n.durationMs,maxMs:n.durationMs,lastMs:n.durationMs,lastAt:n.startedAt,suppressed:suppressed?1:0});
  };
  const isFastNoise=(n:ProfilerNode)=>!n.error&&(n.category==='scene'||n.category==='snap')&&n.durationMs<FAST_EVENT_THRESHOLD_MS;
  const measure=<T>(category:ProfileCategory,label:string,fn:()=>T,meta?:Record<string,unknown>):T=>{
    if(!enabled)return fn();
    const node:ProfilerNode={id:sequence++,label,category,durationMs:0,startedAt:profilerClock(),meta,children:[]},parent=stack[stack.length-1];
    if(parent&&parent.children.length<MAX_CHILDREN)parent.children.push(node);
    stack.push(node);
    try{return fn();}catch(e){node.error=e instanceof Error?e.message:String(e);throw e;}finally{
      node.durationMs=Math.max(0,profilerClock()-node.startedAt);stack.pop();
      if(!parent){
        const suppressed=isFastNoise(node);aggregateRoot(node,suppressed);
        if(!suppressed){roots.push(node);if(roots.length>MAX_ROOTS)roots.splice(0,roots.length-MAX_ROOTS);}
      }
    }
  };
  return {
    measure,
    setEnabled(v:boolean){enabled=!!v;},
    isEnabled(){return enabled;},
    clear(){roots.length=0;aggregateMap.clear();benchmarks=[];},
    snapshot(){return {enabled,operations:roots.map(cloneNode),aggregates:[...aggregateMap.values()].map(a=>({...a})),benchmarks:structuredClone(benchmarks),retainedLimit:MAX_ROOTS,fastEventThresholdMs:FAST_EVENT_THRESHOLD_MS};},
    setBenchmarks(v:BenchmarkResult[]){benchmarks=structuredClone(v);},
    benchmarkResults(){return structuredClone(benchmarks);}
  };
})();
