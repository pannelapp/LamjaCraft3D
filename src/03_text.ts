// Text automatically fits one face or follows a connected surface chart.
// Planar footprints use CSG; genuinely curved footprints replace a surface skin.
// Explicit internal surface modes remain available for geometry API compatibility.
// Font curves are flattened with a model-space error bound shared by preview
// and commit. No font, text object or regeneration graph is persisted.
const TEXT_POLICY=Object.freeze({
  maximumCharacters:40,minimumHeight:1,maximumHeight:200,
  minimumDepth:.02,maximumDepth:50,maximumVertices:8000,
  curveErrorMm:.01,maximumCurveErrorHeightRatio:.002,maximumCurveSubdivision:14,
  minimumBoundaryClearance:.02,maximumSourceFaces:20000,maximumBoundaryComparisons:500000,
  overlayLift:.001,overlaySampleStride:12,uprightFrameThreshold:.9,
  maximumLines:4,minimumLineSpacing:1.8,maximumLineSpacing:5,defaultLineSpacing:1.8,
});
interface FaceTextParameters {
  text:string;height:number;depth:number;angleDeg:number;operation:'add'|'cut';center:Vec2;
  surface?:'planar'|'curved'|'auto'|'cylinder'|'cone'|'sphere';font?:TextFontId;lineSpacing?:number;
  wrap?:{axis:TextureBandAxis;offset?:Vec2;fitAround?:boolean};
  cylinder?:{axis:TextureBandAxis;offset?:Vec2;fitAround?:boolean};
}
interface FaceTextRegion {outer:Vec2[];holes:Vec2[][];}
interface FaceTextLayout {basis:PlaneBasis;regions:FaceTextRegion[];width:number;height:number;area:number;vertices:number;curved?:CurvedTextPatch;cylinder?:CylinderTextPatch;wrap?:RoundTextPatch;}
type FaceTextPlacementCheck={ok:true}|{ok:false;message:string};

function textFaceFrame(s:Solid,faceId:FaceId):PlaneBasis {
  const face=s.faces.get(faceId);if(!face)throw Error('Choose a planar face for Text.');
  const n=V.unit(face.plane.normal),u=Math.abs(n[2])<TEXT_POLICY.uprightFrameThreshold
    ?V.unit(V.cross([0,0,1],n)):V.unit(V.sub([1,0,0],V.mul(n,n[0]))),v=V.cross(n,u);
  return {origin:V.mul(n,face.plane.offset),u,v,normal:n};
}
function validatedFaceTextParameters(input:FaceTextParameters):FaceTextParameters {
  if(typeof input.text!=='string')throw Error('Enter text.');
  const p={...input,text:input.text.replace(/\r\n?/g,'\n').normalize('NFC')},lines=p.text.split('\n'),font=TEXT_FONTS[p.font??'sans'];
  if(!font)throw Error('Choose an embedded text font.');
  if(lines.length>TEXT_POLICY.maximumLines||lines.some(line=>[...line].length>TEXT_POLICY.maximumCharacters))throw Error(`Use at most ${TEXT_POLICY.maximumLines} lines of ${TEXT_POLICY.maximumCharacters} characters each.`);
  for(const ch of lines.join(''))if(!font.glyphs[ch])throw Error(`The embedded font does not support “${ch}”. Use Latin letters, numbers or common punctuation.`);
  if(!p.text.trim())throw Error('Enter at least one visible character.');
  if(p.operation!=='add'&&p.operation!=='cut')throw Error('Choose raised or engraved text.');
  if(p.surface!==undefined&&!['planar','curved','auto','cylinder','cone','sphere'].includes(p.surface))throw Error('Invalid text surface mode.');
  const spacing=p.lineSpacing??TEXT_POLICY.defaultLineSpacing;
  if(!Number.isFinite(spacing)||spacing<TEXT_POLICY.minimumLineSpacing||spacing>TEXT_POLICY.maximumLineSpacing)throw Error(`Line spacing must be ${TEXT_POLICY.minimumLineSpacing}–${TEXT_POLICY.maximumLineSpacing} times capital height.`);
  if(p.surface==='cylinder'&&(!p.cylinder||!['x','y','z'].includes(p.cylinder.axis)||p.cylinder.offset!==undefined&&(!Array.isArray(p.cylinder.offset)||p.cylinder.offset.length!==2||p.cylinder.offset.some(v=>!Number.isFinite(v)))||p.cylinder.fitAround!==undefined&&typeof p.cylinder.fitAround!=='boolean'))throw Error('Choose valid cylinder axis, offsets and wrap settings.');
  if((p.surface==='cone'||p.surface==='sphere')&&(!p.wrap||!['x','y','z'].includes(p.wrap.axis)||p.wrap.offset!==undefined&&(!Array.isArray(p.wrap.offset)||p.wrap.offset.length!==2||p.wrap.offset.some(v=>!Number.isFinite(v)))||p.wrap.fitAround!==undefined&&typeof p.wrap.fitAround!=='boolean'))throw Error('Choose valid wrap axis, offsets and full-turn settings.');
  if(!Number.isFinite(p.height)||p.height<TEXT_POLICY.minimumHeight||p.height>TEXT_POLICY.maximumHeight)throw Error(`Capital height must be ${TEXT_POLICY.minimumHeight}–${TEXT_POLICY.maximumHeight} mm.`);
  if(!Number.isFinite(p.depth)||p.depth<TEXT_POLICY.minimumDepth||p.depth>TEXT_POLICY.maximumDepth)throw Error(`Text depth must be ${TEXT_POLICY.minimumDepth}–${TEXT_POLICY.maximumDepth} mm.`);
  if(!Number.isFinite(p.angleDeg)||!Array.isArray(p.center)||p.center.length!==2||p.center.some(v=>!Number.isFinite(v)))throw Error('Enter valid text rotation and placement.');
  return p;
}
function textFlattenGlyph(glyph:TextFontGlyph,scale:number,offset:number,error:number):Vec2[][] {
  return glyph.loops.map(commands=>{
    const loop:Vec2[]=[],point=(x:number,y:number):Vec2=>[x*scale+offset,y*scale];
    const quadratic=(a:Vec2,c:Vec2,b:Vec2,level:number):void=>{
      const errorBound=v2.dist(c,[(a[0]+b[0])*.5,(a[1]+b[1])*.5])*.5;
      if(errorBound<=error){loop.push(b);return;}
      if(level>=TEXT_POLICY.maximumCurveSubdivision)throw Error('Text curve refinement exceeded its safe limit.');
      const ac:Vec2=[(a[0]+c[0])*.5,(a[1]+c[1])*.5],cb:Vec2=[(c[0]+b[0])*.5,(c[1]+b[1])*.5],mid:Vec2=[(ac[0]+cb[0])*.5,(ac[1]+cb[1])*.5];
      quadratic(a,ac,mid,level+1);quadratic(mid,cb,b,level+1);
    };
    for(const command of commands){
      if(command[0]===2)quadratic(loop[loop.length-1],point(command[1],command[2]),point(command[3],command[4]),0);
      else loop.push(point(command[1],command[2]));
    }
    return normalizeLoop2(loop);
  });
}
function textMaterialRegions(loops:Vec2[][]):FaceTextRegion[] {
  // Nested contours use even/odd material ownership, independently of font
  // winding. This also retains the detached dots/accents of i, j and Å.
  const entries=loops.map(loop=>({loop,area:Math.abs(v2.area(loop)),parent:-1,depth:0}));
  for(let i=0;i<entries.length;i++){
    let smallest=Infinity;
    for(let j=0;j<entries.length;j++)if(entries[j].area>entries[i].area&&entries[j].area<smallest&&pointInPolygon2(entries[i].loop[0],entries[j].loop)){entries[i].parent=j;smallest=entries[j].area;}
  }
  for(const e of entries){let parent=e.parent;while(parent>=0){e.depth++;parent=entries[parent].parent;}}
  const regions:FaceTextRegion[]=[],owners=new Map<number,FaceTextRegion>();
  entries.forEach((e,i)=>{if(e.depth%2===0){const outer=v2.area(e.loop)>0?e.loop:[...e.loop].reverse(),region={outer,holes:[] as Vec2[][]};regions.push(region);owners.set(i,region);}});
  for(const e of entries)if(e.depth%2===1){const hole=v2.area(e.loop)<0?e.loop:[...e.loop].reverse();owners.get(e.parent)!.holes.push(hole);}
  return regions;
}
function faceTextLayout(s:Solid,faceId:FaceId,input:FaceTextParameters):FaceTextLayout {
  const p=validatedFaceTextParameters(input),basis=textFaceFrame(s,faceId);
  if(s.faces.size>TEXT_POLICY.maximumSourceFaces)throw Error(`Text supports source objects with at most ${TEXT_POLICY.maximumSourceFaces} faces.`);
  const font=TEXT_FONTS[p.font??'sans'],scale=p.height/font.capHeight,error=Math.min(TEXT_POLICY.curveErrorMm,p.height*TEXT_POLICY.maximumCurveErrorHeightRatio),regions:FaceTextRegion[]=[];
  const cylinder=p.surface==='cylinder'?cylinderTextContext(s,faceId,p.cylinder!.axis,fromPlane2(p.center,basis)):null;
  const wrap=p.surface==='cone'||p.surface==='sphere'?roundTextContext(s,faceId,p.surface,p.wrap!,fromPlane2(p.center,basis)):null;
  const lines=p.text.split('\n'),rowRegions:FaceTextRegion[][]=[];
  for(let index=0;index<lines.length;index++){
    const chars=[...lines[index]],row:FaceTextRegion[]=[],total=chars.reduce((n,ch)=>n+font.glyphs[ch].advance*scale,0);
    const extra=chars.length?(cylinder&&p.cylinder?.fitAround?(cylinder.period-total)/chars.length:wrap&&p.wrap?.fitAround?(wrap.period-total)/chars.length:0):0;
    if(extra<0)throw Error('Text is wider than the wrap circumference. Reduce capital height or use shorter lines.');
    let advance=0;
    for(const ch of chars){const glyph=font.glyphs[ch];row.push(...textMaterialRegions(textFlattenGlyph(glyph,scale,advance,error)));advance+=glyph.advance*scale+extra;}
    if(row.length){const b=textureBounds2(row.flatMap(r=>[r.outer,...r.holes].flat())),cx=(b[0]+b[2])*.5;
      for(const r of row)for(const loop of [r.outer,...r.holes])for(const point of loop){point[0]-=cx;point[1]-=index*p.height*(p.lineSpacing??TEXT_POLICY.defaultLineSpacing);}}
    rowRegions.push(row);
  }
  regions.push(...rowRegions.flat());
  const points=regions.flatMap(r=>[r.outer,...r.holes].flat());if(!points.length)throw Error('The text has no visible outlines.');
  if(points.length>TEXT_POLICY.maximumVertices)throw Error('Text creates too many points. Use shorter text or a smaller capital height.');
  const bounds=textureBounds2(points),cx=(bounds[0]+bounds[2])*.5,cy=(bounds[1]+bounds[3])*.5,angle=p.angleDeg*Math.PI/180,
    center=cylinder?(p.cylinder?.offset??[0,0]):wrap?(p.wrap?.offset??[0,0]):p.center,
    transform=(loop:Vec2[])=>loop.map(q=>{const r=textureRotate2([q[0]-cx,q[1]-cy],angle);return [r[0]+center[0],r[1]+center[1]] as Vec2;});
  for(const r of regions){r.outer=transform(r.outer);r.holes=r.holes.map(transform);}
  const layout:FaceTextLayout={basis,regions,width:bounds[2]-bounds[0],height:bounds[3]-bounds[1],area:regions.reduce((a,r)=>a+Math.abs(v2.area(r.outer))-r.holes.reduce((b,h)=>b+Math.abs(v2.area(h)),0),0),vertices:points.length};
  // Automatic placement uses the original planar operation whenever the
  // complete footprint fits. Otherwise derive one connected surface chart.
  if(wrap){layout.wrap=roundTextPatch(s,layout,wrap);if(layout.wrap.placement.ok&&p.depth>=roundTextDepthLimit(layout.wrap))layout.wrap.placement={ok:false,message:'Wrapped text depth is too large for this area. Reduce height / depth.'};}
  else if(cylinder)layout.cylinder=cylinderTextPatch(s,layout,cylinder);
  else if(p.surface==='curved'||p.surface==='auto'&&!checkFaceTextFits(s,faceId,layout).ok)layout.curved=curvedTextPatch(s,faceId,layout,p.center);
  return layout;
}
function checkFaceTextFits(s:Solid,faceId:FaceId,layout:FaceTextLayout):FaceTextPlacementCheck {
  if(layout.wrap)return layout.wrap.placement;
  if(layout.cylinder)return layout.cylinder.placement;
  if(layout.curved)return layout.curved.placement;
  const domain=faceLoopPoints(s,faceId);
  return checkTextDomain(layout,domain.outer.map(q=>toPlane2(q,layout.basis)),domain.holes.map(h=>h.map(q=>toPlane2(q,layout.basis))));
}
function checkTextDomain(layout:FaceTextLayout,outer:Vec2[],holes:Vec2[][]):FaceTextPlacementCheck {
  const boundaries=[outer,...holes];
  const rejected:FaceTextPlacementCheck={ok:false,message:'Text must fit inside the chosen face, clear of its edges and openings. Move it or reduce the capital height.'};
  if(layout.vertices*boundaries.reduce((n,b)=>n+b.length,0)>TEXT_POLICY.maximumBoundaryComparisons)return {ok:false,message:'Text placement is too complex to check interactively. Use shorter text or a simpler face.'};
  const distanceToSegment=(p:Vec2,a:Vec2,b:Vec2)=>{const dx=b[0]-a[0],dy=b[1]-a[1],t=clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy),0,1);return v2.dist(p,[a[0]+dx*t,a[1]+dy*t]);};
  for(const region of layout.regions){
    for(const loop of [region.outer,...region.holes])for(let i=0;i<loop.length;i++){
      const a=loop[i],b=loop[(i+1)%loop.length];if(!pointInPolygon2(a,outer)||holes.some(h=>pointInPolygon2(a,h)))return rejected;
      for(const boundary of boundaries)for(let j=0;j<boundary.length;j++){
        const c=boundary[j],d=boundary[(j+1)%boundary.length];
        if(segmentIntersection2(a,b,c,d)||Math.min(distanceToSegment(a,c,d),distanceToSegment(b,c,d),distanceToSegment(c,a,b),distanceToSegment(d,a,b))<TEXT_POLICY.minimumBoundaryClearance)return rejected;
      }
    }
    // A face opening can sit entirely within a glyph's material without any
    // contour crossing. Only an opening enclosed by a glyph hole is safe.
    for(const hole of holes)if(pointInPolygon2(hole[0],region.outer)&&!region.holes.some(h=>pointInPolygon2(hole[0],h)))return rejected;
  }
  return {ok:true};
}
function applyFaceTextSolid(s:Solid,faceId:FaceId,input:FaceTextParameters,onProgress?:(update:ModelingProgressUpdate)=>void):Solid {
  const p=validatedFaceTextParameters(input),layout=faceTextLayout(s,faceId,p),placement=checkFaceTextFits(s,faceId,layout);
  if(!placement.ok)throw Error(placement.message);
  if(layout.wrap)return applyRoundTextPatch(s,layout,p,onProgress);
  if(layout.cylinder)return applyCylinderTextPatch(s,layout,p,onProgress);
  if(layout.curved&&!(p.surface==='auto'&&curvedTextPatchIsPlanar(s,layout)))return applyCurvedTextPatch(s,layout,p,onProgress);
  // The source plane is the exact start of the operation. An overlap slab
  // would add material behind thin sheets or cut an unrelated nearby roof.
  const z0=p.operation==='add'?0:-p.depth,z1=p.operation==='add'?p.depth:0,tool:CSGPolygon[]=[];
  onProgress?.({progress:10,message:'Building text outlines…'});
  for(const r of layout.regions)tool.push(...textureComponentCsg(r,layout.basis,z0,z1));
  onProgress?.({progress:45,message:'Combining text with the object…'});
  const source=solidToCsg(s),polygons=p.operation==='add'?csgUnionOwned(source,tool):csgSubtractOwned(source,tool);
  if(!polygons.length)throw Error('Text would remove the entire object.');
  onProgress?.({progress:80,message:'Validating text geometry…'});
  const out=csgToSolid(polygons,s.id,{kind:'boolean',label:'Text'},false);
  const validation=validateSolid(out,false);if(!validation.ok)throw Error(`Text produced invalid geometry: ${validation.errors[0]}`);
  if(connectedSolidFaceComponents(out).length!==1)throw Error('Text would leave disconnected solids. Reduce the depth or choose another placement.');
  onProgress?.({progress:100,message:'Text geometry complete.'});return out;
}
