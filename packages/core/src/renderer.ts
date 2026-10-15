import type {BackendCapabilities,CameraPreset,ViewSpec,Bounds,Domain} from './types';

export interface Geometry {
  id: string; positions: Float32Array; colors: Float32Array;
  primitive: 'points' | 'lines' | 'triangles'; size?: number;
  indices?: Uint32Array; normals?: Float32Array; wireframeIndices?: Uint32Array;
  lineDirections?: Float32Array; lineSides?: Float32Array; width?: number;
  /** Source row per point, segment start per line triangle, source cell triangle per surface triangle. */
  sourceIndices?: Uint32Array;
}
export function geometryByteLength(g:Geometry):number{return g.positions.byteLength+g.colors.byteLength+(g.indices?.byteLength??0)+(g.normals?.byteLength??0)+(g.wireframeIndices?.byteLength??0)+(g.lineDirections?.byteLength??0)+(g.lineSides?.byteLength??0);}
export function geometryVertexCount(g:Geometry):number{return g.indices?.length??g.positions.length/3;}
/** Inverse axis stretch keeps normals perpendicular after scientific aspect scaling. */
export function normalAspectScale(boxAspect:readonly number[]=[1,1,1]):[number,number,number]{const minimum=Math.min(...boxAspect);return boxAspect.map(value=>minimum/value) as [number,number,number];}
export function scientificAspect(view:ViewSpec,bounds:Bounds,z:Domain):[number,number,number]|undefined{
  if(!view.equalAspect)return view.boxAspect;
  const logSpans=(['x','y','z'] as const).map(axis=>{
    const domain=axis==='z'?z:bounds[axis],span=view[`${axis}Scale`]==='log'?Math.log(domain[1])-Math.log(domain[0]):domain[1]-domain[0];
    if(Number.isFinite(span)&&span>0)return Math.log(span);
    const magnitude=Math.max(Math.abs(domain[0]),Math.abs(domain[1]));
    return Math.log(magnitude)+Math.log(domain[1]/magnitude-domain[0]/magnitude);
  });
  const largest=Math.max(...logSpans);
  // Keep ratios representable by the float32 shader even for extreme domains.
  return logSpans.map(span=>Math.max(1e-30,Math.exp(span-largest))) as [number,number,number];
}
export interface PlotRect {left:number; top:number; width:number; height:number}
interface ShaderProgram {
  handle:WebGLProgram;scientific:boolean;
  uniforms:Record<'matrix'|'size'|'round'|'normalScale'|'viewport'|'width'|'line'|'lit'|'wire',WebGLUniformLocation|null>;
}
export const identity = new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
export function cameraPreset(preset:CameraPreset):ViewSpec['camera']{
  const poses:Record<CameraPreset,[number,number]>={isometric:[35,25],xy:[-90,90],xz:[-90,0],yz:[0,0]};
  if(!Object.hasOwn(poses,preset))throw new Error('Unknown camera preset');
  return {azimuth:poses[preset][0],elevation:poses[preset][1],distance:3};
}
export function cameraMatrix(azimuth: number, elevation: number, distance: number, aspect: number, pan: [number,number] = [0,0],boxAspect: [number,number,number] = [1,1,1]): Float32Array {
  const a=azimuth*Math.PI/180,e=elevation*Math.PI/180,ca=Math.cos(a),sa=Math.sin(a),ce=Math.cos(e),se=Math.sin(e),s=1.9/distance;
  // Scientific coordinates: x/y span the horizontal plane and z points upward.
  const scale=Math.max(...boxAspect),[x,y,z]=boxAspect.map(v=>v/scale);
  return new Float32Array([-sa*s/aspect*x,-ca*se*s*x,-ca*ce*.3*x,0,ca*s/aspect*y,-sa*se*s*y,-sa*ce*.3*y,0,0,ce*s*z,-se*.3*z,0,pan[0],pan[1],0,1]);
}
export class WebGLRenderer {
  readonly capabilities: BackendCapabilities = {name:'WebGL2',supports3d:true,rasterExport:true,vectorExport:false};
  readonly stats={uploadedBytes:0,uploadCalls:0,partialUploadCalls:0,bufferAllocations:0,bufferDeletes:0};
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  private program: ShaderProgram;
  private scientificProgram?:ShaderProgram;
  private buffers = new Map<string,{vao:WebGLVertexArrayObject;p:WebGLBuffer;c:WebGLBuffer;positions:Float32Array;colors:Float32Array;extra:Map<string,{buffer:WebGLBuffer;data:Float32Array|Uint32Array}>}>();
  private lost: (event: Event)=>void;
  private restored: ()=>void;
  private disposed=false;
  private frameHeight=0;
  private frameDpr=1;
  private frameItems=new Set<string>();
  private framebuffer?:WebGLFramebuffer;
  private colorTarget?:WebGLTexture;
  private depthTarget?:WebGLRenderbuffer;
  private multisampleColor?:WebGLRenderbuffer;
  private resolveFramebuffer?:WebGLFramebuffer;
  constructor(canvas: HTMLCanvasElement, onError:(message:string)=>void,private sharedGL?:WebGL2RenderingContext,onRestored?:()=>void) {
    this.canvas=canvas;
    const gl=sharedGL??canvas.getContext('webgl2',{alpha:false,antialias:true,preserveDrawingBuffer:true});
    if (!gl) throw new Error('Vesora requires WebGL2. Enable hardware acceleration or use a WebGL2-capable host.');
    this.gl=gl;
    this.program=this.createProgram();
    this.lost=(event)=>{event.preventDefault();onError('WebGL context lost. Waiting for the browser to restore GPU resources.');};
    this.restored=()=>{
      if(this.disposed)return;
      try{
        this.buffers.clear();this.framebuffer=undefined;this.colorTarget=undefined;this.depthTarget=undefined;this.multisampleColor=undefined;this.resolveFramebuffer=undefined;
        this.program=this.createProgram();this.scientificProgram=undefined;onRestored?.();
      }catch(error){onError(error instanceof Error?error.message:String(error));}
    };
    canvas.addEventListener('webglcontextlost',this.lost);
    canvas.addEventListener('webglcontextrestored',this.restored);
  }
  private createProgram(scientific=false):ShaderProgram {
    const gl=this.gl;
    // Plain charts and unlit surfaces keep the small shader. Compile scientific
    // lighting/line expansion only when a layer actually needs those operations.
    // Explicit locations let both programs use the same position/color VAOs.
    const vertex=scientific?`#version 300 es
      layout(location=0) in vec3 aPosition; layout(location=1) in vec4 aColor;
      layout(location=2) in vec3 aNormal; layout(location=3) in vec3 aLineDirection; layout(location=4) in float aLineSide;
      uniform mat4 uMatrix; uniform vec3 uNormalScale; uniform float uSize; uniform vec2 uViewport; uniform float uWidth; uniform bool uLine;
      out vec4 vColor; out vec3 vNormal; void main(){
        gl_Position=uMatrix*vec4(aPosition,1.0);
        if(uLine){vec2 delta=(uMatrix*vec4(aLineDirection,0.0)).xy*uViewport;
          float len=length(delta);if(len>0.0)gl_Position.xy+=vec2(-delta.y,delta.x)/len*aLineSide*uWidth/uViewport;}
        gl_PointSize=uSize;vColor=aColor;vNormal=aNormal*uNormalScale;}`:`#version 300 es
      layout(location=0) in vec3 aPosition; layout(location=1) in vec4 aColor;
      uniform mat4 uMatrix; uniform float uSize;
      out vec4 vColor; void main(){gl_Position=uMatrix*vec4(aPosition,1.0);gl_PointSize=uSize;vColor=aColor;}`;
    const fragment=scientific?`#version 300 es
      precision highp float; in vec4 vColor; in vec3 vNormal; uniform bool uRound; uniform bool uLit; uniform bool uWire; out vec4 outColor;
      void main(){if(uRound && length(gl_PointCoord-vec2(.5))>.5) discard;
        float light=uLit ? .3+.7*abs(dot(normalize(vNormal),normalize(vec3(.3,-.4,.85)))) : 1.0;
        outColor=vec4(vColor.rgb*(uWire ? .35 : light),vColor.a);}`:`#version 300 es
      precision highp float; in vec4 vColor; uniform bool uRound; out vec4 outColor;
      void main(){if(uRound && length(gl_PointCoord-vec2(.5))>.5) discard;outColor=vColor;}`;
    const compile=(kind:number,source:string)=>{
      const shader=gl.createShader(kind)!;gl.shaderSource(shader,source);gl.compileShader(shader);
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const error=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw new Error(error??'Shader compilation failed');}return shader;
    };
    const vs=compile(gl.VERTEX_SHADER,vertex),fs=compile(gl.FRAGMENT_SHADER,fragment);
    const program=gl.createProgram()!;gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
    gl.deleteShader(vs);gl.deleteShader(fs);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS)){const message=gl.getProgramInfoLog(program)??'Shader link failed';gl.deleteProgram(program);throw new Error(message);}
    // Location queries can synchronize with the GPU; never repeat them per frame.
    const uniform=(name:string)=>gl.getUniformLocation(program,name);
    return {handle:program,scientific,uniforms:{matrix:uniform('uMatrix'),size:uniform('uSize'),round:uniform('uRound'),
      normalScale:scientific?uniform('uNormalScale'):null,viewport:scientific?uniform('uViewport'):null,
      width:scientific?uniform('uWidth'):null,line:scientific?uniform('uLine'):null,
      lit:scientific?uniform('uLit'):null,wire:scientific?uniform('uWire'):null}};
  }
  private createBuffer():WebGLBuffer{const buffer=this.gl.createBuffer();if(!buffer)throw new Error('GPU buffer allocation failed');this.stats.bufferAllocations++;return buffer;}
  private deleteBuffer(buffer:WebGLBuffer):void{this.gl.deleteBuffer(buffer);this.stats.bufferDeletes++;}
  private uploadBuffer(target:number,data:Float32Array|Uint32Array,previous?:Float32Array|Uint32Array):void{
    // A change in topology or capacity requires a full allocation. For a stable
    // attribute layout, upload only the changed span, including interior edits.
    if(previous?.constructor===data.constructor&&previous.length===data.length){
      let first=0;while(first<data.length&&data[first]===previous[first])first++;
      if(first===data.length)return;
      let end=data.length;while(end>first&&data[end-1]===previous[end-1])end--;
      if(end-first<data.length*.75){const changed=data.subarray(first,end);this.gl.bufferSubData(target,first*data.BYTES_PER_ELEMENT,changed);this.stats.uploadedBytes+=changed.byteLength;this.stats.uploadCalls++;this.stats.partialUploadCalls++;return;}
    }
    this.gl.bufferData(target,data,this.gl.DYNAMIC_DRAW);this.stats.uploadedBytes+=data.byteLength;this.stats.uploadCalls++;
  }
  /** Clear once for the whole figure; resources survive between panel draws. */
  validateRasterSize(width:number,height:number):void {
    const gl=this.gl,viewport=gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
    const maximum=Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),gl.getParameter(gl.MAX_TEXTURE_SIZE));
    if(width>Math.min(maximum,viewport[0])||height>Math.min(maximum,viewport[1]))throw new RangeError('PNG raster exceeds this GPU\'s viewport/renderbuffer limits');
  }
  beginFrame(width:number,height:number,dpr:number,background:readonly number[]=[1,1,1,1]):void {
    const gl=this.gl,w=Math.round(width*dpr),h=Math.round(height*dpr);
    if(gl.isContextLost())throw new Error('WebGL context lost. Remount the figure to restore GPU resources.');
    this.frameHeight=height;this.frameDpr=dpr;this.frameItems.clear();
    if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}
    if(this.sharedGL){
      this.validateRasterSize(w,h);
      const previous=gl.getParameter(gl.FRAMEBUFFER_BINDING);
      try{
      if(!this.framebuffer){this.framebuffer=gl.createFramebuffer()!;this.colorTarget=gl.createTexture()!;this.depthTarget=gl.createRenderbuffer()!;}
      gl.bindTexture(gl.TEXTURE_2D,this.colorTarget!);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      const samples=Math.min(4,gl.getParameter(gl.MAX_SAMPLES));
      if(samples>0){
        this.resolveFramebuffer??=gl.createFramebuffer()!;this.multisampleColor??=gl.createRenderbuffer()!;
        gl.bindFramebuffer(gl.FRAMEBUFFER,this.resolveFramebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.colorTarget!,0);
        gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer);
        gl.bindRenderbuffer(gl.RENDERBUFFER,this.multisampleColor);gl.renderbufferStorageMultisample(gl.RENDERBUFFER,samples,gl.RGBA8,w,h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.RENDERBUFFER,this.multisampleColor);
        gl.bindRenderbuffer(gl.RENDERBUFFER,this.depthTarget!);gl.renderbufferStorageMultisample(gl.RENDERBUFFER,samples,gl.DEPTH_COMPONENT16,w,h);
      }else{
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.colorTarget!,0);
      gl.bindRenderbuffer(gl.RENDERBUFFER,this.depthTarget!);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,w,h);
      }
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,this.depthTarget!);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('PNG render target allocation failed');
      const allocationError=gl.getError();if(allocationError!==gl.NO_ERROR)throw new Error(`PNG render target allocation failed (${allocationError})`);
      }catch(error){
        // An export allocation failure must not poison the next live frame.
        for(let attempt=0;attempt<32&&gl.getError()!==gl.NO_ERROR;attempt++){}
        gl.bindFramebuffer(gl.FRAMEBUFFER,previous);throw error;
      }
    }else gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    gl.disable(gl.SCISSOR_TEST);gl.viewport(0,0,w,h);gl.clearColor(background[0],background[1],background[2],background[3]);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  }
  drawPanel(items:Geometry[],rect:PlotRect,matrix:Float32Array=identity,threeD=false,boxAspect?:[number,number,number]):void {
    const gl=this.gl,height=this.frameHeight,dpr=this.frameDpr;
    gl.viewport(Math.round(rect.left*dpr),Math.round((height-rect.top-rect.height)*dpr),Math.round(rect.width*dpr),Math.round(rect.height*dpr));
    gl.enable(gl.SCISSOR_TEST);gl.scissor(Math.round(rect.left*dpr),Math.round((height-rect.top-rect.height)*dpr),Math.round(rect.width*dpr),Math.round(rect.height*dpr));
    if(threeD) gl.enable(gl.DEPTH_TEST);else gl.disable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.enable(gl.BLEND);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
    let active:ShaderProgram|undefined;
    for(const item of items){
      const program=item.normals||item.lineDirections||item.wireframeIndices?(this.scientificProgram??=this.createProgram(true)):this.program;
      const uniforms=program.uniforms;
      if(active!==program){
        gl.useProgram(program.handle);gl.uniformMatrix4fv(uniforms.matrix,false,matrix);
        if(program.scientific){gl.uniform3fv(uniforms.normalScale,normalAspectScale(boxAspect));gl.uniform2f(uniforms.viewport,rect.width*dpr,rect.height*dpr);}
        active=program;
      }
      this.frameItems.add(item.id);let buffer=this.buffers.get(item.id);
      if(!buffer){
        const vao=gl.createVertexArray()!,p=this.createBuffer(),c=this.createBuffer();
        buffer={vao,p,c,positions:new Float32Array(0),colors:new Float32Array(0),extra:new Map()};this.buffers.set(item.id,buffer);
        gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,p);
        gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0);
        gl.bindBuffer(gl.ARRAY_BUFFER,c);gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,4,gl.FLOAT,false,0,0);
      }
      gl.bindVertexArray(buffer.vao);
      if(buffer.positions!==item.positions){gl.bindBuffer(gl.ARRAY_BUFFER,buffer.p);this.uploadBuffer(gl.ARRAY_BUFFER,item.positions,buffer.positions);buffer.positions=item.positions;}
      if(buffer.colors!==item.colors){gl.bindBuffer(gl.ARRAY_BUFFER,buffer.c);this.uploadBuffer(gl.ARRAY_BUFFER,item.colors,buffer.colors);buffer.colors=item.colors;}
      const upload=(key:string,data:Float32Array|Uint32Array,target:number)=>{
        let entry=buffer!.extra.get(key);if(!entry){entry={buffer:this.createBuffer(),data};buffer!.extra.set(key,entry);gl.bindBuffer(target,entry.buffer);this.uploadBuffer(target,data);}
        else{gl.bindBuffer(target,entry.buffer);if(entry.data!==data){this.uploadBuffer(target,data,entry.data);entry.data=data;}}return entry;
      };
      if(program.scientific)for(const [name,data,size,location]of [['aNormal',item.normals,3,2],['aLineDirection',item.lineDirections,3,3],['aLineSide',item.lineSides,1,4]] as const){
        if(data){upload(name,data,gl.ARRAY_BUFFER);gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,size,gl.FLOAT,false,0,0);}else{gl.disableVertexAttribArray(location);if(size===1)gl.vertexAttrib1f(location,0);else gl.vertexAttrib3f(location,0,0,1);}
      }
      else for(const [name,location]of [['aNormal',2],['aLineDirection',3],['aLineSide',4]] as const)if(buffer.extra.has(name))gl.disableVertexAttribArray(location);
      const liveExtras=new Set(['aNormal','aLineDirection','aLineSide'].filter(name=>name==='aNormal'?!!item.normals:name==='aLineDirection'?!!item.lineDirections:!!item.lineSides));if(item.indices)liveExtras.add('indices');if(item.wireframeIndices)liveExtras.add('wire');
      for(const [key,entry]of buffer.extra)if(!liveExtras.has(key)){this.deleteBuffer(entry.buffer);buffer.extra.delete(key);}
      gl.uniform1f(uniforms.size,(item.size??5)*dpr);
      gl.uniform1i(uniforms.round,item.primitive==='points'?1:0);
      if(program.scientific){
        gl.uniform1i(uniforms.line,item.lineDirections?1:0);gl.uniform1f(uniforms.width,(item.width??1.5)*dpr);
        gl.uniform1i(uniforms.lit,item.normals?1:0);gl.uniform1i(uniforms.wire,0);
      }
      const mode=item.primitive==='points'?gl.POINTS:item.primitive==='lines'?gl.LINES:gl.TRIANGLES;
      if(item.indices){upload('indices',item.indices,gl.ELEMENT_ARRAY_BUFFER);gl.drawElements(mode,item.indices.length,gl.UNSIGNED_INT,0);}else gl.drawArrays(mode,0,item.positions.length/3);
      // Unbiased filled depth preserves the same coplanar tie rule as CPU picking.
      // Only the matching surface edges may pass equal depth; later layers use LESS.
      if(item.wireframeIndices){upload('wire',item.wireframeIndices,gl.ELEMENT_ARRAY_BUFFER);gl.uniform1i(uniforms.wire,1);gl.uniform1i(uniforms.lit,0);gl.depthFunc(gl.LEQUAL);gl.drawElements(gl.LINES,item.wireframeIndices.length,gl.UNSIGNED_INT,0);gl.depthFunc(gl.LESS);}
    }
  }
  endFrame():void {
    const gl=this.gl;
    for(const [id,b] of this.buffers)if(!this.frameItems.has(id)){this.deleteBuffer(b.p);this.deleteBuffer(b.c);for(const entry of b.extra.values())this.deleteBuffer(entry.buffer);gl.deleteVertexArray(b.vao);this.buffers.delete(id);}
    gl.bindVertexArray(null);gl.disable(gl.SCISSOR_TEST);
    if(gl.isContextLost())throw new Error('WebGL context lost. Waiting for the browser to restore GPU resources.');
    const error=gl.getError();if(error!==gl.NO_ERROR)throw new Error(`WebGL frame failed (${error}).`);
  }
  draw(items:Geometry[],rect:PlotRect,width:number,height:number,dpr:number,matrix:Float32Array=identity,threeD=false,boxAspect?:[number,number,number]):void {
    this.beginFrame(width,height,dpr);this.drawPanel(items,rect,matrix,threeD,boxAspect);this.endFrame();
  }
  rasterCanvas():HTMLCanvasElement {
    if(!this.sharedGL)return this.canvas;
    const gl=this.gl,w=this.canvas.width,h=this.canvas.height,previous=gl.getParameter(gl.FRAMEBUFFER_BINDING);
    if(gl.isContextLost())throw new Error('WebGL context lost during PNG export');
    try{
      if(this.resolveFramebuffer){
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER,this.framebuffer!);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,this.resolveFramebuffer);
        gl.blitFramebuffer(0,0,w,h,0,0,w,h,gl.COLOR_BUFFER_BIT,gl.NEAREST);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.resolveFramebuffer??this.framebuffer!);const pixels=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      if(gl.getError()!==gl.NO_ERROR)throw new Error('PNG pixel readback failed');
      const ctx=this.canvas.getContext('2d')!,output=ctx.createImageData(w,h);
      for(let row=0;row<h;row++)output.data.set(pixels.subarray((h-row-1)*w*4,(h-row)*w*4),row*w*4);
      ctx.putImageData(output,0,0);return this.canvas;
    }finally{gl.bindFramebuffer(gl.FRAMEBUFFER,previous);}
  }
  dispose():void {
    if(this.disposed)return;this.disposed=true;
    const gl=this.gl;for(const b of this.buffers.values()){this.deleteBuffer(b.p);this.deleteBuffer(b.c);for(const entry of b.extra.values())this.deleteBuffer(entry.buffer);gl.deleteVertexArray(b.vao);}
    this.buffers.clear();const current=gl.getParameter(gl.CURRENT_PROGRAM),programs=[this.program,this.scientificProgram].filter((program):program is ShaderProgram=>!!program);
    if(programs.some(program=>program.handle===current))gl.useProgram(null);for(const program of programs)gl.deleteProgram(program.handle);
    this.canvas.removeEventListener('webglcontextlost',this.lost);this.canvas.removeEventListener('webglcontextrestored',this.restored);
    if(this.framebuffer)gl.deleteFramebuffer(this.framebuffer);if(this.colorTarget)gl.deleteTexture(this.colorTarget);if(this.depthTarget)gl.deleteRenderbuffer(this.depthTarget);
    if(this.resolveFramebuffer)gl.deleteFramebuffer(this.resolveFramebuffer);if(this.multisampleColor)gl.deleteRenderbuffer(this.multisampleColor);
    // A detached canvas can retain its GPU context until GC. Release it now so
    // remounting galleries cannot evict another figure's still-active context.
    if(!this.sharedGL)gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
