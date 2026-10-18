// Generated source construction uses ordinary modeling operations. The reference
// volume below is analytic cross-section integration, without offset/CSG helpers.
export function installSpatialFixture(sandbox,run,spec={}){
 sandbox.spatialSpec={facets:24,rounded:false,slope:0,feature:'boss',bosses:1,placed:false,...spec};
 run(`var spec=spatialSpec,body;
 if(spec.slope){const bottom=[[-30,-25,0],[30,-25,0],[30,25,0],[-30,25,0]],top=bottom.map(p=>[p[0]+Math.sign(p[0])*30*spec.slope,p[1]+Math.sign(p[1])*30*spec.slope,30]);body=buildSolidFromPolygons([{points:[...bottom].reverse()},{points:top},...bottom.map((p,i)=>({points:[p,bottom[(i+1)%4],top[(i+1)%4],top[i]]}))],'sloped-body');}
 else body=primitivePrism([[-30,-25],[30,-25],[30,25],[-30,25]],30,'body');
 if(spec.isolatedBevel){const edge=[...body.halfEdges.values()].find(e=>{const a=body.vertices.get(e.origin).position,b=body.vertices.get(body.halfEdges.get(e.next).origin).position;return Math.abs(a[0]-30)<1e-6&&Math.abs(a[1]-25)<1e-6&&Math.abs(b[0]-30)<1e-6&&Math.abs(b[1]-25)<1e-6;});body=chamferEdgeSolid(body,edge.id,4);}
 if(spec.rounded){const top=[...body.faces.values()].find(f=>f.plane.normal[2]>.99);body=roundedChamferEdgesSolid(body,loopHalfEdges(body,top.outerLoop).map(e=>e.id),3,45,6);}
 var radius=spec.feature==='recess'?8:spec.bosses===2?6:10,ring=Array.from({length:spec.facets},(_,i)=>[radius*Math.cos(i*2*Math.PI/spec.facets),radius*Math.sin(i*2*Math.PI/spec.facets)]),sourcePolygons=solidToCsg(body);
 if(spec.feature==='recess'){const cutter=primitivePrism(ring,9,'recess');for(const v of cutter.vertices.values())v.position[2]+=22;for(const f of cutter.faces.values())f.plane.offset+=f.plane.normal[2]*22;sourcePolygons=csgSubtract(sourcePolygons,solidToCsg(cutter));}
 else for(let i=0;i<spec.bosses;i++){let boss=primitivePrism(ring,18,'boss-'+i),top=[...boss.faces.values()].find(f=>f.plane.normal[2]>.99);boss=chamferEdgeSolid(boss,loopHalfEdges(boss,top.outerLoop)[0].id,2);const shift=[spec.bosses===2?(i?13:-13):0,0,30];for(const v of boss.vertices.values())v.position=V.add(v.position,shift);for(const f of boss.faces.values())f.plane.offset+=V.dot(f.plane.normal,shift);sourcePolygons=csgUnion(sourcePolygons,solidToCsg(boss));}
 var spatialSource=csgToSolid(sourcePolygons,'spatial-source'),spatialPlacement={position:[13,-7,5],rotation:[19,-27,31]};
 if(spec.placed)spatialSource=buildSolidFromPolygons([...spatialSource.faces.values()].reverse().flatMap(f=>triangulateFaceLocal(spatialSource,f.id).map(t=>({points:t.map(p=>transformPoint(p,spatialPlacement))}))),'placed-source');
 var spatialOpening=[...spatialSource.faces.values()].find(f=>V.dot(f.plane.normal,spec.placed?transformDir([0,0,-1],spatialPlacement):[0,0,-1])>.99);
 `);return sandbox.spatialSpec;
}
const square=(x)=>x*x;
function integrateSections(points){let volume=0;for(let i=1;i<points.length;i++){const [z0,d0]=points[i-1],[z1,d1]=points[i],area=d=>(60-2*d)*(50-2*d);volume+=(z1-z0)*(area(d0)+4*area((d0+d1)/2)+area(d1))/6;}return volume;}
function bodyVolume(spec,wall){
 if(spec.rounded){const r=3,segments=6,step=Math.PI/(2*segments),c=Math.cos(step/2),rho=r-wall/c,points=[[0,wall],[30-r-wall*Math.tan(step/4),wall]];for(let i=1;i<segments;i++){const angle=i*step;points.push([30-r+rho*Math.sin(angle),r-rho*Math.cos(angle)]);}points.push([30-wall,r+wall*Math.tan(step/4)]);return integrateSections(points);}
 const h=30-wall,k=spec.slope||0,d=wall*Math.sqrt(1+k*k),area=z=>(60+2*k*z-2*d)*(50+2*k*z-2*d);return h*(area(0)+4*area(h/2)+area(h))/6-(spec.isolatedBevel?square(4-wall*(2-Math.SQRT2))*h/2:0);
}
export function spatialReference(spec,wall){
 const radius=spec.feature==='recess'?8:spec.bosses===2?6:10,n=spec.facets,a=radius*Math.cos(Math.PI/n),factor=n*Math.tan(Math.PI/n),area=x=>factor*square(x),frustum=(h,a,b)=>h*(area(a)+factor*a*b+area(b))/3;
 const body=bodyVolume(spec,0),innerBody=bodyVolume(spec,wall);let source,cavity;
 if(spec.feature==='recess'){source=body-area(a)*8;cavity=innerBody-area(a+wall)*8;}
 else{const bosses=spec.bosses||1,b=a-wall,c=a-2+wall*(1-Math.SQRT2),straight=16+wall*(2-Math.SQRT2),taper=2-wall*(2-Math.SQRT2);source=body+bosses*(16*area(a)+frustum(2,a,a-2));cavity=innerBody+bosses*(straight*area(b)+frustum(taper,b,c));}
 return {source,cavity,result:source-cavity};
}
