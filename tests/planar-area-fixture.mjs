// Independent test-only planar arrangement sweep. No application geometry helpers.
const PLANAR_AREA_TEST_POLICY={coordinateEpsilon:1e-9};
const sub=(a,b)=>a.map((x,i)=>x-b[i]),cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
export function clippedUnionArea(source,cuts){
 const polygons=[source,...cuts],segments=polygons.flatMap(p=>p.map((a,i)=>[a,p[(i+1)%p.length]])),xs=polygons.flatMap(p=>p.map(q=>q[0]));
 for(let i=0;i<segments.length;i++)for(let j=i+1;j<segments.length;j++){
  const [a,b]=segments[i],[c,d]=segments[j],u=sub(b,a),v=sub(d,c),den=cross(u,v);if(Math.abs(den)<PLANAR_AREA_TEST_POLICY.coordinateEpsilon)continue;
  const delta=sub(c,a),s=cross(delta,v)/den,t=cross(delta,u)/den;if(s>0&&s<1&&t>0&&t<1)xs.push(a[0]+s*u[0]);
 }
 xs.sort((a,b)=>a-b);const unique=xs.filter((x,i)=>!i||x-xs[i-1]>PLANAR_AREA_TEST_POLICY.coordinateEpsilon);
 const intervals=(p,x)=>{const ys=[];for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];if(a[0]<=x&&b[0]>x||b[0]<=x&&a[0]>x)ys.push(a[1]+(x-a[0])*(b[1]-a[1])/(b[0]-a[0]));}ys.sort((a,b)=>a-b);const result=[];for(let i=0;i+1<ys.length;i+=2)result.push([ys[i],ys[i+1]]);return result;};
 let area=0;
 for(let i=0;i+1<unique.length;i++){
  const x=(unique[i]+unique[i+1])/2,inside=intervals(source,x);if(!inside.length)continue;
  const raw=cuts.flatMap(p=>intervals(p,x)).sort((a,b)=>a[0]-b[0]),union=[];
  for(const span of raw){const last=union.at(-1);if(last&&span[0]<=last[1])last[1]=Math.max(last[1],span[1]);else union.push([...span]);}
  let length=0;for(const a of inside)for(const b of union)length+=Math.max(0,Math.min(a[1],b[1])-Math.max(a[0],b[0]));area+=length*(unique[i+1]-unique[i]);
 }
 return area;
}
