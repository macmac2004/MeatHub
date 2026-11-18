const philippinesBounds = {
  south: 4.5,
  west: 116.8,
  north: 21.5,
  east: 126.7
};

export function isPhilippinesLocation(location) {
  return location && Number.isFinite(location.lat) && Number.isFinite(location.lng) &&
    location.lat >= philippinesBounds.south && location.lat <= philippinesBounds.north &&
    location.lng >= philippinesBounds.west && location.lng <= philippinesBounds.east;
}
