import { useEffect } from 'react';
import { divIcon } from 'leaflet';
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { isPhilippinesLocation } from './delivery.js';

const PHILIPPINES_BOUNDS = [[4.5, 116.8], [21.5, 126.7]];
const PHILIPPINES_CENTER = [12.8797, 121.774];

export { isPhilippinesLocation };

const destinationIcon = divIcon({
  className: 'delivery-map-marker destination-map-marker',
  html: '<span></span>',
  iconSize: [24, 24],
  iconAnchor: [12, 12]
});

const courierIcon = divIcon({
  className: 'delivery-map-marker courier-map-marker',
  html: '<span></span>',
  iconSize: [24, 24],
  iconAnchor: [12, 12]
});

function MapClickHandler({ onSelect }) {
  useMapEvents({
    click(event) {
      if (onSelect) {
        onSelect({
          lat: Number(event.latlng.lat.toFixed(6)),
          lng: Number(event.latlng.lng.toFixed(6))
        });
      }
    }
  });
  return null;
}

function MapViewport({ destination, courierLocation }) {
  const map = useMap();

  useEffect(() => {
    const points = [destination, courierLocation]
      .filter(Boolean)
      .map(({ lat, lng }) => [lat, lng]);
    if (points.length > 1) {
      map.fitBounds(points, { padding: [36, 36], maxZoom: 12 });
    } else if (points.length === 1) {
      map.setView(points[0], 13);
    }
  }, [courierLocation, destination, map]);

  return null;
}

export default function DeliveryMap({
  destination,
  courierLocation = null,
  onSelect = null
}) {
  return (
    <MapContainer
      className="delivery-map"
      center={PHILIPPINES_CENTER}
      zoom={5}
      minZoom={5}
      maxZoom={18}
      maxBounds={PHILIPPINES_BOUNDS}
      maxBoundsViscosity={1}
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapClickHandler onSelect={onSelect} />
      <MapViewport destination={destination} courierLocation={courierLocation} />
      {destination && (
        <Marker position={[destination.lat, destination.lng]} icon={destinationIcon} draggable={Boolean(onSelect)}
          eventHandlers={onSelect ? {
            dragend(event) {
              const { lat, lng } = event.target.getLatLng();
              onSelect({ lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) });
            }
          } : undefined}>
          <Popup>Delivery destination</Popup>
        </Marker>
      )}
      {courierLocation && (
        <Marker position={[courierLocation.lat, courierLocation.lng]} icon={courierIcon}>
          <Popup>Courier's latest location</Popup>
        </Marker>
      )}
    </MapContainer>
  );
}
