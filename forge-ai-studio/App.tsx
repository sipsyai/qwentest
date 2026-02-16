import React from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Playground from './pages/Playground';
import Models from './pages/Models';
import ModelDetail from './pages/ModelDetail';
import Embeddings from './pages/Embeddings';
import History from './pages/History';
import Settings from './pages/Settings';
import Datasets from './pages/Datasets';

const Layout = ({ children }: { children?: React.ReactNode }) => (
  <div className="flex bg-slate-950 min-h-screen font-sans text-slate-100">
    <Sidebar />
    <main className="flex-1 ml-64 min-w-0">
      {children}
    </main>
  </div>
);

const App = () => {
  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/playground" replace />} />
          <Route path="/playground" element={<Playground />} />
          <Route path="/models" element={<Models />} />
          <Route path="/models/:id" element={<ModelDetail />} />
          <Route path="/embeddings" element={<Embeddings />} />
          <Route path="/history" element={<History />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/datasets" element={<Datasets />} />
        </Routes>
      </Layout>
    </Router>
  );
};

export default App;
