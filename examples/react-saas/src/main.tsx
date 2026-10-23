import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import './base.css';

const demo = new URLSearchParams(window.location.search).get('demo');
const host=document.getElementById('root')!;
const opening=document.createElement('main');
opening.className='vesora-opening';opening.setAttribute('aria-busy','true');
const status=document.createElement('p');status.setAttribute('role','status');status.textContent='Opening Vesora…';opening.append(status);host.replaceChildren(opening);

// Resolve only the selected screen before mounting React. A Suspense fallback
// during this initial route import can throttle the first content commit.
// Keep each import inside its own loader so the bundler keeps its preload
// dependencies local to that screen (including the dashboard-only fonts/CSS).
const loaders={
  balance:async()=>(await import('./BalanceDemo')).BalanceDemo,
  workbench:async()=>(await import('./WorkbenchDemo')).WorkbenchDemo,
  streaming:async()=>(await import('./StreamingDemo')).StreamingDemo,
  dashboard:async()=>(await import('./App')).App,
};
const load=loaders[Object.hasOwn(loaders,demo??'')?demo as keyof typeof loaders:'dashboard'];
void load().then(Screen=>createRoot(host).render(<StrictMode><Screen/></StrictMode>)).catch(error=>{
  console.error('Unable to load the Vesora screen.',error);
  opening.setAttribute('aria-busy','false');status.setAttribute('role','alert');
  status.textContent='This screen could not be loaded. Check your connection and reload.';
  const retry=document.createElement('button');retry.textContent='Reload screen';retry.addEventListener('click',()=>window.location.reload());opening.append(retry);
});
