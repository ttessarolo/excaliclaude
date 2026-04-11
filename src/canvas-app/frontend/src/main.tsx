import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { installClipboardBridge } from './lib/clipboard-bridge'
import '@excalidraw/excalidraw/index.css'

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

installClipboardBridge();

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)