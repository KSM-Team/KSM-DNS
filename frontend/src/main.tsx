import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@arco-design/web-react/dist/css/arco.css'
// Arco Design 2.66.16 提供 React 19 适配器，必须在使用任何 Arco 组件前导入，
// 否则其内部 CopyReactDOM 会回退到已被 React 19 移除的 ReactDOM.render。
import '@arco-design/web-react/es/_util/react-19-adapter'
import App from './App'

// 注册 PWA Service Worker，用于离线缓存与 Web Push 通知。
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
