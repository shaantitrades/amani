import 'leaflet/dist/leaflet.css';
import { MapContainer, Marker, TileLayer, Popup } from 'react-leaflet';
import L from 'leaflet';

/**
 * Carte OpenStreetMap (gratuite) pour situer une annonce.
 * Chargee a la demande (React.lazy) afin de ne pas alourdir l'ecran d'accueil
 * sur les connexions lentes. Les tuiles sont mises en cache par le service worker.
 */

// Icone par defaut sans fichier image externe (bundle plus leger)
const markerIcon = L.divIcon({
  className: 'bodogui-marker',
  html: '<div class="bodogui-marker__pin">📍</div>',
  iconSize: [40, 40],
  iconAnchor: [20, 38],
});

export default function MapView({ lat, lng, label, district }) {
  if (lat === null || lat === undefined || lng === null || lng === undefined) {
    return <p className="map-empty">Aucune position precise pour cette annonce.</p>;
  }
  const position = [Number(lat), Number(lng)];
  return (
    <div className="map-wrapper">
      <MapContainer center={position} zoom={14} scrollWheelZoom={false} style={{ height: '320px', width: '100%' }}>
        <TileLayer
          attribution="&copy; OpenStreetMap"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        <Marker position={position} icon={markerIcon}>
          <Popup>
            {label} {district ? `— ${district}` : ''}
          </Popup>
        </Marker>
      </MapContainer>
      <a
        className="map-link"
        href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`}
        target="_blank"
        rel="noreferrer"
      >
        Ouvrir dans OpenStreetMap
      </a>
    </div>
  );
}
