export const philippinesBounds = {
  south: 4.5,
  west: 116.8,
  north: 21.5,
  east: 126.7
};

const deliveryStatusOrder = ['confirmed', 'preparing', 'out_for_delivery', 'delivered'];

export function isPhilippinesLocation(location) {
  return location && Number.isFinite(location.lat) && Number.isFinite(location.lng) &&
    location.lat >= philippinesBounds.south && location.lat <= philippinesBounds.north &&
    location.lng >= philippinesBounds.west && location.lng <= philippinesBounds.east;
}

export function isValidDeliveryDate(value, now = new Date()) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return date.getFullYear() === year && date.getMonth() === month - 1 &&
    date.getDate() === day && date >= today;
}

export function canAdvanceDeliveryStatus(currentStatus, nextStatus) {
  const currentIndex = deliveryStatusOrder.indexOf(currentStatus);
  return currentIndex >= 0 && deliveryStatusOrder[currentIndex + 1] === nextStatus;
}
