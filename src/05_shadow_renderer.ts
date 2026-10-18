// Disposable GPU shadow data shared by the viewport and read-only PNG renderer.
// RGBA depth avoids requiring the optional WebGL 1 depth-texture extension.
const MODEL_SHADOW_POLICY=Object.freeze({mapSize:1024,minimumMapSize:256,maximumTriangles:1000000,margin:.06,minimumSpan:.01,biasTexels:.65,polygonOffsetFactor:2,polygonOffsetUnits:4,objectDarkness:.42,groundOpacity:.28});
const MODEL_SHADOW_UNIFORMS=['shadowEnabled','shadowOnly','shadowMap','shadowOrigin','shadowRight','shadowUp','shadowForward','shadowSpan','shadowNear','shadowRange','shadowTexel','shadowBias'] as const;
interface ModelShadowFrame {origin:Vec3;right:Vec3;up:Vec3;forward:Vec3;span:number;near:number;range:number;ground:Vec3[];}
function modelShadowFrame(meshes:Mesh[]):ModelShadowFrame|null {
  const points=meshes.flatMap(m=>m.vertices);if(!points.length)return null;
  const min:Vec3=[Infinity,Infinity,Infinity],max:Vec3=[-Infinity,-Infinity,-Infinity];
  for(const p of points)for(let i=0;i<3;i++){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i]);}
  const size=Math.max(MODEL_SHADOW_POLICY.minimumSpan,...max.map((v,i)=>v-min[i])),z=Math.min(0,min[2])-size*1e-5;
  // Include the projected footprint, even when the model floats above Z=0.
  let x0=min[0],x1=max[0],y0=min[1],y1=max[1];
  for(const p of points){const t=(p[2]-z)/MODEL_KEY_LIGHT[2],x=p[0]-MODEL_KEY_LIGHT[0]*t,y=p[1]-MODEL_KEY_LIGHT[1]*t;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
  const margin=size*MODEL_SHADOW_POLICY.margin,ground:Vec3[]=[[x0-margin,y0-margin,z],[x1+margin,y0-margin,z],[x1+margin,y1+margin,z],[x0-margin,y1+margin,z]],forward=V.mul(MODEL_KEY_LIGHT,-1),right=V.unit(V.cross(forward,[0,0,1])),up=V.cross(right,forward),center=V.mul(V.add(min,max),.5);
  let loX=Infinity,hiX=-Infinity,loY=Infinity,hiY=-Infinity,near=Infinity,far=-Infinity;
  for(const p of [...points,...ground]){const d=V.sub(p,center),x=V.dot(d,right),y=V.dot(d,up),depth=V.dot(d,forward);loX=Math.min(loX,x);hiX=Math.max(hiX,x);loY=Math.min(loY,y);hiY=Math.max(hiY,y);near=Math.min(near,depth);far=Math.max(far,depth);}
  const origin=V.add(center,V.add(V.mul(right,(loX+hiX)/2),V.mul(up,(loY+hiY)/2))),span=Math.max(hiX-loX,hiY-loY,MODEL_SHADOW_POLICY.minimumSpan)/2+margin;
  return {origin,right,up,forward,span,near:near-margin,range:Math.max(far-near+2*margin,MODEL_SHADOW_POLICY.minimumSpan),ground};
}
class ModelShadowRenderer {
  private texture:WebGLTexture|null=null;
  private framebuffer:WebGLFramebuffer|null=null;
  private depth:WebGLRenderbuffer|null=null;
  private program:WebGLProgram|null=null;
  private buffer:WebGLBuffer|null=null;
  private cached:Mesh[]=[];
  private frame:ModelShadowFrame|null=null;
  private resolution=0;
  constructor(private readonly gl:WebGLRenderingContext){}
  private allocate():void {
    if(this.program)return;const gl=this.gl;
    const precision=gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER,gl.HIGH_FLOAT);
    if(!precision?.precision)throw Error('This graphics device cannot render shadows. Turn off Shadows and try again.');
    this.resolution=Math.min(MODEL_SHADOW_POLICY.mapSize,Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)));
    if(this.resolution<MODEL_SHADOW_POLICY.minimumMapSize)throw Error('This graphics device cannot allocate shadows. Turn off Shadows and try again.');
    try {
      if(this.texture)gl.deleteTexture(this.texture);
      this.texture=gl.createTexture();this.framebuffer=gl.createFramebuffer();this.depth=gl.createRenderbuffer();this.buffer=gl.createBuffer();this.program=gl.createProgram();
      if(!this.texture||!this.framebuffer||!this.depth||!this.buffer||!this.program)throw Error('Shadow allocation failed.');
      gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,this.resolution,this.resolution,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      gl.bindRenderbuffer(gl.RENDERBUFFER,this.depth);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,this.resolution,this.resolution);gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.texture,0);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,this.depth);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Shadow framebuffer is unavailable.');
      const sources=[`attribute vec3 position;uniform vec3 origin,right,up,forward;uniform float span,nearDepth,depthRange;void main(){vec3 d=position-origin;gl_Position=vec4(dot(d,right)/span,dot(d,up)/span,2.0*(dot(d,forward)-nearDepth)/depthRange-1.0,1.0);}`,`precision highp float;void main(){float d=min(gl_FragCoord.z,.999999);vec3 p=fract(d*vec3(1.0,255.0,65025.0));p-=p.yzz*vec3(1.0/255.0,1.0/255.0,0.0);gl_FragColor=vec4(p,1.0);}`];
      for(let i=0;i<2;i++){const shader=gl.createShader(i?gl.FRAGMENT_SHADER:gl.VERTEX_SHADER);if(!shader)throw Error('Shadow shader allocation failed.');gl.shaderSource(shader,sources[i]);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const error=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw Error(error||'Shadow shader compilation failed.');}gl.attachShader(this.program,shader);gl.deleteShader(shader);}
      gl.linkProgram(this.program);if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(this.program)||'Shadow shader linking failed.');
    } catch(error){this.release();throw error;} finally {gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindRenderbuffer(gl.RENDERBUFFER,null);}
  }
  prepare(meshes:Mesh[]):boolean {
    if(meshes.reduce((n,m)=>n+m.triangles.length,0)>MODEL_SHADOW_POLICY.maximumTriangles)throw Error('Shadows exceed one million triangles. Turn off Shadows or show fewer objects.');
    if(!meshes.some(m=>m.vertices.length)){this.release();return false;}
    this.allocate();if(this.frame&&meshes.length===this.cached.length&&meshes.every((m,i)=>m===this.cached[i]))return true;
    const gl=this.gl,frame=modelShadowFrame(meshes)!;this.frame=null;
    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer);gl.viewport(0,0,this.resolution,this.resolution);gl.useProgram(this.program);gl.clearColor(1,1,1,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(true);gl.disable(gl.BLEND);gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(MODEL_SHADOW_POLICY.polygonOffsetFactor,MODEL_SHADOW_POLICY.polygonOffsetUnits);
      const location=(name:string)=>gl.getUniformLocation(this.program!,name);
      for(const key of ['origin','right','up','forward'] as const)gl.uniform3fv(location(key),frame[key]);gl.uniform1f(location('span'),frame.span);gl.uniform1f(location('nearDepth'),frame.near);gl.uniform1f(location('depthRange'),frame.range);
      const position=gl.getAttribLocation(this.program!,'position');gl.enableVertexAttribArray(position);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.vertexAttribPointer(position,3,gl.FLOAT,false,12,0);
      for(const mesh of meshes){const data=new Float32Array(mesh.triangles.length*9);let i=0;for(const t of mesh.triangles)for(const v of t){data.set(mesh.vertices[v],i);i+=3;}gl.bufferData(gl.ARRAY_BUFFER,data,gl.STREAM_DRAW);gl.drawArrays(gl.TRIANGLES,0,data.length/3);}
      this.frame=frame;this.cached=[...meshes];return true;
    } finally {gl.disable(gl.POLYGON_OFFSET_FILL);gl.bindFramebuffer(gl.FRAMEBUFFER,null);}
  }
  apply(location:(name:string)=>WebGLUniformLocation|null,enabled:boolean,ground=false):void {
    const gl=this.gl,frame=this.frame;
    // A complete neutral texture keeps WebGL's active sampler valid even when
    // shadows are disabled or a previous allocation failed.
    if(!this.texture){this.texture=gl.createTexture();if(this.texture){gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,255,255,255]));}}
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.uniform1i(location('shadowMap'),0);
    gl.uniform1f(location('shadowEnabled'),enabled&&frame?1:0);gl.uniform1f(location('shadowOnly'),ground?1:0);if(!enabled||!frame)return;
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.uniform1i(location('shadowMap'),0);
    for(const [name,key] of [['shadowOrigin','origin'],['shadowRight','right'],['shadowUp','up'],['shadowForward','forward']] as const)gl.uniform3fv(location(name),frame[key]);
    gl.uniform1f(location('shadowSpan'),frame.span);gl.uniform1f(location('shadowNear'),frame.near);gl.uniform1f(location('shadowRange'),frame.range);gl.uniform1f(location('shadowTexel'),1/this.resolution);gl.uniform1f(location('shadowBias'),frame.span*2/this.resolution/frame.range*MODEL_SHADOW_POLICY.biasTexels);
  }
  groundVertices():number[]{const data:number[]=[];if(this.frame)for(const i of [0,1,2,0,2,3])addVertex(data,this.frame.ground[i],[.14,.18,.20]);return data;}
  release():void {const gl=this.gl;if(!gl.isContextLost()){if(this.texture)gl.deleteTexture(this.texture);if(this.framebuffer)gl.deleteFramebuffer(this.framebuffer);if(this.depth)gl.deleteRenderbuffer(this.depth);if(this.program)gl.deleteProgram(this.program);if(this.buffer)gl.deleteBuffer(this.buffer);}this.texture=null;this.framebuffer=null;this.depth=null;this.program=null;this.buffer=null;this.cached=[];this.frame=null;}
}
