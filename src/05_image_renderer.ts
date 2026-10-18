// Read-only image rendering uses its own alpha-capable WebGL canvas. It never
// resizes the modeling viewport, changes its camera, or substitutes preview solids.
// 64 Mi pixels admits a 4x QHD viewport; hardware/allocation checks still apply.
const PNG_IMAGE_POLICY=Object.freeze({maximumPixels:64*1024*1024,maximumDimension:16384,maximumTriangles:1000000,maximumReferenceSegments:100000,guideCircleSegments:96,lineWidth:1,guideLineWidth:1.3,dimensionOffset:12,dimensionTick:5,dimensionTextOffset:12,gridExtentSteps:35});
interface ImageDimension {a:Vec3;b:Vec3;text:string;}
interface ImageGuide {paths:Vec3[][];point?:Vec3;label?:string;}
interface PngImageSnapshot {revision:number;camera:CameraState;viewportWidth:number;viewportHeight:number;width:number;height:number;style:ModelViewStyle;background:'current'|'white'|'transparent';shadows:boolean;objects:ModelObject[];guides:ImageGuide[];dimensions:ImageDimension[];plates:BuildPlate[];grid:boolean;guidesThrough:boolean;}
function imageWorldAtScreenDepth(x:number,y:number,z:number,snapshot:PngImageSnapshot,frame:RenderCameraFrame):Vec3 {
  const {viewportWidth:width,viewportHeight:height,camera:state}=snapshot,scale=state.orthographic?height/(2*frame.span):height*frame.focal/(2*z);
  return V.add(frame.eye,V.add(V.mul(frame.forward,z),V.add(V.mul(frame.right,(x-width/2)/scale),V.mul(frame.up,(height/2-y)/scale))));
}
function imageClippedSegment(a:Vec3,b:Vec3,snapshot:PngImageSnapshot,frame:RenderCameraFrame,clipRange:CameraClipRange):[Vec3,Vec3]|null {
  const delta=V.sub(b,a),start=V.sub(a,frame.eye),x=V.dot(start,frame.right),y=V.dot(start,frame.up),z=V.dot(start,frame.forward),dx=V.dot(delta,frame.right),dy=V.dot(delta,frame.up),dz=V.dot(delta,frame.forward),aspect=snapshot.viewportWidth/snapshot.viewportHeight;let lo=0,hi=1;
  const clip=(p:number,q:number)=>{if(Math.abs(q)<MODEL_APPEARANCE_POLICY.facingEpsilon)return p<=0;const t=-p/q;if(q>0)hi=Math.min(hi,t);else lo=Math.max(lo,t);return lo<=hi;};
  if(!clip(clipRange.nearPlane-z,-dz)||!clip(z-clipRange.farPlane,dz))return null;
  if(snapshot.camera.orthographic){if(!clip(x-frame.span*aspect,dx)||!clip(-x-frame.span*aspect,-dx)||!clip(y-frame.span,dy)||!clip(-y-frame.span,-dy))return null;}
  else{const f=frame.focal;if(!clip(x*f-aspect*z,dx*f-aspect*dz)||!clip(-x*f-aspect*z,-dx*f-aspect*dz)||!clip(y*f-z,dy*f-dz)||!clip(-y*f-z,-dy*f-dz))return null;}
  return [V.lerp(a,b,lo),V.lerp(a,b,hi)];
}
function imageRibbon(data:number[],a:Vec3,b:Vec3,color:number[],snapshot:PngImageSnapshot,frame:RenderCameraFrame,clipRange:CameraClipRange,width:number=PNG_IMAGE_POLICY.lineWidth):void {
  const clipped=imageClippedSegment(a,b,snapshot,frame,clipRange);if(!clipped)return;const project=(p:Vec3)=>sceneProjectPoint(p,snapshot.camera,frame,snapshot.viewportWidth,snapshot.viewportHeight),p=project(clipped[0]),q=project(clipped[1]),dx=q[0]-p[0],dy=q[1]-p[1],length=Math.hypot(dx,dy);if(length<MODEL_APPEARANCE_POLICY.facingEpsilon)return;const nx=-dy/length*width/2,ny=dx/length*width/2,point=(s:[number,number,number],side:number)=>imageWorldAtScreenDepth(s[0]+nx*side,s[1]+ny*side,s[2],snapshot,frame),corners=[point(p,-1),point(p,1),point(q,1),point(q,-1)];for(const i of [0,1,2,0,2,3])addVertex(data,corners[i],color);
}
class PngImageRenderer {
  readonly canvas=document.createElement('canvas');
  private readonly context:WebGLRenderingContext;
  private readonly shader:WebGLProgram;
  private readonly buffer:WebGLBuffer;
  private readonly uniforms=new Map<string,WebGLUniformLocation|null>();
  private readonly position:number;
  private readonly color:number;
  private readonly material:number;
  private readonly materialBuffer:WebGLBuffer;
  private readonly shadows:ModelShadowRenderer;
  constructor(){
    const context=this.canvas.getContext('webgl',{antialias:true,alpha:true,premultipliedAlpha:true,preserveDrawingBuffer:true});if(!context)throw Error('PNG rendering requires WebGL.');this.context=context;this.shadows=new ModelShadowRenderer(context);
    const compile=(type:number,source:string)=>{const shader=context.createShader(type);if(!shader)throw Error('PNG shader allocation failed.');context.shaderSource(shader,source);context.compileShader(shader);if(!context.getShaderParameter(shader,context.COMPILE_STATUS)){const message=context.getShaderInfoLog(shader);context.deleteShader(shader);throw Error(message||'PNG shader compilation failed.');}return shader;};
    const shader=context.createProgram();if(!shader)throw Error('PNG renderer allocation failed.');const vertex=compile(context.VERTEX_SHADER,modelVertexShaderSource()),fragment=compile(context.FRAGMENT_SHADER,modelFragmentShaderSource());context.attachShader(shader,vertex);context.attachShader(shader,fragment);context.linkProgram(shader);context.deleteShader(vertex);context.deleteShader(fragment);if(!context.getProgramParameter(shader,context.LINK_STATUS))throw Error(context.getProgramInfoLog(shader)||'PNG shader linking failed.');this.shader=shader;
    const buffer=context.createBuffer();if(!buffer)throw Error('PNG buffer allocation failed.');this.buffer=buffer;this.position=context.getAttribLocation(shader,'position');this.color=context.getAttribLocation(shader,'color');this.material=context.getAttribLocation(shader,'material');const materialBuffer=context.createBuffer();if(!materialBuffer)throw Error('PNG material buffer allocation failed.');this.materialBuffer=materialBuffer;for(const name of ['eye','right','up','forward','aspect','focal','ortho','span','nearPlane','farPlane','materialEye','materialForward','materialOrtho','opacity',...MODEL_SHADOW_UNIFORMS])this.uniforms.set(name,context.getUniformLocation(shader,name));
  }
  private draw(data:number[],mode:number,opacity=1,materials?:number[]):void {if(!data.length)return;const gl=this.context;gl.disableVertexAttribArray(this.material);gl.vertexAttrib4f(this.material,0,0,1,0);if(materials){gl.bindBuffer(gl.ARRAY_BUFFER,this.materialBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(materials),gl.STREAM_DRAW);gl.enableVertexAttribArray(this.material);gl.vertexAttribPointer(this.material,4,gl.FLOAT,false,16,0);}gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STREAM_DRAW);gl.vertexAttribPointer(this.position,3,gl.FLOAT,false,24,0);gl.vertexAttribPointer(this.color,3,gl.FLOAT,false,24,12);gl.uniform1f(this.uniforms.get('opacity')!,opacity);gl.drawArrays(mode,0,data.length/6);}
  render(snapshot:PngImageSnapshot,target:HTMLCanvasElement):void {
    const gl=this.context;if(gl.isContextLost())throw Error('PNG rendering context was lost. Reopen the application and try again.');
    const limit=Math.min(PNG_IMAGE_POLICY.maximumDimension,Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)),Number(gl.getParameter(gl.MAX_TEXTURE_SIZE))),viewport=gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
    if(snapshot.width>limit||snapshot.height>limit||snapshot.width>viewport[0]||snapshot.height>viewport[1])throw Error('This image exceeds the graphics device limit. Choose a lower resolution.');
    const frame=sceneCameraFrame(snapshot.camera),clipRange=sceneCameraClipRange(snapshot.camera,frame,sceneBounds(snapshot.objects)),meshes=snapshot.objects.map(o=>sceneGeometry.mesh(o));if(meshes.reduce((sum,m)=>sum+m.triangles.length,0)>PNG_IMAGE_POLICY.maximumTriangles)throw Error('PNG exceeds the triangle budget. Export fewer visible objects.');
    this.canvas.width=snapshot.width;this.canvas.height=snapshot.height;
    if(gl.isContextLost()||gl.drawingBufferWidth!==snapshot.width||gl.drawingBufferHeight!==snapshot.height)throw Error('The browser could not allocate this PNG image. Choose a lower resolution.');
    const shadows=snapshot.shadows&&this.shadows.prepare(meshes);
    gl.viewport(0,0,snapshot.width,snapshot.height);gl.useProgram(this.shader);gl.enableVertexAttribArray(this.position);gl.enableVertexAttribArray(this.color);this.shadows.apply(name=>this.uniforms.get(name)!,false);
    const background=snapshot.background==='white'?[1,1,1,1]:snapshot.background==='transparent'?[0,0,0,0]:[.943,.96,.966,1];gl.clearColor(background[0],background[1],background[2],background[3]);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(true);gl.disable(gl.BLEND);
    for(const name of ['eye','right','up','forward'] as const)gl.uniform3fv(this.uniforms.get(name)!,frame[name]);gl.uniform1f(this.uniforms.get('aspect')!,snapshot.viewportWidth/snapshot.viewportHeight);gl.uniform1f(this.uniforms.get('focal')!,frame.focal);gl.uniform1f(this.uniforms.get('ortho')!,snapshot.camera.orthographic?1:0);gl.uniform1f(this.uniforms.get('span')!,frame.span);gl.uniform1f(this.uniforms.get('nearPlane')!,clipRange.nearPlane);gl.uniform1f(this.uniforms.get('farPlane')!,clipRange.farPlane);
    gl.uniform3fv(this.uniforms.get('materialEye')!,frame.eye);gl.uniform3fv(this.uniforms.get('materialForward')!,frame.forward);gl.uniform1f(this.uniforms.get('materialOrtho')!,snapshot.camera.orthographic?1:0);
    // Separate alpha factors preserve premultiplied RGB and correct PNG alpha
    // for semitransparent plates, including a transparent background.
    gl.enable(gl.BLEND);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);
    for(const plate of snapshot.plates){const corners=buildPlateCorners(plate),data:number[]=[],outline:number[]=[];for(const i of [0,1,2,0,2,3])addVertex(data,corners[i],rgb(plate.color));this.draw(data,gl.TRIANGLES,plate.opacity);for(let i=0;i<4;i++)imageRibbon(outline,corners[i],corners[(i+1)%4],rgb(plate.color).map(c=>c*BUILD_PLATE_VISUAL_POLICY.outlineDarken),snapshot,frame,clipRange);this.draw(outline,gl.TRIANGLES);}
    if(shadows){this.shadows.apply(name=>this.uniforms.get(name)!,true,true);this.draw(this.shadows.groundVertices(),gl.TRIANGLES,MODEL_SHADOW_POLICY.groundOpacity);this.shadows.apply(name=>this.uniforms.get(name)!,false);}
    gl.depthMask(true);gl.disable(gl.BLEND);
    if(snapshot.grid){const spacing=Math.pow(10,Math.floor(Math.log10(snapshot.camera.distance/12))),extent=spacing*PNG_IMAGE_POLICY.gridExtentSteps,ox=Math.round(snapshot.camera.target[0]/spacing)*spacing,oy=Math.round(snapshot.camera.target[1]/spacing)*spacing,data=sceneGridVertices(spacing,extent,ox,oy),ribbons:number[]=[];for(const values of [data.grid,data.axes])for(let i=0;i<values.length;i+=12)imageRibbon(ribbons,values.slice(i,i+3) as Vec3,values.slice(i+6,i+9) as Vec3,values.slice(i+3,i+6),snapshot,frame,clipRange);this.draw(ribbons,gl.TRIANGLES);}
    gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(1,1);this.shadows.apply(name=>this.uniforms.get(name)!,shadows);
    for(let i=0;i<meshes.length;i++){const mesh=meshes[i],appearance=snapshot.style==='modeling'?null:sceneGeometry.appearance(mesh),base=rgb(snapshot.objects[i].color),data:number[]=[],materials:number[]=[];
      for(let ti=0;ti<mesh.triangles.length;ti++){const ids=mesh.triangles[ti],normal=appearance?.normals[ti]||V.unit(V.cross(V.sub(mesh.vertices[ids[1]],mesh.vertices[ids[0]]),V.sub(mesh.vertices[ids[2]],mesh.vertices[ids[0]])));for(let j=0;j<3;j++){materials.push(...(appearance?.cornerNormals[ti][j]||normal),snapshot.style==='presentation'?objectShininess(snapshot.objects[i])/100:0);addVertex(data,mesh.vertices[ids[j]],sceneLitColor(base,appearance?.cornerNormals[ti][j]||normal,snapshot.style,undefined,snapshot.camera.orthographic?V.mul(frame.forward,-1):V.unit(V.sub(frame.eye,mesh.vertices[ids[j]]))));}}this.draw(data,gl.TRIANGLES,1,materials);
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);this.shadows.apply(name=>this.uniforms.get(name)!,false);
    for(const mesh of meshes){const data:number[]=[],edges=snapshot.style==='modeling'?mesh.edges:snapshot.style==='presentation'?[]:sceneStyleEdges(mesh,sceneGeometry.appearance(mesh),snapshot.style,snapshot.camera,frame);for(const [a,b] of edges)imageRibbon(data,mesh.vertices[a],mesh.vertices[b],[.25,.34,.35],snapshot,frame,clipRange);this.draw(data,gl.TRIANGLES);}
    const guideData:number[]=[];for(const guide of snapshot.guides)for(const path of guide.paths)for(let i=0;i+1<path.length;i++)imageRibbon(guideData,path[i],path[i+1],[.212,.443,.620],snapshot,frame,clipRange,PNG_IMAGE_POLICY.guideLineWidth);
    if(snapshot.guidesThrough)gl.disable(gl.DEPTH_TEST);gl.depthMask(false);this.draw(guideData,gl.TRIANGLES);gl.depthMask(true);gl.enable(gl.DEPTH_TEST);
    const ctx=target.getContext('2d');if(!ctx)throw Error('PNG composition requires Canvas 2D.');target.width=snapshot.width;target.height=snapshot.height;ctx.clearRect(0,0,target.width,target.height);ctx.drawImage(this.canvas,0,0);this.drawAnnotations(ctx,snapshot,frame);
  }
  private drawAnnotations(ctx:CanvasRenderingContext2D,snapshot:PngImageSnapshot,frame:RenderCameraFrame):void {
    const project=(p:Vec3)=>sceneProjectPoint(p,snapshot.camera,frame,snapshot.viewportWidth,snapshot.viewportHeight),visible=(p:Vec3)=>{const z=project(p)[2];return z>=CAMERA_PROJECTION_POLICY.nearPlane&&z<=CAMERA_PROJECTION_POLICY.farPlane;},ratio=snapshot.width/snapshot.viewportWidth;
    ctx.save();ctx.scale(ratio,snapshot.height/snapshot.viewportHeight);ctx.font='12px system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
    const labelText=(text:string,x:number,y:number)=>{const width=ctx.measureText(text).width;ctx.fillStyle='rgba(255,255,255,.92)';ctx.fillRect(x-width/2-4,y-9,width+8,18);ctx.fillStyle='#276a61';ctx.fillText(text,x,y);};
    for(const guide of snapshot.guides)if(guide.point&&visible(guide.point)){const p=project(guide.point);ctx.beginPath();ctx.arc(p[0],p[1],3.5,0,Math.PI*2);ctx.fillStyle='#36719e';ctx.fill();if(guide.label)labelText(guide.label,p[0],p[1]-15);}
    for(const d of snapshot.dimensions){if(!visible(d.a)||!visible(d.b))continue;const a=project(d.a),b=project(d.b),dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(length<MODEL_APPEARANCE_POLICY.facingEpsilon)continue;const nx=-dy/length,ny=dx/length,o=PNG_IMAGE_POLICY.dimensionOffset,t=PNG_IMAGE_POLICY.dimensionTick,ax=a[0]+nx*o,ay=a[1]+ny*o,bx=b[0]+nx*o,by=b[1]+ny*o;ctx.strokeStyle='#276a61';ctx.lineWidth=1.5;ctx.beginPath();for(const segment of [[a[0],a[1],ax,ay],[b[0],b[1],bx,by],[ax,ay,bx,by],[ax-nx*t,ay-ny*t,ax+nx*t,ay+ny*t],[bx-nx*t,by-ny*t,bx+nx*t,by+ny*t]]){ctx.moveTo(segment[0],segment[1]);ctx.lineTo(segment[2],segment[3]);}ctx.stroke();labelText(d.text,(ax+bx)/2+nx*PNG_IMAGE_POLICY.dimensionTextOffset,(ay+by)/2+ny*PNG_IMAGE_POLICY.dimensionTextOffset);}
    ctx.restore();
  }
  releaseImage():void{this.shadows.release();this.canvas.width=1;this.canvas.height=1;const gl=this.context;if(!gl.isContextLost()){gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,0,gl.STREAM_DRAW);gl.bindBuffer(gl.ARRAY_BUFFER,this.materialBuffer);gl.bufferData(gl.ARRAY_BUFFER,0,gl.STREAM_DRAW);}}
}
let pngImageRenderer:PngImageRenderer|null=null;
