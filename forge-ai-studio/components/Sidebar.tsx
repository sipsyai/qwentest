import React from 'react';
import {
  TerminalSquare,
  Box,
  Database,
  History,
  Settings,
  Cpu,
  User,
  Sparkles
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

const Sidebar = () => {
  const location = useLocation();

  const isActive = (path: string) => {
    return location.pathname === path ? 'bg-blue-600/10 text-blue-400 border-r-2 border-blue-500' : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50';
  };

  const NavItem = ({ to, icon: Icon, label }: { to: string, icon: any, label: string }) => (
    <Link 
      to={to} 
      className={`flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors ${isActive(to)}`}
    >
      <Icon size={18} />
      {label}
    </Link>
  );

  return (
    <div className="w-64 h-screen bg-slate-900 border-r border-slate-800 flex flex-col fixed left-0 top-0 z-50">
      {/* Brand */}
      <div className="p-6 flex items-center gap-3">
        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-900/50">
          <Sparkles className="text-white w-5 h-5" />
        </div>
        <div>
          <h1 className="text-white font-bold text-lg tracking-tight">Forge AI</h1>
          <p className="text-slate-500 text-xs font-medium">AI Studio</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 flex flex-col gap-1">
        <NavItem to="/playground" icon={TerminalSquare} label="Playground" />
        <NavItem to="/models" icon={Box} label="Models" />
        <NavItem to="/embeddings" icon={Cpu} label="Embeddings" />
        <NavItem to="/datasets" icon={Database} label="Datasets" />
        
        <div className="px-6 py-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Workspace</p>
        </div>
        
        <NavItem to="/history" icon={History} label="History" />
        <NavItem to="/settings" icon={Settings} label="Settings" />
      </nav>

      {/* User Profile */}
      <div className="p-4 border-t border-slate-800">
        <div className="flex items-center gap-3 bg-slate-800/50 p-3 rounded-xl border border-slate-700/50 hover:bg-slate-800 transition-colors cursor-pointer">
          <div className="w-9 h-9 bg-gradient-to-tr from-amber-200 to-amber-500 rounded-full flex items-center justify-center text-slate-900 font-bold">
            <User size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">Admin User</p>
            <p className="text-xs text-slate-400 truncate">v2.4.0 Premium</p>
          </div>
          <Settings size={14} className="text-slate-500" />
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
