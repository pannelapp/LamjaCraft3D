// Reference-only buffers, independent of SceneGeometry, picking and snapping.
const BUILD_PLATE_VISUAL_POLICY=Object.freeze({outlineDarken:.65});
const buildPlateFillBuffer=gl.createBuffer(),buildPlateOutlineBuffer=gl.createBuffer();
let buildPlateBufferKey='';
let buildPlateDraws:{fillOffset:number;lineOffset:number;opacity:number}[]=[];
function buildPlateCorners(plate:BuildPlate):Vec3[]{const left=plate.x-plate.width/2,right=plate.x+plate.width/2,bottom=plate.y-plate.depth/2,top=plate.y+plate.depth/2;return [[left,bottom,0],[right,bottom,0],[right,top,0],[left,top,0]];}
function ensureBuildPlateBuffers():void{
  const visible=buildPlates.filter(p=>p.visible&&p.opacity>0),key=JSON.stringify(visible);if(key===buildPlateBufferKey)return;
  const fills:number[]=[],lines:number[]=[];buildPlateDraws=[];
  for(const plate of visible){const corners=buildPlateCorners(plate),color=rgb(plate.color),outline=color.map(c=>c*BUILD_PLATE_VISUAL_POLICY.outlineDarken);
    buildPlateDraws.push({fillOffset:fills.length/6,lineOffset:lines.length/6,opacity:plate.opacity});
    for(const i of [0,1,2,0,2,3])addVertex(fills,corners[i],color);
    for(let i=0;i<4;i++){addVertex(lines,corners[i],outline);addVertex(lines,corners[(i+1)%4],outline);}
  }
  upload(buildPlateFillBuffer,fills);upload(buildPlateOutlineBuffer,lines);buildPlateBufferKey=key;
}
function drawBuildPlates():void{
  ensureBuildPlateBuffers();if(!buildPlateDraws.length)return;
  // Draw before model solids and never write depth: a plate cannot hide geometry,
  // grid, guides or later overlays, including objects crossing Z = 0.
  gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);
  for(const item of buildPlateDraws){
    gl.uniform1f(uniform.opacity,item.opacity);bindBuffer(buildPlateFillBuffer);gl.drawArrays(gl.TRIANGLES,item.fillOffset,6);
    gl.uniform1f(uniform.opacity,1);bindBuffer(buildPlateOutlineBuffer);gl.drawArrays(gl.LINES,item.lineOffset,8);
  }
  gl.depthMask(true);gl.disable(gl.BLEND);gl.uniform1f(uniform.opacity,1);
}
