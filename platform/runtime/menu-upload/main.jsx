import React from 'react';
import {createRoot} from 'react-dom/client';
import LiffMenuUploadPage from './components/LiffMenuUploadPage';
import {menuUploadEntryFromLocation} from './menu-upload';
import '../index.css';
const entry=menuUploadEntryFromLocation(window.location)||{invalid:true};
createRoot(document.getElementById('root')).render(<LiffMenuUploadPage entry={entry}/>);
