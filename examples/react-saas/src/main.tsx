import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './App';
import {StreamingDemo} from './StreamingDemo';
import './style.css';

const streaming = new URLSearchParams(window.location.search).get('demo') === 'streaming';
createRoot(document.getElementById('root')!).render(<StrictMode>{streaming ? <StreamingDemo /> : <App />}</StrictMode>);
