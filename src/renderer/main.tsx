import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import App from './App';
import WorkspaceSelector from './components/WorkspaceSelector';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

root.render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/workspaces" replace />} />
        <Route path="/workspaces" element={<WorkspaceSelector standalone />} />
        <Route path="/w/:workspaceId/*" element={<App />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
