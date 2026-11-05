'use client';
import {useEffect, useState} from 'react';
import {subplots, type Figure} from '@vesora/core/runtime';
import {VesoraViewer} from '@vesora/react/viewer';
import {makeFigure} from './gallery.mjs';

export function VesoraAnalysisGallery() {
  const [figure, setFigure] = useState<Figure>();
  useEffect(() => {
    const current = makeFigure({subplots});
    setFigure(current);
    return () => current.close();
  }, []);
  return figure ? <VesoraViewer figure={figure} mode="studio" observation /> : <div role="status">Loading analysis…</div>;
}
