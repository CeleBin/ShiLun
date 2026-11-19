import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './account.css';
import './decision.css';
import { AuthRoot } from './auth/Identity';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><AuthRoot><App /></AuthRoot></React.StrictMode>);
