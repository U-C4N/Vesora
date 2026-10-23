// @vitest-environment jsdom
import {act,StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {describe,expect,it,vi} from 'vitest';
import type {Figure} from '../../packages/core/src/figure';
import {VesoraViewer} from '../../packages/react/src/viewer';

const state=vi.hoisted(()=>({handles:[] as any[]}));
vi.mock('@vesora/core/viewer',()=>({mountViewer:vi.fn((figure:Figure,element:HTMLElement)=>{
  const child=document.createElement('div');element.append(child);
  const handle={element:child,figure,dispose:vi.fn(()=>child.remove()),setTheme:vi.fn(),updateOptions:vi.fn()};state.handles.push(handle);return handle;
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
  it('updates mode, chrome, colors and export defaults without replacing the borrowed viewer',async()=>{
    Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});state.handles.length=0;
    const element=document.createElement('div');document.body.append(element);const root=createRoot(element);
    const figure={close:vi.fn()} as unknown as Figure;
    await act(async()=>root.render(<VesoraViewer figure={figure} mode="studio" observation/>));
    const handle=state.handles[0];
    await act(async()=>root.render(<VesoraViewer figure={figure} mode="embed" chrome={{inspector:true}} themeTokens={{accent:'#345678'}} exportSource="accepted" observation/>));
    expect(state.handles).toHaveLength(1);expect(handle.dispose).not.toHaveBeenCalled();
    expect(handle.updateOptions).toHaveBeenCalledWith({mode:'embed',chrome:{inspector:true},themeTokens:{accent:'#345678'}});
    expect(handle.updateOptions).toHaveBeenLastCalledWith({exportSource:'accepted',observation:true});
    handle.updateOptions.mockClear();
    await act(async()=>root.render(<VesoraViewer figure={figure} mode="embed" chrome={{inspector:false}} themeTokens={{accent:'#345678'}} exportSource="accepted" observation/>));
    expect(handle.updateOptions).toHaveBeenCalledExactlyOnceWith({mode:'embed',chrome:{inspector:false},themeTokens:{accent:'#345678'}});
    await act(async()=>root.unmount());expect(handle.dispose).toHaveBeenCalledOnce();expect(figure.close).not.toHaveBeenCalled();element.remove();
  });
});
