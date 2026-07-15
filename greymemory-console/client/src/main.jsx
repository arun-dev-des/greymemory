import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

// Remove the server-readable pitch block (index.html) now that JS is running —
// browsers get the interactive console; non-JS readers keep the static HTML.
document.getElementById('seo')?.remove()

// CSS is imported by App.jsx (shell.css + both surface stylesheets).
ReactDOM.createRoot(document.getElementById('root')).render(<App />)
