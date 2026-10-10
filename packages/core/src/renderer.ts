import type {BackendCapabilities} from './types';

export interface Geometry {
  id: string; positions: Float32Array; colors: Float32Array;
  primitive: 'points' | 'lines' | 'triangles'; size?: number;
}
export interface PlotRect {left:number; top:number; width:number; height:number}
export const identity = new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
export function cameraMatrix(azimuth: number, elevation: number, distance: number, aspect: number, pan: [number,number] = [0,0]): Float32Array {
  const a=azimuth*Math.PI/180,e=elevation*Math.PI/180,ca=Math.cos(a),sa=Math.sin(a),ce=Math.cos(e),se=Math.sin(e),s=1.9/distance;
  // Scientific coordinates: x/y span the horizontal plane and z points upward.
  return new Float32Array([-sa*s/aspect,-ca*se*s,-ca*ce*.3,0,ca*s/aspect,-sa*se*s,-sa*ce*.3,0,0,ce*s,-se*.3,0,pan[0],pan[1],0,1]);
}
export class WebGLRenderer {
  readonly capabilities: BackendCapabilities = {name:'WebGL2',supports3d:true,rasterExport:true,vectorExport:false};
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private buffers = new Map<string,{vao:WebGLVertexArrayObject;p:WebGLBuffer;c:WebGLBuffer;positions:Float32Array;colors:Float32Array}>();
  private lost: (event: Event)=>void;
  private frameHeight=0;
  private frameDpr=1;
  private frameItems=new Set<string>();
  constructor(canvas: HTMLCanvasElement, onError:(message:string)=>void) {
    this.canvas=canvas;
    const gl=canvas.getContext('webgl2',{alpha:false,antialias:true,preserveDrawingBuffer:true});
    if (!gl) throw new Error('Vesora requires WebGL2. Enable hardware acceleration or use a WebGL2-capable host.');
    this.gl=gl;
    const vertex=`#version 300 es
      in vec3 aPosition; in vec4 aColor; uniform mat4 uMatrix; uniform float uSize;
      out vec4 vColor; void main(){gl_Position=uMatrix*vec4(aPosition,1.0);gl_PointSize=uSize;vColor=aColor;}`;
    const fragment=`#version 300 es
      precision highp float; in vec4 vColor; uniform bool uRound; out vec4 outColor;
      void main(){if(uRound && length(gl_PointCoord-vec2(.5))>.5) discard; outColor=vColor;}`;
    const compile=(kind:number,source:string)=>{
      const shader=gl.createShader(kind)!;gl.shaderSource(shader,source);gl.compileShader(shader);
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const error=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw new Error(error??'Shader compilation failed');}return shader;
    };
    const vs=compile(gl.VERTEX_SHADER,vertex),fs=compile(gl.FRAGMENT_SHADER,fragment);
    this.program=gl.createProgram()!;gl.attachShader(this.program,vs);gl.attachShader(this.program,fs);gl.linkProgram(this.program);
    gl.deleteShader(vs);gl.deleteShader(fs);
    if(!gl.getProgramParameter(this.program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program)??'Shader link failed');
    this.lost=(event)=>{event.preventDefault();onError('WebGL context lost. Remount the figure to restore GPU resources.');};
    canvas.addEventListener('webglcontextlost',this.lost);
  }
  /** Clear once for the whole figure; resources survive between panel draws. */
  beginFrame(width:number,height:number,dpr:number):void {
    const gl=this.gl,w=Math.round(width*dpr),h=Math.round(height*dpr);
    if(gl.isContextLost())throw new Error('WebGL context lost. Remount the figure to restore GPU resources.');
    this.frameHeight=height;this.frameDpr=dpr;this.frameItems.clear();
    if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}
    gl.disable(gl.SCISSOR_TEST);gl.viewport(0,0,w,h);gl.clearColor(1,1,1,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  }
  drawPanel(items:Geometry[],rect:PlotRect,matrix:Float32Array=identity,threeD=false):void {
    const gl=this.gl,height=this.frameHeight,dpr=this.frameDpr;
    gl.viewport(Math.round(rect.left*dpr),Math.round((height-rect.top-rect.height)*dpr),Math.round(rect.width*dpr),Math.round(rect.height*dpr));
    gl.enable(gl.SCISSOR_TEST);gl.scissor(Math.round(rect.left*dpr),Math.round((height-rect.top-rect.height)*dpr),Math.round(rect.width*dpr),Math.round(rect.height*dpr));
    if(threeD) gl.enable(gl.DEPTH_TEST);else gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.program);gl.uniformMatrix4fv(gl.getUniformLocation(this.program,'uMatrix'),false,matrix);
    for(const item of items){
      this.frameItems.add(item.id);let buffer=this.buffers.get(item.id);
      if(!buffer){
        const vao=gl.createVertexArray()!,p=gl.createBuffer()!,c=gl.createBuffer()!;
        buffer={vao,p,c,positions:new Float32Array(0),colors:new Float32Array(0)};this.buffers.set(item.id,buffer);
        gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,p);
        const position=gl.getAttribLocation(this.program,'aPosition');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,3,gl.FLOAT,false,0,0);
        gl.bindBuffer(gl.ARRAY_BUFFER,c);const color=gl.getAttribLocation(this.program,'aColor');gl.enableVertexAttribArray(color);gl.vertexAttribPointer(color,4,gl.FLOAT,false,0,0);
      }
      gl.bindVertexArray(buffer.vao);
      if(buffer.positions!==item.positions){gl.bindBuffer(gl.ARRAY_BUFFER,buffer.p);gl.bufferData(gl.ARRAY_BUFFER,item.positions,gl.DYNAMIC_DRAW);buffer.positions=item.positions;}
      if(buffer.colors!==item.colors){gl.bindBuffer(gl.ARRAY_BUFFER,buffer.c);gl.bufferData(gl.ARRAY_BUFFER,item.colors,gl.DYNAMIC_DRAW);buffer.colors=item.colors;}
      gl.uniform1f(gl.getUniformLocation(this.program,'uSize'),(item.size??5)*dpr);
      gl.uniform1i(gl.getUniformLocation(this.program,'uRound'),item.primitive==='points'?1:0);
      gl.drawArrays(item.primitive==='points'?gl.POINTS:item.primitive==='lines'?gl.LINES:gl.TRIANGLES,0,item.positions.length/3);
    }
  }
  endFrame():void {
    const gl=this.gl;
    for(const [id,b] of this.buffers)if(!this.frameItems.has(id)){gl.deleteBuffer(b.p);gl.deleteBuffer(b.c);gl.deleteVertexArray(b.vao);this.buffers.delete(id);}
    gl.bindVertexArray(null);gl.disable(gl.SCISSOR_TEST);
    if(gl.isContextLost())throw new Error('WebGL context lost. Remount the figure to restore GPU resources.');
    const error=gl.getError();if(error!==gl.NO_ERROR)throw new Error(`WebGL frame failed (${error}).`);
  }
  draw(items:Geometry[],rect:PlotRect,width:number,height:number,dpr:number,matrix:Float32Array=identity,threeD=false):void {
    this.beginFrame(width,height,dpr);this.drawPanel(items,rect,matrix,threeD);this.endFrame();
  }
  dispose():void {
    const gl=this.gl;for(const b of this.buffers.values()){gl.deleteBuffer(b.p);gl.deleteBuffer(b.c);gl.deleteVertexArray(b.vao);}
    this.buffers.clear();gl.deleteProgram(this.program);this.canvas.removeEventListener('webglcontextlost',this.lost);
    // A detached canvas can retain its GPU context until GC. Release it now so
    // remounting galleries cannot evict another figure's still-active context.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
