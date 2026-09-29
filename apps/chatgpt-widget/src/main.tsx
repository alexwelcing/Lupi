import { createRoot } from 'react-dom/client';
import { MoleculeApp } from './MoleculeApp';
import './style.css';

const root = document.getElementById('root');
if (!root) throw new Error('Lupi viewer root is missing.');
createRoot(root).render(<MoleculeApp />);
