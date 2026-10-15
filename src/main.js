import { jsx as _jsx } from "react/jsx-runtime";
import React from 'react';
import ReactDOM from 'react-dom/client';
import 'katex/dist/katex.min.css';
import './styles/global.css';
import { App } from './App';
import { AppProvider } from './lib/store';
ReactDOM.createRoot(document.getElementById('root')).render(_jsx(React.StrictMode, { children: _jsx(AppProvider, { children: _jsx(App, {}) }) }));
