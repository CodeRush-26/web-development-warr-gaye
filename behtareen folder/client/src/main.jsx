import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import 'leaflet/dist/leaflet.css';

import L from 'leaflet';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconShadowUrl from 'leaflet/dist/images/marker-shadow.png';

L.Icon.Default.mergeOptions({
  iconUrl,
  shadowUrl: iconShadowUrl,
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
