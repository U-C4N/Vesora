import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './App';
import {StreamingDemo} from './StreamingDemo';
import {WorkbenchDemo} from './WorkbenchDemo';
import './style.css';

const demo = new URLSearchParams(window.location.search).get('demo');
createRoot(document.getElementById('root')!).render(<StrictMode>{demo==='workbench'?<WorkbenchDemo/>:demo==='streaming'?<StreamingDemo/>:<App/>}</StrictMode>);
