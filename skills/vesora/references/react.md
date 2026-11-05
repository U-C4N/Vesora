# React

Use `VesoraChart` for its supported line, bar, and scatter card contracts. For the ten analysis families, create an application-owned core `Figure` and pass it to `VesoraViewer` from `@vesora/react/viewer`.

```tsx
'use client';
import {useEffect, useState} from 'react';
import {figure, type Figure} from '@vesora/core/runtime';
import {VesoraViewer} from '@vesora/react/viewer';

export function LatencyDistribution() {
  const [current, setCurrent] = useState<Figure>();
  useEffect(() => {
    const fig = figure({title: 'Latency', height: 360});
    fig.ccdf([12, 14, 14, 28, 90]);
    setCurrent(fig);
    return () => fig.close();
  }, []);
  return current ? <VesoraViewer figure={current} mode="embed" /> : null;
}
```

The viewer borrows the figure; the owning effect closes it. Construct browser figures inside a client effect. Do not create one on every render or close an externally owned figure in a child component. Preserve data references when only theme/labels change. For controlled row updates, use public layer APIs rather than replacing source registries.

The all-ten-family `scripts/example_react.tsx` imports the browser-safe `makeFigure` factory from `scripts/gallery.mjs`, also used by the executable JS guide. It demonstrates ownership and StrictMode cleanup without inventing an unsupported `VesoraChart` type.
