import {describe,expect,it} from 'vitest';
import {Figure} from '../../packages/core/src/figure';
import {buildGeometry} from '../../packages/core/src/geometry';
import {cameraMatrix,identity} from '../../packages/core/src/renderer';
import {finishPicking3D,pick3D,picking3DStats,project3D} from '../../packages/core/src/picking3d';

const rect={left:0,top:0,width:200,height:200};

describe('cooperative 3D picking',()=>{
  it('does not block on a large projection and will not return a sample that fails the hit test',()=>{
    const count=80_000,x=new Float64Array(count),y=new Float64Array(count),z=new Float64Array(count);
    x[0]=1;y[0]=1;
    const figure=new Figure(),layer=figure.scatter3d(x,y,z,{size:8});
    const geometry=buildGeometry(layer.spec,figure.registry,{x:[0,1],y:[0,1]},[-1,1],figure.spec.view,200,200);
    const items=[{layer:layer.spec,geometry}],before=picking3DStats.indexBuilds;
    try{
      expect(pick3D(items,figure.registry,identity,rect,100,100)).toBeUndefined();
      expect(picking3DStats.indexBuilds).toBe(before);
      finishPicking3D();
      expect(picking3DStats.indexBuilds).toBe(before+1);
      const origin=project3D([geometry.positions[0],geometry.positions[1],geometry.positions[2]],identity,rect);
      expect(pick3D(items,figure.registry,identity,rect,origin[0],origin[1])).toMatchObject({kind:'point3d',index:0});
      const moved=cameraMatrix(80,20,3,1),duringBuilds=picking3DStats.indexBuilds;
      const during=pick3D(items,figure.registry,moved,rect,origin[0],origin[1]);
      expect(picking3DStats.indexBuilds).toBe(duringBuilds);
      if(during?.kind==='point3d'){
        const vertex=geometry.sourceIndices?.indexOf(during.index)??during.index??-1;
        const projected=project3D([geometry.positions[vertex*3],geometry.positions[vertex*3+1],geometry.positions[vertex*3+2]],moved,rect);
        expect(Math.hypot(projected[0]-origin[0],projected[1]-origin[1])).toBeLessThanOrEqual((geometry.size??5)/2+1e-6);
      }
    }finally{finishPicking3D();figure.close();}
  });
});
