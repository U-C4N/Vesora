'use client';

import {useEffect, useRef, useState} from 'react';
import type {CSSProperties} from 'react';
import type {Figure} from '@vesora/core';
import {mountViewer} from '@vesora/core/viewer';
import type {ViewerHandle, ViewerOptions} from '@vesora/core/viewer';

export interface VesoraViewerProps extends ViewerOptions {
  /** Borrowed from the application. Unmounting this component never closes it. */
  figure: Figure;
  className?: string;
  style?: CSSProperties;
  'aria-label'?: string;
  onReady?: (viewer: ViewerHandle) => void;
}

/** Reusable scientific viewer. Data production remains owned by the caller. */
export function VesoraViewer({figure,theme='dark',title,height,inspector,live,exportHTML,preserveTheme,responsivePanels,className,style,'aria-label':label,onError,onReady}:VesoraViewerProps) {
  const host=useRef<HTMLDivElement>(null),viewer=useRef<ViewerHandle|null>(null);
  const callbacks=useRef({onError,onReady});callbacks.current={onError,onReady};
  const [error,setError]=useState<string|null>(null);
  useEffect(()=>{
    let mounted:ViewerHandle|undefined;
    setError(null);
    try{
      mounted=mountViewer(figure,host.current!,{theme,title,height,inspector,live,exportHTML,preserveTheme,responsivePanels,onError:caught=>{try{callbacks.current.onError?.(caught);}catch{/* Callback failures do not transfer figure ownership. */}}});
      viewer.current=mounted;
      try{callbacks.current.onReady?.(mounted);}catch{/* The viewer is already mounted and still needs cleanup. */}
    }catch(caught){const failure=caught instanceof Error?caught:new Error(String(caught));setError(failure.message);try{callbacks.current.onError?.(failure);}catch{/* Preserve the original mount failure. */}}
    return()=>{mounted?.dispose();if(viewer.current===mounted)viewer.current=null;};
  },[figure,title,height,inspector,live,exportHTML,preserveTheme,responsivePanels]);
  useEffect(()=>{viewer.current?.setTheme(theme);},[theme]);
  return <div className={className} style={style} aria-label={label} data-vesora-viewer-host=""><div ref={host}/>{error&&<p role="alert">{error}</p>}</div>;
}

export type {ViewerHandle,ViewerOptions,ViewerTheme} from '@vesora/core/viewer';
