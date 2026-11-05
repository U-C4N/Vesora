import {colorMap} from './color';
import {gridEdges} from './geometry';
import {createNormalizer} from './scales';
import type {Bounds,Domain,NumericArray,ViewSpec} from './types';

export interface SpectrogramTexture {
  frequencies:NumericArray; times:NumericArray; values:NumericArray;
  bounds:Bounds; view:ViewSpec; domain:Domain; colormap:'viridis'|'magma'; opacity:number;
  capacity:number; sequenceStart:number; sequenceEnd:number; epoch:string; version:number;
  valueScale:'linear'|'db';dbReference:number;dbFloor:number;
}
interface TextureState {texture:WebGLTexture;columns:number;capacity:number;end:number;epoch:string;version:number;encoding:string}
interface UploadStats {uploadedBytes:number;uploadCalls:number;partialUploadCalls:number;textureUploadedBytes:number;textureUploadCalls:number}

/** A scalar ring texture: an append uploads new rows, never the retained matrix. */
export class SpectrogramRenderer {
  private program:WebGLProgram;
  private vao:WebGLVertexArrayObject;
  private vertices:WebGLBuffer;
  private palette:WebGLTexture;
  private paletteName='';
  private textures=new Map<string,TextureState>();
  private uniforms:Record<string,WebGLUniformLocation|null>;
  constructor(private gl:WebGL2RenderingContext,private stats:UploadStats){
    const compile=(kind:number,source:string)=>{const shader=gl.createShader(kind)!;gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader)??'Spectrogram shader failed');return shader;};
    const vs=compile(gl.VERTEX_SHADER,`#version 300 es
      layout(location=0) in vec2 position;layout(location=1) in vec2 coordinate;
      out vec2 uv;void main(){gl_Position=vec4(position,0.,1.);uv=coordinate;}`);
    const fs=compile(gl.FRAGMENT_SHADER,`#version 300 es
      precision highp float;in vec2 uv;uniform highp sampler2D scalar;uniform sampler2D palette;
      uniform float origin;uniform float capacity;uniform float columns;uniform float rows;
      uniform vec2 domain;uniform float opacity;uniform bool decibels;uniform float reference;uniform float floorValue;out vec4 color;
      void main(){float row=min(rows-1.,max(0.,floor(uv.y)));
        float value=texture(scalar,vec2(uv.x,(mod(origin+row,capacity)+.5)/capacity)).r;
        if(isnan(value)||isinf(value))discard;
        if(decibels)value=max(floorValue,10.*log(value/reference)/log(10.));
        float t=domain.y==domain.x?.5:clamp((value-domain.x)/(domain.y-domain.x),0.,1.);
        color=vec4(texture(palette,vec2(t,.5)).rgb,opacity);}`);
    this.program=gl.createProgram()!;gl.attachShader(this.program,vs);gl.attachShader(this.program,fs);gl.linkProgram(this.program);gl.deleteShader(vs);gl.deleteShader(fs);
    if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(this.program)??'Spectrogram program failed');
    this.uniforms=Object.fromEntries(['scalar','palette','origin','capacity','columns','rows','domain','opacity','decibels','reference','floorValue'].map(name=>[name,gl.getUniformLocation(this.program,name)]));
    this.vao=gl.createVertexArray()!;this.vertices=gl.createBuffer()!;this.palette=gl.createTexture()!;
    gl.bindVertexArray(this.vao);gl.bindBuffer(gl.ARRAY_BUFFER,this.vertices);
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,16,0);
    gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,2,gl.FLOAT,false,16,8);
  }
  draw(id:string,item:SpectrogramTexture):void{
    const gl=this.gl,columns=item.frequencies.length,rows=item.times.length;
    if(!columns||!rows)return;
    const maximum=gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,capacity=Math.max(rows,item.capacity);
    if(columns>maximum||capacity>maximum)throw new RangeError(`Spectrogram texture exceeds the GPU limit ${maximum}`);
    let state=this.textures.get(id),fresh=!state||state.columns!==columns||state.capacity!==capacity||state.epoch!==item.epoch||item.sequenceEnd<state.end;
    if(fresh){
      if(state)gl.deleteTexture(state.texture);
      state={texture:gl.createTexture()!,columns,capacity,end:item.sequenceStart,epoch:item.epoch,version:-1,encoding:''};this.textures.set(id,state);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,state.texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.R32F,columns,capacity,0,gl.RED,gl.FLOAT,null);
      const error=gl.getError();if(error!==gl.NO_ERROR){gl.deleteTexture(state.texture);this.textures.delete(id);throw new Error(`Spectrogram texture allocation failed (${error})`);}
    }
    state=state!;gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,state.texture);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
    const encoding=JSON.stringify([item.domain,item.valueScale,item.dbReference,item.dbFloor]),renormalize=state.encoding!==encoding;
    const normalize=item.domain[0]===item.domain[1]?()=>.5:createNormalizer(item.domain,'linear');
    let from=fresh||renormalize?item.sequenceStart:Math.max(item.sequenceStart,state.end);
    if(!fresh&&item.version!==state.version&&item.sequenceEnd===state.end)from=item.sequenceStart;
    while(from<item.sequenceEnd){
      const physical=from%capacity,count=Math.min(item.sequenceEnd-from,capacity-physical),offset=(from-item.sequenceStart)*columns;
      // Normalize in Float64 before upload, preserving finite scientific values
      // outside Float32's exponent range. Raw values remain owned by the scene.
      const values=new Float32Array(count*columns);
      for(let i=0;i<values.length;i++){
        const raw=item.values[offset+i],display=item.valueScale==='db'?Math.max(item.dbFloor,10*(Math.log10(raw)-Math.log10(item.dbReference))):raw;
        values[i]=Number.isFinite(raw)&&Number.isFinite(display)?Math.max(0,Math.min(1,normalize(display))):NaN;
      }
      gl.texSubImage2D(gl.TEXTURE_2D,0,0,physical,columns,count,gl.RED,gl.FLOAT,values);
      this.stats.uploadedBytes+=values.byteLength;this.stats.textureUploadedBytes+=values.byteLength;this.stats.textureUploadCalls++;this.stats.uploadCalls++;if(!fresh)this.stats.partialUploadCalls++;
      from+=count;
    }
    state.end=item.sequenceEnd;state.version=item.version;state.encoding=encoding;
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.palette);
    if(this.paletteName!==item.colormap){
      const colors=new Uint8Array(256*4);for(let i=0;i<256;i++)colors.set(colorMap(i,[0,255],item.colormap).map(value=>Math.round(value*255)),i*4);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,256,1,0,gl.RGBA,gl.UNSIGNED_BYTE,colors);this.paletteName=item.colormap;
    }
    const xe=gridEdges(item.frequencies,item.view.xScale),ye=gridEdges(item.times,item.view.yScale),nx=createNormalizer(item.bounds.x,item.view.xScale),ny=createNormalizer(item.bounds.y,item.view.yScale);
    const bottom=ny(ye[0])*2-1,top=ny(ye[rows])*2-1,data=new Float32Array(columns*24);
    for(let col=0;col<columns;col++){
      const left=nx(xe[col])*2-1,right=nx(xe[col+1])*2-1,u=(col+.5)/columns;
      data.set([left,bottom,u,0,right,bottom,u,0,right,top,u,rows,left,bottom,u,0,right,top,u,rows,left,top,u,rows],col*24);
    }
    gl.useProgram(this.program);gl.bindVertexArray(this.vao);gl.bindBuffer(gl.ARRAY_BUFFER,this.vertices);gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);
    this.stats.uploadedBytes+=data.byteLength;this.stats.uploadCalls++;
    const u=this.uniforms;gl.uniform1i(u.scalar,0);gl.uniform1i(u.palette,1);gl.uniform1f(u.origin,item.sequenceStart%capacity);gl.uniform1f(u.capacity,capacity);gl.uniform1f(u.columns,columns);gl.uniform1f(u.rows,rows);gl.uniform2f(u.domain,0,1);gl.uniform1f(u.opacity,item.opacity);
    gl.uniform1i(u.decibels,0);gl.uniform1f(u.reference,1);gl.uniform1f(u.floorValue,-120);
    gl.drawArrays(gl.TRIANGLES,0,columns*6);gl.activeTexture(gl.TEXTURE0);
  }
  retain(ids:ReadonlySet<string>):void{for(const [id,state] of this.textures)if(!ids.has(id)){this.gl.deleteTexture(state.texture);this.textures.delete(id);}}
  dispose():void{for(const state of this.textures.values())this.gl.deleteTexture(state.texture);this.textures.clear();this.gl.deleteTexture(this.palette);this.gl.deleteBuffer(this.vertices);this.gl.deleteVertexArray(this.vao);this.gl.deleteProgram(this.program);}
}
