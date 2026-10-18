// A finite height field: in-plane coordinates never move or fold over.
const SPLIT_SURFACE_POLICY=Object.freeze({minimumSize:1,maximumSize:10000,minimumPoints:2,maximumPoints:30,maximumHeight:10000,maximumTemplateBytes:128*1024,pointPickPixels:10,maximumSourceFaces:20000,volumeRelativeBudget:1e-5,volumeAbsoluteBudget:1e-5,unitFrameTolerance:1e-7,clipMarginMinimum:1,clipMarginFraction:.1,pointDragProbeMm:10,minimumDragPixels:4,minimumPixelsPerMm:.05,minimumSnapStepMm:.001,fallbackMinimumSpan:40,fallbackCameraFactor:1.5,influenceRingSegments:64});
interface SplitSurfaceFrame {origin:Vec3;normal:Vec3;axis:Vec3;}
interface SplitSurfaceRequest {type:'split-surface';solid:Solid;frame:SplitSurfaceFrame;grid:SplitSurfaceGrid;}
interface SplitSurfaceResult {positive:Solid;negative:Solid;}
function validateSplitSurface(value:unknown):SplitSurfaceGrid {
  if(!value||typeof value!=='object')throw Error('The split surface is missing its grid.');
  const g=value as Record<string,unknown>,size=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>=SPLIT_SURFACE_POLICY.minimumSize&&n<=SPLIT_SURFACE_POLICY.maximumSize,points=(n:unknown)=>typeof n==='number'&&Number.isInteger(n)&&n>=SPLIT_SURFACE_POLICY.minimumPoints&&n<=SPLIT_SURFACE_POLICY.maximumPoints;
  if(!size(g.width)||!size(g.height))throw Error('Surface width and height must be between 1 and 10,000 mm.');
  if(!points(g.columns)||!points(g.rows))throw Error('Choose between 2 and 30 grid points on each axis.');
  const width=g.width as number,height=g.height as number,columns=g.columns as number,rows=g.rows as number;
  if(!Array.isArray(g.heights)||g.heights.length!==columns*rows||g.heights.some((h:unknown)=>typeof h!=='number'||!Number.isFinite(h)||Math.abs(h)>SPLIT_SURFACE_POLICY.maximumHeight))throw Error('The split surface has invalid point heights.');
  return {width,height,columns,rows,heights:[...g.heights] as number[]};
}
function splitSurfaceUV(g:SplitSurfaceGrid,index:number):Vec2{return [(index%g.columns)/(g.columns-1)*g.width-g.width/2,Math.floor(index/g.columns)/(g.rows-1)*g.height-g.height/2];}
function splitSurfaceBasis(frame:SplitSurfaceFrame):{normal:Vec3;u:Vec3;v:Vec3} {
  if([...frame.origin,...frame.normal,...frame.axis].some(n=>!Number.isFinite(n))||frame.origin.length!==3||frame.normal.length!==3||frame.axis.length!==3)throw Error('The surface frame has invalid coordinates.');
  if(Math.abs(V.len(frame.normal)-1)>SPLIT_SURFACE_POLICY.unitFrameTolerance||Math.abs(V.len(frame.axis)-1)>SPLIT_SURFACE_POLICY.unitFrameTolerance||Math.abs(V.dot(frame.normal,frame.axis))>SPLIT_SURFACE_POLICY.unitFrameTolerance)throw Error('The surface frame must have perpendicular unit axes.');
  const normal=V.unit(frame.normal),u=V.unit(V.sub(frame.axis,V.mul(normal,V.dot(frame.axis,normal))));if(V.len(normal)<TOL.minimumEdge||V.len(u)<TOL.minimumEdge)throw Error('The surface needs a valid normal and in-plane axis.');return {normal,u,v:V.cross(normal,u)};
}
function splitSurfaceWorldPoints(grid:SplitSurfaceGrid,frame:SplitSurfaceFrame):Vec3[]{const b=splitSurfaceBasis(frame);return grid.heights.map((height,i)=>{const p=splitSurfaceUV(grid,i);return V.add(frame.origin,V.add(V.mul(b.u,p[0]),V.add(V.mul(b.v,p[1]),V.mul(b.normal,height))));});}
function splitSurfaceTriangles(g:SplitSurfaceGrid):[number,number,number][]{const result:[number,number,number][]=[];for(let y=0;y<g.rows-1;y++)for(let x=0;x<g.columns-1;x++){const a=y*g.columns+x,b=a+1,c=a+g.columns,d=c+1;result.push([a,b,d],[a,d,c]);}return result;}
function bendSplitSurface(grid:SplitSurfaceGrid,index:number,distance:number,radius:number):SplitSurfaceGrid {
  const g=validateSplitSurface(grid);if(!Number.isInteger(index)||index<0||index>=g.heights.length)throw Error('Choose a surface grid point first.');
  if(!Number.isFinite(distance)||!Number.isFinite(radius)||radius<=0||radius>SPLIT_SURFACE_POLICY.maximumSize)throw Error('Choose a valid bend distance and influence radius.');
  const center=splitSurfaceUV(g,index);g.heights=g.heights.map((h,i)=>{const p=splitSurfaceUV(g,i),r2=((p[0]-center[0])**2+(p[1]-center[1])**2)/(radius*radius),weight=r2<1?(1-r2)**2:0;return h+distance*weight;});return validateSplitSurface(g);
}
// Outside the editable footprint, clamp each coordinate to the closest rim.
// Edge heights continue straight along the in-plane axes; corners are constant.
interface SplitSurfaceClipGrid extends SplitSurfaceGrid {uCoordinates:number[];vCoordinates:number[];}
function extendSplitSurfaceForTarget(g:SplitSurfaceGrid,coords:Vec3[]):SplitSurfaceClipGrid {
  const u=Array.from({length:g.columns},(_,x)=>x/(g.columns-1)*g.width-g.width/2),v=Array.from({length:g.rows},(_,y)=>y/(g.rows-1)*g.height-g.height/2);
  const minU=Math.min(...coords.map(p=>p[0])),maxU=Math.max(...coords.map(p=>p[0])),minV=Math.min(...coords.map(p=>p[1])),maxV=Math.max(...coords.map(p=>p[1])),margin=Math.max(SPLIT_SURFACE_POLICY.clipMarginMinimum,Math.max(maxU-minU,maxV-minV)*SPLIT_SURFACE_POLICY.clipMarginFraction);
  const left=minU-margin<u[0],right=maxU+margin>u[u.length-1],bottom=minV-margin<v[0],top=maxV+margin>v[v.length-1];
  if(left)u.unshift(minU-margin);if(right)u.push(maxU+margin);if(bottom)v.unshift(minV-margin);if(top)v.push(maxV+margin);
  const columns=u.length,rows=v.length,heights=Array.from({length:columns*rows},(_,i)=>{const x=clamp(i%columns-(left?1:0),0,g.columns-1),y=clamp(Math.floor(i/columns)-(bottom?1:0),0,g.rows-1);return g.heights[y*g.columns+x];});
  return {...g,columns,rows,heights,uCoordinates:u,vCoordinates:v};
}
function splitSurfaceClip(g:SplitSurfaceClipGrid,frame:SplitSurfaceFrame,bound:number,negative:boolean):CSGPolygon[] {
  const b=splitSurfaceBasis(frame),uv=(i:number):Vec2=>[g.uCoordinates[i%g.columns],g.vCoordinates[Math.floor(i/g.columns)]],points=g.heights.map((height,i)=>{const p=uv(i);return V.add(frame.origin,V.add(V.mul(b.u,p[0]),V.add(V.mul(b.v,p[1]),V.mul(b.normal,height))));}),cap=(i:number):Vec3=>{const p=uv(i);return V.add(frame.origin,V.add(V.mul(b.u,p[0]),V.add(V.mul(b.v,p[1]),V.mul(b.normal,bound))));},out:CSGPolygon[]=[],polygon=(ps:Vec3[])=>out.push(csgPolygon(negative?ps:[...ps].reverse()));
  for(const tri of splitSurfaceTriangles(g))polygon(tri.map(i=>points[i]));
  const rim:number[]=[];for(let x=0;x<g.columns;x++)rim.push(x);for(let y=1;y<g.rows;y++)rim.push(y*g.columns+g.columns-1);for(let x=g.columns-2;x>=0;x--)rim.push((g.rows-1)*g.columns+x);for(let y=g.rows-2;y>0;y--)rim.push(y*g.columns);
  // Top boundary is CCW. Shared row/column vertices are retained on side walls.
  for(let j=0;j<rim.length;j++){const a=rim[j],c=rim[(j+1)%rim.length];polygon([points[c],points[a],cap(a),cap(c)]);}
  const corners=[0,g.columns-1,g.columns*g.rows-1,(g.rows-1)*g.columns];polygon(corners.reverse().map(cap));return out;
}
function splitSolidBySurface(request:SplitSurfaceRequest,report?:(update:ModelingProgressUpdate)=>void):SplitSurfaceResult {
  const {solid,frame}=request,g=validateSplitSurface(request.grid),b=splitSurfaceBasis(frame);if(solid.faces.size>SPLIT_SURFACE_POLICY.maximumSourceFaces)throw Error('The object has too many faces for this split surface.');
  const coords=[...solid.vertices.values()].map(v=>{const d=V.sub(v.position,frame.origin);return [V.dot(d,b.u),V.dot(d,b.v),V.dot(d,b.normal)] as Vec3;});if(!coords.length)throw Error('The object has no geometry to split.');
  const clipGrid=extendSplitSurfaceForTarget(g,coords);
  let min=Math.min(...g.heights),max=Math.max(...g.heights);for(const p of coords){min=Math.min(min,p[2]);max=Math.max(max,p[2]);}const margin=Math.max(SPLIT_SURFACE_POLICY.clipMarginMinimum,(max-min)*SPLIT_SURFACE_POLICY.clipMarginFraction),source=solidToCsg(solid);
  report?.({progress:10,message:'Building curved split volumes…'});
  const negativeClip=splitSurfaceClip(clipGrid,frame,min-margin,true),positiveClip=splitSurfaceClip(clipGrid,frame,max+margin,false);
  report?.({progress:25,message:'Splitting the first side…'});const negativePolys=csgIntersect(source,negativeClip);
  report?.({progress:55,message:'Splitting the second side…'});const positivePolys=csgIntersect(source,positiveClip);
  if(!positivePolys.length||!negativePolys.length)throw Error('The surface must pass through the interior of the object.');
  report?.({progress:80,message:'Reconstructing closed split objects…'});const provenance:FaceProvenance={kind:'split',label:'Curved Surface Split'},positive=csgToSolid(positivePolys,solid.id,provenance),negative=csgToSolid(negativePolys,undefined,provenance),a=validateSolid(positive,false),c=validateSolid(negative,false),original=validateSolid(solid,false);
  if(!a.ok||!c.ok||!original.ok)throw Error('The surface did not produce two valid closed solids.');
  const volume=original.volume,budget=Math.max(SPLIT_SURFACE_POLICY.volumeAbsoluteBudget,Math.abs(volume)*SPLIT_SURFACE_POLICY.volumeRelativeBudget);if(a.volume<=0||c.volume<=0||Math.abs(a.volume+c.volume-volume)>budget)throw Error('The split surface could not preserve the object volume.');
  report?.({progress:98,message:'Curved split ready.'});return {positive,negative};
}
