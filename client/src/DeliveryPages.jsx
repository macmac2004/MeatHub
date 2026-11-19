import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, CircleUserRound, Clock3, LocateFixed, MapPin, PackageCheck, Phone, Truck } from 'lucide-react';
import { API_URL } from './apiUrl.js';

const DeliveryMap = lazy(() => import('./DeliveryMap.jsx'));
const statusSteps = [
  { id: 'pending_seller', label: 'Waiting for seller' },
  { id: 'confirmed', label: 'Order confirmed' },
  { id: 'preparing', label: 'Preparing' },
  { id: 'out_for_delivery', label: 'Out for delivery' },
  { id: 'delivered', label: 'Delivered' }
];

async function deliveryRequest(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status}).`);
  }
  return response.json();
}

function DeliveryProgress({ status }) {
  const activeIndex = statusSteps.findIndex((step) => step.id === status);
  return (
    <ol className="delivery-progress" aria-label="Delivery status">
      {statusSteps.map((step, index) => (
        <li key={step.id} className={index <= activeIndex ? 'delivery-progress-step complete' : 'delivery-progress-step'}>
          <span>{index < activeIndex ? <Check size={14} /> : index + 1}</span>
          <b>{step.label}</b>
        </li>
      ))}
    </ol>
  );
}

function DeliveryPage({ eyebrow, title, children }) {
  return (
    <main className="delivery-page">
      <a className="delivery-back-link" href="/"><ArrowLeft size={15} /> MeatHub market</a>
      <section className="delivery-page-card">
        <div className="delivery-page-heading">
          <small>{eyebrow}</small>
          <h1>{title}</h1>
        </div>
        {children}
      </section>
    </main>
  );
}

function DeliveryMapCard({ order }) {
  return (
    <section className="delivery-map-card">
      <div className="delivery-map-heading">
        <span><MapPin size={16} /> Destination in the Philippines</span>
        {order.courierLocation && <small><span className="live-dot" /> Courier location updates live</small>}
      </div>
      <Suspense fallback={<div className="map-loading">Loading Philippines map…</div>}>
        <DeliveryMap destination={order.deliveryLocation} courierLocation={order.courierLocation} />
      </Suspense>
      <p className="delivery-address"><b>Deliver to:</b> {order.deliveryAddress}</p>
      <small className="map-coordinate-copy">
        {order.deliveryLocation.lat.toFixed(5)}, {order.deliveryLocation.lng.toFixed(5)}
        {order.courierLocation && ` · Courier updated ${new Date(order.courierLocation.updatedAt).toLocaleTimeString()}`}
      </small>
    </section>
  );
}

export function TrackingPage({ token }) {
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const result = await deliveryRequest(`/api/tracking/${encodeURIComponent(token)}`);
        if (active) {
          setOrder(result);
          setError('');
        }
      } catch (requestError) {
        if (active) setError(requestError.message);
      }
    }
    refresh();
    const interval = window.setInterval(refresh, 5000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [token]);

  return (
    <DeliveryPage eyebrow="MEATHUB DELIVERY" title={order ? `Delivery #${order.id.slice(0, 8)}` : 'Tracking your delivery'}>
      {error && !order && <p className="delivery-error" role="alert">{error}</p>}
      {!order && !error && <p className="delivery-loading">Loading delivery updates…</p>}
      {order && (
        <>
          <div className="delivery-order-summary">
            <div><small>PAYMENT</small><b>Cash on delivery · {order.paymentStatus === 'paid' ? 'Paid' : 'Pay on arrival'}</b></div>
            <div><small>DELIVERY DATE</small><b>{new Date(`${order.deliveryDate}T00:00:00`).toLocaleDateString()}</b></div>
            <div><small>ORDER TOTAL</small><b>₱{Number(order.total).toLocaleString('en-PH')}</b></div>
          </div>
          <DeliveryProgress status={order.status} />
          {order.status === 'cancelled' && <p className="delivery-error">This delivery was cancelled.</p>}
          <DeliveryMapCard order={order} />
          <div className="delivery-refresh-note"><Clock3 size={14} /> This page refreshes delivery updates every 5 seconds.</div>
        </>
      )}
    </DeliveryPage>
  );
}

export function CourierPage({ token }) {
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [gpsError, setGpsError] = useState('');
  const [sharing, setSharing] = useState(false);
  const watchId = useRef(null);
  const lastLocationPost = useRef(0);

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const result = await deliveryRequest(`/api/courier/${encodeURIComponent(token)}`);
        if (active) {
          setOrder(result);
          setError('');
        }
      } catch (requestError) {
        if (active) setError(requestError.message);
      }
    }
    refresh();
    const interval = window.setInterval(refresh, 5000);
    return () => {
      active = false;
      window.clearInterval(interval);
      if (watchId.current !== null) navigator.geolocation?.clearWatch(watchId.current);
    };
  }, [token]);

  function startLocationSharing() {
    if (!navigator.geolocation) {
      setGpsError('This browser does not support device location.');
      return;
    }
    if (watchId.current !== null) return;
    watchId.current = navigator.geolocation.watchPosition(async ({ coords }) => {
      if (Date.now() - lastLocationPost.current < 5000) return;
      lastLocationPost.current = Date.now();
      try {
        const updated = await deliveryRequest(`/api/courier/${encodeURIComponent(token)}/location`, {
          method: 'POST',
          body: JSON.stringify({ lat: coords.latitude, lng: coords.longitude })
        });
        setOrder(updated);
        setGpsError('');
      } catch (requestError) {
        setGpsError(requestError.message);
      }
    }, (locationError) => {
      setGpsError(`Could not read device location: ${locationError.message}`);
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
    setSharing(true);
    setGpsError('Allow location access in your browser. Live sharing works while this page stays open.');
  }

  function stopLocationSharing() {
    if (watchId.current !== null) {
      navigator.geolocation?.clearWatch(watchId.current);
      watchId.current = null;
    }
    setSharing(false);
  }

  async function advanceStatus(status, cashCollected = false) {
    try {
      const updated = await deliveryRequest(`/api/courier/${encodeURIComponent(token)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, cashCollected })
      });
      setOrder(updated);
      setError('');
      if (status === 'out_for_delivery') startLocationSharing();
      if (status === 'delivered') stopLocationSharing();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  return (
    <DeliveryPage eyebrow="MEATHUB COURIER" title={order ? `Delivery #${order.id.slice(0, 8)}` : 'Courier delivery link'}>
      {error && !order && <p className="delivery-error" role="alert">{error}</p>}
      {!order && !error && <p className="delivery-loading">Loading delivery details…</p>}
      {order && (
        <>
          <div className="courier-destination">
            <MapPin size={18} />
            <span><small>DELIVER TO</small><b>{order.deliveryAddress}</b></span>
          </div>
          {(order.customerName || order.customerPhone) && (
            <div className="courier-contact">
              <CircleUserRound size={18} />
              <span><small>RECIPIENT</small><b>{order.customerName || 'MeatHub buyer'}</b></span>
              {order.customerPhone && (
                <a href={`tel:${order.customerPhone}`}><Phone size={15} /> {order.customerPhone}</a>
              )}
            </div>
          )}
          <DeliveryProgress status={order.status} />
          <DeliveryMapCard order={order} />
          {error && <p className="delivery-error" role="alert">{error}</p>}
          {gpsError && <p className="gps-message" role="status">{gpsError}</p>}
          <div className="courier-actions">
            {order.status === 'pending_seller' && (
              <p className="gps-message">Waiting for the seller to confirm this order before delivery can start.</p>
            )}
            {order.status === 'confirmed' && (
              <button className="primary-button checkout-button" onClick={() => advanceStatus('preparing')}>
                <PackageCheck size={16} /> Start preparing
              </button>
            )}
            {order.status === 'preparing' && (
              <button className="primary-button checkout-button" onClick={() => advanceStatus('out_for_delivery')}>
                <Truck size={16} /> Start delivery & share GPS
              </button>
            )}
            {order.status === 'out_for_delivery' && (
              <>
                <button className="outline-button" onClick={sharing ? stopLocationSharing : startLocationSharing}>
                  <LocateFixed size={16} /> {sharing ? 'Stop sharing location' : 'Share live location'}
                </button>
                <button className="primary-button checkout-button" onClick={() => advanceStatus('delivered', true)}>
                  <Check size={16} /> Delivered & COD cash collected
                </button>
                <small className="commission-note">Mark delivered only after handing over the order and collecting cash.</small>
              </>
            )}
            {order.status === 'delivered' && (
              <p className="delivery-success"><Check size={16} /> Delivered and cash payment recorded.</p>
            )}
            {order.status === 'cancelled' && <p className="delivery-error">This delivery was cancelled.</p>}
          </div>
        </>
      )}
    </DeliveryPage>
  );
}
