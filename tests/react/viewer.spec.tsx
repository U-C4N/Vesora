// @vitest-environment jsdom
import {act,StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {describe,expect,it,vi} from 'vitest';
import type {Figure} from '../../packages/core/src/figure';
import {VesoraViewer} from '../../packages/react/src/viewer';

const state=vi.hoisted(()=>({handles:[] as any[]}));
vi.mock('@vesora/core/viewer',()=>({mountViewer:vi.fn((figure:Figure,element:HTMLElement)=>{
  const child=document.createElement('div');element.append(child);
  const handle={element:child,figure,dispose:vi.fn(()=>child.remove()),setTheme:vi.fn()};state.handles.push(handle);return handle;
})}));
describe('React borrowed viewer',()=>{
  it('survives StrictMode, themes without remounting and leaves application ownership intact',async()=>{
    Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});state.handles.length=0;
    const element=document.createElement('div');document.body.append(element);const root=createRoot(element);
    const figure={close:vi.fn()} as unknown as Figure;
    await act(async()=>root.render(<StrictMode><VesoraViewer figure={figure}/></StrictMode>));
    expect(state.handles).toHaveLength(2);expect(state.handles[0].dispose).toHaveBeenCalledOnce();
    await act(async()=>root.render(<StrictMode><VesoraViewer figure={figure} theme="light"/></StrictMode>));
    expect(state.handles).toHaveLength(2);expect(state.handles[1].setTheme).toHaveBeenLastCalledWith('light');
    await act(async()=>root.unmount());expect(state.handles[1].dispose).toHaveBeenCalledOnce();expect(figure.close).not.toHaveBeenCalled();element.remove();
  });
});
