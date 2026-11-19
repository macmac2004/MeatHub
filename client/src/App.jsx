import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, Banknote, Bell, Beef, Check, CircleUserRound, Clock3,
  Heart, Leaf, LocateFixed, MapPin, MessageCircle, Minus, Plus, Search, ShieldCheck,
  ShoppingBag, SlidersHorizontal, Sparkles, Sprout, Truck, X
} from 'lucide-react';
import {
  onAuthStateChanged, signOut
} from '@firebase/auth';
import { auth, firebaseEnabled } from './firebase.js';
import { CourierPage, TrackingPage } from './DeliveryPages.jsx';
import { isPhilippinesLocation } from './delivery.js';
import {
  claimQueuedOrder, enqueueOrder, listQueuedOrders, migrateLegacyQueue, removeQueuedOrder
} from './orderQueue.js';
import LoginPage from './LoginPage.jsx';
import SignupPage from './SignupPage.jsx';
import { API_URL } from './apiUrl.js';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';
const DeliveryMap = lazy(() => import('./DeliveryMap.jsx'));
const categories = ['All cuts', 'Beef', 'Pork', 'Chicken', 'Lamb'];
const deliveryStatusLabels = {
  pending_seller: 'Waiting for seller',
  confirmed: 'Order confirmed',
  preparing: 'Preparing',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled'
};
const initialForm = {
  name: '', farm: '', category: 'Beef', price: '', unit: '500g',
  stock: '', location: '', description: '', image: ''
};
const maxProductImageBytes = 5 * 1024 * 1024;

async function uploadProductImage(file, user) {
  const headers = { 'Content-Type': file.type };
  if (firebaseEnabled) {
    headers.Authorization = `Bearer ${await user.getIdToken()}`;
  } else {
    headers['X-Demo-User-Id'] = user.uid;
    headers['X-Demo-User-Role'] = user.role || 'buyer';
  }
  const response = await fetch(`${API_URL}/api/uploads/product-image`, {
    method: 'POST',
    headers,
    body: file
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Photo upload failed (${response.status}).`);
  }
  return response.json();
}

async function request(path, options = {}, user = null) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (user && firebaseEnabled) {
    headers.Authorization = `Bearer ${await user.getIdToken()}`;
  } else if (user) {
    headers['X-Demo-User-Id'] = user.uid;
    headers['X-Demo-User-Role'] = user.role || 'buyer';
  }
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status}).`);
  }
  return response.status === 204 ? null : response.json();
}

function money(value) {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency', currency: 'PHP', maximumFractionDigits: 2
  }).format(value);
}

function localDateString(date = new Date()) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 10);
}

function isPermanentOrderFailure(status) {
  return status >= 400 && status < 500 && ![401, 403, 408, 429].includes(status);
}

function App() {
  if (window.location.pathname === '/login' || window.location.pathname === '/login/') {
    if (!firebaseEnabled) {
      try {
        const accounts = JSON.parse(localStorage.getItem('meathub-demo-accounts') || '[]');
        if (!Array.isArray(accounts) || accounts.length === 0) {
          window.location.replace('/signup');
          return null;
        }
      } catch {
        window.location.replace('/signup');
        return null;
      }
    }
    return <LoginPage />;
  }
  if (window.location.pathname === '/signup' || window.location.pathname === '/signup/') {
    return <SignupPage />;
  }
  const trackingMatch = window.location.pathname.match(/^\/track\/([A-Za-z0-9_-]+)\/?$/);
  if (trackingMatch) return <TrackingPage token={trackingMatch[1]} />;
  const courierMatch = window.location.pathname.match(/^\/courier\/([A-Za-z0-9_-]+)\/?$/);
  if (courierMatch) return <CourierPage token={courierMatch[1]} />;
  return <MarketApp />;
}

function MarketApp() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('All cuts');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState({});
  const [cartOpen, setCartOpen] = useState(false);
  const [listingOpen, setListingOpen] = useState(false);
  const [listingForm, setListingForm] = useState(initialForm);
  const [listingImageFile, setListingImageFile] = useState(null);
  const [listingImagePreview, setListingImagePreview] = useState('');
  const [editingProduct, setEditingProduct] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [chatText, setChatText] = useState('');
  const [user, setUser] = useState(() => {
    if (firebaseEnabled) return null;
    try {
      const currentUser = JSON.parse(localStorage.getItem('meathub-demo-user') || 'null');
      const accounts = JSON.parse(localStorage.getItem('meathub-demo-accounts') || '[]');
      return Array.isArray(accounts) && accounts.some((account) => account.uid === currentUser?.uid)
        ? { ...currentUser, role: ['buyer', 'seller', 'rider'].includes(currentUser.role) ? currentUser.role : 'buyer' }
        : null;
    } catch {
      return null;
    }
  });
  const [accountRole, setAccountRole] = useState(() => {
    if (firebaseEnabled) return null;
    try {
      const savedRole = JSON.parse(localStorage.getItem('meathub-demo-user') || 'null')?.role;
      return ['buyer', 'seller', 'rider'].includes(savedRole) ? savedRole : 'buyer';
    } catch {
      return 'buyer';
    }
  });
  const [accountRoleReady, setAccountRoleReady] = useState(!firebaseEnabled);
  const [accountRoleError, setAccountRoleError] = useState('');
  const [authReady, setAuthReady] = useState(!firebaseEnabled);
  const [notice, setNotice] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [apiPushReady, setApiPushReady] = useState(false);
  const [deliveryDate, setDeliveryDate] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryLocation, setDeliveryLocation] = useState(null);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [customerOrders, setCustomerOrders] = useState([]);
  const [sellerEarnings, setSellerEarnings] = useState([]);
  const [sellerEarningsLoading, setSellerEarningsLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPayouts, setAdminPayouts] = useState([]);
  const [adminPayoutsLoading, setAdminPayoutsLoading] = useState(false);
  const [riderOrders, setRiderOrders] = useState({ available: [], assigned: [] });
  const [riderOrdersLoading, setRiderOrdersLoading] = useState(false);
  const [sellerDecisionBusy, setSellerDecisionBusy] = useState({});
  const [payoutReferences, setPayoutReferences] = useState({});
  const [courierLinks, setCourierLinks] = useState({});
  const [orderConfirmation, setOrderConfirmation] = useState(null);
  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem('meathub-favorites') || '[]'); } catch { return []; }
  });
  const chatRef = useRef(null);
  const searchRef = useRef(null);
  const syncRef = useRef(null);

  useEffect(() => {
    if (!listingImageFile) {
      setListingImagePreview('');
      return undefined;
    }
    const preview = URL.createObjectURL(listingImageFile);
    setListingImagePreview(preview);
    return () => URL.revokeObjectURL(preview);
  }, [listingImageFile]);

  const announce = useCallback((message) => {
    setNotice(message);
    window.clearTimeout(announce.timer);
    announce.timer = window.setTimeout(() => setNotice(''), 3500);
  }, []);

  const loadProducts = useCallback(async () => {
    const sellerMode = accountRole === 'seller';
    const productPath = sellerMode ? '/api/products/mine' : '/api/products';
    const cacheKey = sellerMode ? `meathub-seller-products-${user?.uid}` : 'meathub-products';
    try {
      const data = await request(productPath, {}, user);
      setProducts(data);
      try {
        localStorage.setItem(cacheKey, JSON.stringify(data));
      } catch (error) {
        console.warn('Could not save an offline catalog copy:', error);
      }
    } catch (error) {
      try {
        const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
        if (Array.isArray(cached)) {
          setProducts(cached);
          announce(sellerMode
            ? 'Showing your saved listings. Changes need a connection to sync.'
            : 'Showing your saved market. Delivery orders will sync when you are online.');
        } else {
          announce(`Couldn't load ${sellerMode ? 'your listings' : 'products'}: ${error.message}`);
        }
      } catch (cacheError) {
        console.error('Could not read the saved offline catalog:', cacheError);
        announce(`Couldn't load ${sellerMode ? 'your listings' : 'products'}: ${error.message}`);
      }
    } finally {
      setLoading(false);
    }
  }, [accountRole, announce, user]);

  useEffect(() => {
    if (!firebaseEnabled) return undefined;
    return onAuthStateChanged(auth, (authenticatedUser) => {
      setUser(authenticatedUser);
      setAccountRole(authenticatedUser ? null : 'buyer');
      setIsAdmin(false);
      setAccountRoleReady(!authenticatedUser);
      setAccountRoleError('');
      setAuthReady(true);
    });
  }, []);

  useEffect(() => {
    if (!authReady || !user) return undefined;
    let cancelled = false;
    setAccountRoleReady(false);
    setAccountRoleError('');
    request('/api/profile', {}, user)
      .then(({ role, isAdmin: admin }) => {
        if (!['buyer', 'seller', 'rider'].includes(role)) throw new Error('Your account type is invalid.');
        if (!cancelled) {
          setAccountRole(role);
          setIsAdmin(admin === true);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setIsAdmin(false);
          setAccountRoleError(error.message);
        }
      })
      .finally(() => {
        if (!cancelled) setAccountRoleReady(true);
      });
    return () => { cancelled = true; };
  }, [authReady, user]);

  useEffect(() => {
    if (!user || !accountRoleReady || accountRole !== 'seller') {
      setSellerEarnings([]);
      return undefined;
    }
    let cancelled = false;
    setSellerEarningsLoading(true);
    const loadEarnings = () => request('/api/seller/earnings', {}, user)
      .then((earnings) => {
        if (!cancelled) setSellerEarnings(earnings);
      })
      .catch((error) => {
        if (!cancelled) announce(`Couldn't load your earnings: ${error.message}`);
      })
      .finally(() => {
        if (!cancelled) setSellerEarningsLoading(false);
      });
    loadEarnings();
    const interval = window.setInterval(loadEarnings, 10000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [accountRole, accountRoleReady, announce, user]);

  useEffect(() => {
    if (!user || !accountRoleReady || accountRole !== 'rider') {
      setRiderOrders({ available: [], assigned: [] });
      return undefined;
    }
    let cancelled = false;
    setRiderOrdersLoading(true);
    const loadRiderOrders = () => request('/api/rider/orders', {}, user)
      .then((deliveries) => {
        if (!cancelled) setRiderOrders(deliveries);
      })
      .catch((error) => {
        if (!cancelled) announce(`Couldn't load deliveries: ${error.message}`);
      })
      .finally(() => {
        if (!cancelled) setRiderOrdersLoading(false);
      });
    loadRiderOrders();
    const interval = window.setInterval(loadRiderOrders, 10000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [accountRole, accountRoleReady, announce, user]);

  useEffect(() => {
    if (!user || !accountRoleReady || !isAdmin) {
      setAdminPayouts([]);
      return undefined;
    }
    let cancelled = false;
    setAdminPayoutsLoading(true);
    request('/api/admin/payouts', {}, user)
      .then((payouts) => {
        if (!cancelled) setAdminPayouts(payouts);
      })
      .catch((error) => {
        if (!cancelled) announce(`Couldn't load seller payouts: ${error.message}`);
      })
      .finally(() => {
        if (!cancelled) setAdminPayoutsLoading(false);
      });
    return () => { cancelled = true; };
  }, [accountRoleReady, announce, isAdmin, user]);

  useEffect(() => {
    if (!authReady || !user || !accountRoleReady || accountRoleError) return;
    loadProducts();
    request('/api/health').then((health) => setApiPushReady(health.pushEnabled)).catch(() => {});
  }, [accountRole, accountRoleError, accountRoleReady, authReady, loadProducts, user]);

  useEffect(() => {
    if (!['buyer', 'seller'].includes(accountRole) || !('Notification' in window) || Notification.permission !== 'granted') return undefined;
    setPushEnabled(true);
    if (!apiPushReady || !VAPID_PUBLIC_KEY || !('serviceWorker' in navigator)) return undefined;
    if (firebaseEnabled && !user) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        if (!existing || cancelled) return;
        await request('/api/push/subscribe', {
          method: 'POST', body: JSON.stringify(existing)
        }, user);
      } catch (error) {
        console.warn('Could not refresh the push subscription:', error);
      }
    })();
    return () => { cancelled = true; };
  }, [accountRole, apiPushReady, user]);

  useEffect(() => {
    if (!authReady || user) return;
    let destination = '/login';
    if (!firebaseEnabled) {
      try {
        const accounts = JSON.parse(localStorage.getItem('meathub-demo-accounts') || '[]');
        destination = Array.isArray(accounts) && accounts.length ? '/login' : '/signup';
      } catch {
        destination = '/signup';
      }
    }
    if (window.location.pathname !== destination) window.location.replace(destination);
  }, [authReady, user]);

  useEffect(() => {
    localStorage.setItem('meathub-favorites', JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    if (user?.displayName) setCustomerName((current) => current || user.displayName);
  }, [user]);

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      if (user) {
        if (accountRole === 'buyer') syncQueuedOrders();
        loadProducts();
      }
    };
    const handleOffline = () => setOnline(false);
    const handleServiceWorkerMessage = (event) => {
      if (event.data?.type === 'SYNC_MEATHUB_RESERVATIONS' &&
          navigator.onLine && accountRole === 'buyer') syncQueuedOrders();
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    navigator.serviceWorker?.addEventListener('message', handleServiceWorkerMessage);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      navigator.serviceWorker?.removeEventListener('message', handleServiceWorkerMessage);
    };
  }, [accountRole, loadProducts, user]);

  useEffect(() => {
    if (online && user && accountRole === 'buyer') syncQueuedOrders();
  }, [accountRole, online, user]);

  async function syncQueuedOrders() {
    if (syncRef.current) return syncRef.current;
    const run = (async () => {
      try {
        const demoIdentity = !firebaseEnabled && user
          ? { uid: user.uid, role: user.role || 'buyer' }
          : null;
        await migrateLegacyQueue(API_URL, demoIdentity);
      } catch (error) {
        console.warn('Could not move the old offline queue into IndexedDB:', error);
      }
      let queued;
      try {
        queued = await listQueuedOrders();
      } catch (error) {
        announce(`Could not read the offline order queue: ${error.message}`);
        return;
      }
      if (!queued.length) return;
      const freshToken = user && firebaseEnabled ? await user.getIdToken().catch(() => null) : null;
      let synced = 0;
      for (const record of queued) {
        if (!(await claimQueuedOrder(record.id).catch(() => false))) continue;
        const token = freshToken || record.token;
        const demoIdentity = record.demoIdentity || (!firebaseEnabled && user
          ? { uid: user.uid, role: user.role || 'buyer' }
          : null);
        try {
          const response = await fetch(`${record.apiUrl ?? API_URL}/api/orders`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              ...(demoIdentity ? {
                'X-Demo-User-Id': demoIdentity.uid,
                'X-Demo-User-Role': demoIdentity.role
              } : {})
            },
            body: JSON.stringify(record.order)
          });
          if (response.ok) {
            await removeQueuedOrder(record.id);
            synced += 1;
            continue;
          }
          const body = await response.json().catch(() => ({}));
          if (isPermanentOrderFailure(response.status)) {
            await removeQueuedOrder(record.id);
            announce(`An offline delivery could not be placed: ${body.error || `Request failed (${response.status}).`}`);
            continue;
          }
          throw new Error(body.error || `Request failed (${response.status}).`);
        } catch (error) {
          console.warn('An offline delivery is still waiting to sync:', error);
        }
      }
      if (synced) {
        announce(synced === 1
          ? 'Your offline delivery has synced. Open My deliveries for its links.'
          : `${synced} offline deliveries have synced. Open My deliveries for their links.`);
        loadProducts();
      }
    })();
    syncRef.current = run;
    try {
      return await run;
    } finally {
      syncRef.current = null;
    }
  }

  useEffect(() => {
    if (!chatOpen || accountRole !== 'buyer') return undefined;
    let cancelled = false;
    let socket;
    (async () => {
      try {
        const apiBase = API_URL || `${window.location.protocol}//${window.location.hostname}:4000`;
        const socketUrl = new URL('/ws', apiBase);
        socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
        if (firebaseEnabled && user) {
          socketUrl.searchParams.set('token', await user.getIdToken());
        }
        if (cancelled) return;
        socket = new WebSocket(socketUrl);
        chatRef.current = socket;
        socket.addEventListener('open', () => {
          setMessages((current) => [...current, {
            id: `joined-${Date.now()}`, type: 'system', text: 'Connected to the MeatHub community.'
          }]);
        });
        socket.addEventListener('message', (event) => {
          try {
            const message = JSON.parse(event.data);
            setMessages((current) => [...current, message].slice(-50));
          } catch (error) {
            console.error('Could not read chat message:', error);
          }
        });
        socket.addEventListener('close', (event) => {
          if (event.code === 4401) announce(event.reason || 'Sign in again to use chat.');
          else if (!cancelled) announce('Chat disconnected.');
        });
        socket.addEventListener('error', () => announce('Chat is unavailable right now.'));
      } catch (error) {
        announce(`Chat is unavailable: ${error.message}`);
      }
    })();
    return () => {
      cancelled = true;
      socket?.close();
      chatRef.current = null;
    };
  }, [accountRole, chatOpen, announce, user]);

  const filteredProducts = useMemo(() => products.filter((product) => {
    const matchesCategory = activeCategory === 'All cuts' || product.category === activeCategory;
    const query = search.trim().toLowerCase();
    const matchesSearch = !query ||
      `${product.name} ${product.farm} ${product.location} ${product.category}`.toLowerCase().includes(query);
    return matchesCategory && matchesSearch;
  }), [activeCategory, products, search]);

  const cartItems = useMemo(() => Object.entries(cart)
    .map(([id, quantity]) => {
      const product = products.find((item) => item.id === id);
      return product ? { product, quantity } : null;
    })
    .filter(Boolean), [cart, products]);
  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cartItems.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  const featuredProducts = products.filter((product) => product.featured).slice(0, 3);
  const sellerOwnerUid = user?.uid;
  const sellerProducts = useMemo(
    () => products.filter((product) => product.ownerUid === sellerOwnerUid),
    [products, sellerOwnerUid]
  );
  const sellerStock = sellerProducts.reduce((total, product) => total + product.stock, 0);
  const lowStockListings = sellerProducts.filter((product) => product.stock <= 5).length;
  const awaitingCash = sellerEarnings
    .filter((order) => order.paymentStatus !== 'paid' && order.status !== 'cancelled')
    .reduce((total, order) => total + order.sellerNet, 0);
  const readyForPayout = sellerEarnings
    .filter((order) => order.paymentStatus === 'paid' && order.payoutStatus !== 'paid')
    .reduce((total, order) => total + order.sellerNet, 0);
  const paidOut = sellerEarnings
    .filter((order) => order.payoutStatus === 'paid')
    .reduce((total, order) => total + order.sellerNet, 0);
  const pendingSellerOrders = sellerEarnings
    .filter((order) => order.status === 'pending_seller' && order.sellerConfirmation === 'pending');

  async function loadOrders() {
    setOrdersLoading(true);
    try {
      setCustomerOrders(await request('/api/orders', {}, user));
    } catch (error) {
      announce(`Couldn't load deliveries: ${error.message}`);
    } finally {
      setOrdersLoading(false);
    }
  }

  useEffect(() => {
    if (!ordersOpen || accountRole !== 'buyer' || !user) return undefined;
    let cancelled = false;
    const refreshRiderLocation = async () => {
      try {
        const orders = await request('/api/orders', {}, user);
        if (!cancelled) setCustomerOrders(orders);
      } catch {
        // Keep the last known rider location when a background refresh fails.
      }
    };
    const interval = window.setInterval(refreshRiderLocation, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [accountRole, ordersOpen, user]);

  async function decideSellerOrder(order, decision) {
    setSellerDecisionBusy((current) => ({ ...current, [order.id]: true }));
    try {
      await request(`/api/seller/orders/${order.id}/${decision}`, { method: 'POST' }, user);
      const earnings = await request('/api/seller/earnings', {}, user);
      setSellerEarnings(earnings);
      announce(decision === 'confirm'
        ? 'Order confirmed. The buyer and rider can proceed.'
        : 'Order declined. Stock was released and the buyer was notified.');
    } catch (error) {
      announce(`Couldn't update this order: ${error.message}`);
    } finally {
      setSellerDecisionBusy((current) => {
        const next = { ...current };
        delete next[order.id];
        return next;
      });
    }
  }

  async function claimRiderOrder(order) {
    try {
      const { courierToken } = await request(`/api/rider/orders/${order.id}/claim`, { method: 'POST' }, user);
      announce('Delivery claimed. Opening your rider page.');
      window.location.assign(`/courier/${courierToken}`);
    } catch (error) {
      announce(`Couldn't claim this delivery: ${error.message}`);
    }
  }

  async function recordPayout(payout) {
    const key = `${payout.orderId}:${payout.sellerUid}`;
    const reference = payoutReferences[key]?.trim();
    if (!reference) {
      announce('Enter the transfer reference after sending the seller payment.');
      return;
    }
    try {
      await request(`/api/admin/payouts/${payout.orderId}`, {
        method: 'POST',
        body: JSON.stringify({ sellerUid: payout.sellerUid, reference })
      }, user);
      const updatedPayouts = await request('/api/admin/payouts', {}, user);
      setAdminPayouts(updatedPayouts);
      announce('Payout record saved. Only record a payout after the funds have been sent.');
    } catch (error) {
      announce(`Couldn't record seller payout: ${error.message}`);
    }
  }

  function openOrders() {
    if (firebaseEnabled && !user) {
      announce('Sign in to view your deliveries.');
      return;
    }
    setOrdersOpen(true);
    loadOrders();
  }

  async function createCourierLink(order) {
    try {
      const { courierToken } = await request(`/api/orders/${order.id}/courier-link`, { method: 'POST' }, user);
      const link = `${window.location.origin}/courier/${courierToken}`;
      setCourierLinks((current) => ({ ...current, [order.id]: link }));
      try {
        await navigator.clipboard.writeText(link);
        announce('A new secure courier link was copied. The previous courier link is now invalid.');
      } catch {
        announce('A new secure courier link is shown below. The previous courier link is now invalid.');
      }
    } catch (error) {
      announce(`Couldn't create a courier link: ${error.message}`);
    }
  }

  function startEditListing(product) {
    setEditingProduct(product);
    setListingImageFile(null);
    setListingForm({
      name: product.name,
      farm: product.farm,
      category: product.category,
      price: String(product.price),
      unit: product.unit,
      stock: String(product.stock),
      location: product.location,
      description: product.description,
      image: product.image
    });
    setListingOpen(true);
  }

  function closeListingForm() {
    setListingOpen(false);
    setEditingProduct(null);
    setListingForm(initialForm);
    setListingImageFile(null);
  }

  function addToCart(product) {
    setCart((current) => ({
      ...current,
      [product.id]: Math.min((current[product.id] || 0) + 1, product.stock)
    }));
    announce(`${product.name} added to your bag.`);
  }

  function changeQuantity(id, amount) {
    setCart((current) => {
      const quantity = (current[id] || 0) + amount;
      if (quantity <= 0) {
        const next = { ...current };
        delete next[id];
        return next;
      }
      const product = products.find((item) => item.id === id);
      return { ...current, [id]: Math.min(quantity, product?.stock || quantity) };
    });
  }

  async function placeDeliveryOrder(event) {
    event.preventDefault();
    if (!isPhilippinesLocation(deliveryLocation)) {
      announce('Choose a delivery pin within the Philippines map area.');
      return;
    }
    const order = {
      items: cartItems.map(({ product, quantity }) => ({ productId: product.id, quantity })),
      deliveryDate,
      deliveryAddress,
      deliveryLocation,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      paymentMethod: 'cod'
    };
    if (!online) {
      try {
        const token = user && firebaseEnabled ? await user.getIdToken().catch(() => null) : null;
        const demoIdentity = !firebaseEnabled && user
          ? { uid: user.uid, role: user.role || 'buyer' }
          : null;
        await enqueueOrder({ order, apiUrl: API_URL, token, demoIdentity });
      } catch (error) {
        announce(`Could not save this delivery on your device: ${error.message}`);
        return;
      }
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then((registration) => registration.sync?.register('meathub-reservations'))
          .catch((error) => console.warn('Background reservation sync is unavailable:', error));
      }
      setCart({});
      setCartOpen(false);
      announce('Saved on this device. Your COD delivery will sync when you are back online.');
      return;
    }
    try {
      const saved = await request('/api/orders', { method: 'POST', body: JSON.stringify(order) }, user);
      setCart({});
      setCartOpen(false);
      setDeliveryDate('');
      setDeliveryAddress('');
      setDeliveryLocation(null);
      setOrderConfirmation(saved);
      await loadProducts();
      if (pushEnabled && 'Notification' in window) {
        new Notification('COD delivery placed', { body: 'Waiting for the seller to confirm your order.' });
      }
    } catch (error) {
      announce(error.message);
    }
  }

  async function submitListing(event) {
    event.preventDefault();
    try {
      const uploadedImage = listingImageFile
        ? await uploadProductImage(listingImageFile, user)
        : null;
      const body = {
        ...listingForm,
        price: Number(listingForm.price),
        stock: Number(listingForm.stock),
        image: uploadedImage?.image || listingForm.image ||
          'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?auto=format&fit=crop&w=1000&q=85'
      };
      await request(editingProduct ? `/api/products/${editingProduct.id}` : '/api/products', {
        method: editingProduct ? 'PATCH' : 'POST',
        body: JSON.stringify(body)
      }, user);
      setListingForm(initialForm);
      setListingImageFile(null);
      setEditingProduct(null);
      setListingOpen(false);
      announce(editingProduct ? 'Your listing has been updated.' : 'Your listing is live.');
      await loadProducts();
    } catch (error) {
      announce(error.message);
    }
  }

  async function archiveListing(product) {
    try {
      await request(`/api/products/${product.id}/archive`, { method: 'POST' }, user);
      announce(`${product.name} archived.`);
      await loadProducts();
    } catch (error) {
      announce(error.message);
    }
  }

  async function handleSignIn() {
    try {
      if (user) {
        if (firebaseEnabled) await signOut(auth);
        else localStorage.removeItem('meathub-demo-user');
        setUser(null);
        setIsAdmin(false);
        announce('You are signed out.');
      } else {
        window.location.assign('/login');
      }
    } catch (error) {
      announce(`Sign in failed: ${error.message}`);
    }
  }

  async function enableNotifications() {
    if (!('Notification' in window)) {
      announce('This browser does not support notifications.');
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      announce('Notifications were not enabled.');
      return;
    }
    setPushEnabled(true);
    if (!apiPushReady || !VAPID_PUBLIC_KEY) {
      announce('On-device notifications are on. Push while the app is closed needs VAPID keys on the server and VITE_VAPID_PUBLIC_KEY in the client.');
      return;
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      announce('This browser can show notifications but does not support background push.');
      return;
    }
    if (firebaseEnabled && !user) {
      announce('Sign in first so push updates are linked to your MeatHub account.');
      return;
    }
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription()
        || await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeBase64Key(VAPID_PUBLIC_KEY)
        });
      await request('/api/push/subscribe', {
        method: 'POST', body: JSON.stringify(subscription)
      }, user);
      announce('Push notifications are enabled.');
    } catch (error) {
      announce(`Could not enable push notifications: ${error.message}`);
    }
  }

  function sendChat(event) {
    event.preventDefault();
    const text = chatText.trim();
    if (!text || !chatRef.current || chatRef.current.readyState !== WebSocket.OPEN) {
      announce('Wait for chat to connect before sending a message.');
      return;
    }
    chatRef.current.send(JSON.stringify({
      name: user?.displayName || 'MeatHub member',
      text
    }));
    setChatText('');
  }

  if (!authReady || !user || !accountRoleReady) {
    return (
      <main className="auth-gate" aria-live="polite">
        <span className="brand-mark"><Beef size={22} strokeWidth={1.8} /></span>
        <p>Checking your MeatHub account…</p>
      </main>
    );
  }
  if (accountRoleError) {
    return (
      <main className="auth-gate" role="alert">
        <span className="brand-mark"><Beef size={22} strokeWidth={1.8} /></span>
        <p>Could not load your account type: {accountRoleError}</p>
        <button className="primary-button" onClick={() => window.location.reload()}>Try again</button>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <div className="announcement">
        <Sprout size={14} /> GOOD FOOD STARTS CLOSE TO HOME <span className="announcement-dot">•</span>
        <span>Meet the people behind your meat</span>
      </div>
      <header className="site-header">
        <a className="brand" href="#" aria-label="MeatHub home">
          <span className="brand-mark"><Beef size={22} strokeWidth={1.8} /></span>
          <span>meat<span>hub</span><small>LOCAL • FRESH • FAIR</small></span>
        </a>
        <nav className="desktop-nav" aria-label="Main navigation">
          {isAdmin ? (
            <a className="nav-active" href="#admin-payouts">Seller payouts</a>
          ) : accountRole === 'seller' ? (
            <a className="nav-active" href="#seller-dashboard">Seller dashboard</a>
          ) : accountRole === 'rider' ? (
            <a className="nav-active" href="#rider-dashboard">Rider dashboard</a>
          ) : (
            <>
              <a className="nav-active" href="#shop">Shop meat</a>
              <a href="#farmers">Our farmers</a>
              <a href="#story">Our story</a>
            </>
          )}
        </nav>
        <div className="header-actions">
          {['buyer', 'seller'].includes(accountRole) && (
            <button className="icon-button notification-button" aria-label={pushEnabled ? 'Notifications enabled' : 'Enable notifications'} onClick={enableNotifications}>
              <Bell size={19} />
            </button>
          )}
          {accountRole === 'buyer' && (
            <>
              <button className="orders-button" onClick={openOrders}>
                <MapPin size={16} /><span>My deliveries</span>
              </button>
            </>
          )}
          {user ? (
            <button className="signin-button" onClick={handleSignIn}>
              <CircleUserRound size={17} /> Sign out
            </button>
          ) : (
            <>
              <button className="signin-button" onClick={() => window.location.assign('/login')}>
                <CircleUserRound size={17} /> Sign in
              </button>
              <button className="signup-button" onClick={() => window.location.assign('/signup')}>
                Sign up
              </button>
            </>
          )}
          {accountRole === 'buyer' && (
            <button className="bag-button" onClick={() => setCartOpen(true)} aria-label={`Open bag, ${cartCount} items`}>
              <ShoppingBag size={18} /><span>My bag</span><b>{cartCount}</b>
            </button>
          )}
        </div>
      </header>

      <main>
        {isAdmin ? (
          <section className="seller-dashboard" id="admin-payouts" aria-labelledby="admin-payouts-title">
            <div className="seller-dashboard-heading">
              <div>
                <div className="eyebrow section-eyebrow">MEATHUB OPERATIONS</div>
                <h1 id="admin-payouts-title">Seller payouts</h1>
                <p>Record a manual payout only after you have sent the seller their funds.</p>
              </div>
            </div>
            {adminPayoutsLoading ? (
              <div className="seller-empty">Loading eligible payouts…</div>
            ) : adminPayouts.length === 0 ? (
              <div className="seller-empty">
                <b>No completed COD orders</b>
                <span>Paid orders will appear here after the courier confirms cash collection.</span>
              </div>
            ) : (
              <div className="earnings-list">
                {adminPayouts.map((payout) => {
                  const key = `${payout.orderId}:${payout.sellerUid}`;
                  return (
                    <article className="earnings-card admin-payout-card" key={key}>
                      <div className="earnings-card-heading">
                        <b>Order #{payout.orderId.slice(0, 8)}</b>
                        <span className={`payout-status ${payout.payoutStatus === 'paid' ? 'payout-complete' : ''}`}>
                          {payout.payoutStatus === 'paid' ? 'Payout recorded' : 'Ready for payout'}
                        </span>
                      </div>
                      <p className="payout-seller-id">Seller account: {payout.sellerUid}</p>
                      <p className="earnings-items">
                        {payout.items.map((item) => `${item.name} × ${item.quantity}`).join(' · ')}
                      </p>
                      <div className="earnings-breakdown">
                        <span>Order share <b>{money(payout.grossAmount)}</b></span>
                        <span>Platform fee <b>−{money(payout.commissionAmount)}</b></span>
                        <span>Seller net <b>{money(payout.sellerNet)}</b></span>
                      </div>
                      {payout.payoutStatus === 'paid' ? (
                        <small className="payout-reference">
                          Sent {new Date(payout.payoutAt).toLocaleDateString()} · Ref: {payout.payoutReference}
                        </small>
                      ) : (
                        <form className="payout-record-form" onSubmit={(event) => {
                          event.preventDefault();
                          recordPayout(payout);
                        }}>
                          <label>
                            Transfer reference
                            <input
                              required
                              maxLength="120"
                              value={payoutReferences[key] || ''}
                              onChange={(event) => setPayoutReferences((current) => ({
                                ...current,
                                [key]: event.target.value
                              }))}
                              placeholder="Bank/e-wallet transaction ID"
                            />
                          </label>
                          <button className="outline-button" type="submit"><Banknote size={15} /> Record sent payout</button>
                        </form>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        ) : accountRole === 'seller' ? (
          <section className="seller-dashboard" id="seller-dashboard" aria-labelledby="seller-dashboard-title">
            <div className="seller-dashboard-heading">
              <div>
                <div className="eyebrow section-eyebrow">YOUR MEATHUB STORE</div>
                <h1 id="seller-dashboard-title">Seller dashboard</h1>
                <p>Manage your meat listings and keep your stock up to date.</p>
              </div>
              <button className="primary-button" onClick={() => {
                setEditingProduct(null);
                setListingForm(initialForm);
                setListingImageFile(null);
                setListingOpen(true);
              }}>
                <Plus size={16} /> Add meat listing
              </button>
            </div>
            <div className="seller-summary">
              <div><small>Active listings</small><b>{sellerProducts.length}</b></div>
              <div><small>Units in stock</small><b>{sellerStock}</b></div>
              <div><small>Low stock (5 or less)</small><b>{lowStockListings}</b></div>
            </div>
            <div className="seller-listing-heading">
              <h2>Orders to confirm</h2>
            </div>
            {pendingSellerOrders.length === 0 ? (
              <div className="seller-empty">
                <b>No orders waiting</b>
                <span>New COD orders for your listings will appear here for confirmation.</span>
              </div>
            ) : (
              <div className="earnings-list">
                {pendingSellerOrders.map((order) => (
                  <article className="earnings-card seller-order-card" key={order.id}>
                    <div className="earnings-card-heading">
                      <b>Order #{order.id.slice(0, 8)}</b>
                      <span className="order-status-pill status-pending_seller">Needs confirmation</span>
                    </div>
                    <p className="earnings-items">
                      {order.items.map((item) => `${item.name} × ${item.quantity}`).join(' · ')}
                    </p>
                    <div className="seller-order-meta">
                      <span><Clock3 size={14} /> Deliver {new Date(`${order.deliveryDate}T00:00:00`).toLocaleDateString()}</span>
                      <span><MapPin size={14} /> {order.deliveryAddress}</span>
                      {(order.customerName || order.customerPhone) && (
                        <span><CircleUserRound size={14} /> {order.customerName}{order.customerPhone ? ` · ${order.customerPhone}` : ''}</span>
                      )}
                    </div>
                    <div className="earnings-breakdown">
                      <span>Order share <b>{money(order.grossAmount)}</b></span>
                      <span>Your net <b>{money(order.sellerNet)}</b></span>
                    </div>
                    <div className="seller-order-actions">
                      <button className="primary-button" disabled={sellerDecisionBusy[order.id]} onClick={() => decideSellerOrder(order, 'confirm')}>
                        <Check size={15} /> Confirm order
                      </button>
                      <button className="outline-button" disabled={sellerDecisionBusy[order.id]} onClick={() => decideSellerOrder(order, 'decline')}>
                        Decline
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
            <div className="seller-listing-heading">
              <h2>Your earnings</h2>
            </div>
            <div className="seller-summary earnings-summary">
              <div><small>Awaiting delivery and cash</small><b>{money(awaitingCash)}</b></div>
              <div><small>Ready for manual payout</small><b>{money(readyForPayout)}</b></div>
              <div><small>Already paid out</small><b>{money(paidOut)}</b></div>
            </div>
            {sellerEarningsLoading ? (
              <div className="seller-empty">Loading your earnings…</div>
            ) : sellerEarnings.length === 0 ? (
              <div className="seller-empty">
                <b>No orders yet</b>
                <span>Orders for your listings will appear here. Earnings are confirmed after COD collection.</span>
              </div>
            ) : (
              <div className="earnings-list">
                {sellerEarnings.map((order) => (
                  <article className="earnings-card" key={order.id}>
                    <div className="earnings-card-heading">
                      <b>Order #{order.id.slice(0, 8)}</b>
                      <span className={`order-status-pill status-${order.status}`}>
                        {order.paymentStatus === 'paid' ? 'COD collected' : order.status === 'cancelled' ? 'Cancelled' : 'Awaiting cash'}
                      </span>
                    </div>
                    <p className="earnings-items">
                      {order.items.map((item) => `${item.name} × ${item.quantity}`).join(' · ')}
                    </p>
                    <div className="earnings-breakdown">
                      <span>Order share <b>{money(order.grossAmount)}</b></span>
                      <span>Platform fee <b>−{money(order.commissionAmount)}</b></span>
                      <span>Your net <b>{money(order.sellerNet)}</b></span>
                    </div>
                    <small className="payout-reference">
                      {order.payoutStatus === 'paid'
                        ? `Payout recorded ${new Date(order.payoutAt).toLocaleDateString()} · Ref: ${order.payoutReference}`
                        : order.paymentStatus === 'paid'
                          ? 'COD collected · waiting for manual seller payout'
                          : 'Net amount is an estimate until the courier collects COD'}
                    </small>
                  </article>
                ))}
              </div>
            )}
            <div className="seller-listing-heading">
              <h2>Your listings</h2>
            </div>
            {loading ? (
              <div className="seller-empty">Loading your listings…</div>
            ) : sellerProducts.length === 0 ? (
              <div className="seller-empty">
                <b>No listings yet</b>
                <span>Add your first meat product to start selling on MeatHub.</span>
              </div>
            ) : (
              <div className="seller-listings">
                {sellerProducts.map((product) => (
                  <article className="seller-listing" key={product.id}>
                    <img src={product.image} alt="" />
                    <div className="seller-listing-info">
                      <b>{product.name}</b>
                      <span>{product.category} · {product.location}</span>
                      <strong>{money(product.price)} / {product.unit}</strong>
                    </div>
                    <div className="seller-listing-stock">
                      <small>Stock</small>
                      <b>{product.stock}</b>
                    </div>
                    <div className="seller-listing-actions">
                      <button onClick={() => startEditListing(product)}>Edit</button>
                      <button onClick={() => archiveListing(product)}>Archive</button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : accountRole === 'rider' ? (
          <section className="seller-dashboard" id="rider-dashboard" aria-labelledby="rider-dashboard-title">
            <div className="seller-dashboard-heading">
              <div>
                <div className="eyebrow section-eyebrow">MEATHUB DELIVERIES</div>
                <h1 id="rider-dashboard-title">Rider dashboard</h1>
                <p>Claim a delivery, then open its rider page to share GPS and update the status.</p>
              </div>
            </div>
            <div className="seller-summary">
              <div><small>Available deliveries</small><b>{riderOrders.available.length}</b></div>
              <div><small>Your active deliveries</small><b>{riderOrders.assigned.length}</b></div>
              <div><small>COD to collect</small><b>{money(riderOrders.assigned.reduce((sum, order) => sum + Number(order.total || 0), 0))}</b></div>
            </div>
            <div className="seller-listing-heading">
              <h2>Available deliveries</h2>
            </div>
            {riderOrdersLoading ? (
              <div className="seller-empty">Loading deliveries…</div>
            ) : riderOrders.available.length === 0 ? (
              <div className="seller-empty">
                <b>No unassigned deliveries</b>
                <span>Confirmed COD orders will appear here for any rider to claim.</span>
              </div>
            ) : (
              <div className="earnings-list">
                {riderOrders.available.map((order) => (
                  <article className="earnings-card rider-order-card" key={order.id}>
                    <div className="earnings-card-heading">
                      <b>Delivery #{order.id.slice(0, 8)}</b>
                      <span className={`order-status-pill status-${order.status}`}>{deliveryStatusLabels[order.status] || order.status}</span>
                    </div>
                    <p className="earnings-items">{order.items.map((item) => `${item.name} × ${item.quantity}`).join(' · ')}</p>
                    <div className="seller-order-meta">
                      <span><MapPin size={14} /> {order.deliveryAddress}</span>
                      <span><Clock3 size={14} /> {new Date(`${order.deliveryDate}T00:00:00`).toLocaleDateString()} · COD {money(order.total)}</span>
                      {(order.customerName || order.customerPhone) && (
                        <span><CircleUserRound size={14} /> {order.customerName}{order.customerPhone ? ` · ${order.customerPhone}` : ''}</span>
                      )}
                    </div>
                    <button className="primary-button" onClick={() => claimRiderOrder(order)}>
                      <Truck size={15} /> Accept delivery
                    </button>
                  </article>
                ))}
              </div>
            )}
            <div className="seller-listing-heading">
              <h2>Your active deliveries</h2>
            </div>
            {riderOrders.assigned.length === 0 ? (
              <div className="seller-empty">
                <b>No claimed deliveries</b>
                <span>Deliveries you accept will stay here until they are completed.</span>
              </div>
            ) : (
              <div className="earnings-list">
                {riderOrders.assigned.map((order) => (
                  <article className="earnings-card rider-order-card" key={order.id}>
                    <div className="earnings-card-heading">
                      <b>Delivery #{order.id.slice(0, 8)}</b>
                      <span className={`order-status-pill status-${order.status}`}>{deliveryStatusLabels[order.status] || order.status}</span>
                    </div>
                    <p className="earnings-items">{order.items.map((item) => `${item.name} × ${item.quantity}`).join(' · ')}</p>
                    <div className="seller-order-meta">
                      <span><MapPin size={14} /> {order.deliveryAddress}</span>
                      <span><Clock3 size={14} /> {new Date(`${order.deliveryDate}T00:00:00`).toLocaleDateString()} · COD {money(order.total)}</span>
                      {(order.customerName || order.customerPhone) && (
                        <span><CircleUserRound size={14} /> {order.customerName}{order.customerPhone ? ` · ${order.customerPhone}` : ''}</span>
                      )}
                    </div>
                    <a className="outline-button" href={`/courier/${order.courierToken}`}>
                      <LocateFixed size={15} /> Open rider page
                    </a>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : (
          <>
        <section className="hero" id="story">
          <div className="hero-image" />
          <div className="hero-content">
            <div className="eyebrow"><span /> GOOD MEAT, GOOD PEOPLE</div>
            <h1>From local farms<br />to your <em>table.</em></h1>
            <p>Thoughtfully raised. Locally sourced. Delivered with a little more care.</p>
            <a className="primary-button hero-cta" href="#shop">Shop the market <ArrowRight size={17} /></a>
            <div className="hero-proof">
              <span><Leaf size={15} /> 100% locally sourced</span><i />
              <span><ShieldCheck size={15} /> Know your farmer</span>
            </div>
          </div>
          <div className="hero-note"><span>01 / 04</span><div /><span>THE LOCAL TABLE</span></div>
        </section>

        <section className="trust-strip" aria-label="Marketplace benefits">
          <div><Sprout /><span><b>Raised with care</b><small>By farms you can know</small></span></div>
          <div><MapPin /><span><b>Closer to home</b><small>Supporting local growers</small></span></div>
          <div><Truck /><span><b>Delivery, your way</b><small>Choose a day that works</small></span></div>
          <div><Heart /><span><b>Better by nature</b><small>Quality over quantity</small></span></div>
        </section>

        <section className="market-section" id="shop">
          <div className="section-heading">
            <div>
              <div className="eyebrow section-eyebrow">THE MEATHUB MARKET</div>
              <h2>Good things, <em>from nearby.</em></h2>
              <p>Small-batch cuts from the farms just down the road.</p>
            </div>
          </div>

          <div className="market-toolbar">
            <div className="category-tabs" role="tablist" aria-label="Product categories">
              {categories.map((category) => (
                <button key={category} role="tab" aria-selected={activeCategory === category}
                  className={activeCategory === category ? 'category-tab selected' : 'category-tab'}
                  onClick={() => setActiveCategory(category)}>
                  {category}
                </button>
              ))}
            </div>
            <label className="search-box">
              <Search size={17} />
              <input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search cuts or farms" />
              <SlidersHorizontal size={16} className="search-filter-icon" />
            </label>
          </div>

          <div className="product-grid">
            {loading && <div className="empty-state">Gathering the good stuff…</div>}
            {!loading && filteredProducts.map((product) => (
              <ProductCard key={product.id} product={product}
                favorite={favorites.includes(product.id)}
                onFavorite={() => setFavorites((current) => current.includes(product.id)
                  ? current.filter((id) => id !== product.id) : [...current, product.id])}
                onAdd={() => addToCart(product)} />
            ))}
            {!loading && filteredProducts.length === 0 && (
              <div className="empty-state">No cuts found just yet. Try another search or category.</div>
            )}
          </div>
          <div className="market-footer">
            <span>Showing {filteredProducts.length} of {products.length} local cuts</span>
            <button className="text-button" onClick={() => { setActiveCategory('All cuts'); setSearch(''); }}>
              View all cuts <ArrowRight size={15} />
            </button>
          </div>
        </section>

        <section className="farmer-banner" id="farmers">
          <div className="farmer-photo">
            <img src="https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=85" alt="Golden morning light over a local farm" />
            <span className="photo-caption"><Sprout size={13} /> GREEN PASTURES FARM · SILANG, CAVITE</span>
          </div>
          <div className="farmer-copy">
            <div className="eyebrow">A LITTLE CLOSER TO THE SOURCE</div>
            <h2>Know where it<br />comes <em>from.</em></h2>
            <p>Every cut has a story. Meet the independent farmers who raise with intention, care for their land, and bring something good to your table.</p>
            <a href="#shop" className="text-button">Meet our farmers <ArrowRight size={15} /></a>
            <div className="farmer-quote">“Good food has a way of bringing us back to what matters.”<small>— A note from the farm</small></div>
          </div>
        </section>

        <section className="featured-section">
          <div className="featured-top">
            <div>
              <div className="eyebrow section-eyebrow">THE FARMER'S PICKS</div>
              <h2>Worth saving <em>room for.</em></h2>
            </div>
            <a href="#shop" className="text-button">Browse all <ArrowRight size={15} /></a>
          </div>
          <div className="featured-row">
            {featuredProducts.length ? featuredProducts.map((product) => (
              <button className="featured-item" key={product.id} onClick={() => addToCart(product)}>
                <img src={product.image} alt="" />
                <span><small>{product.farm}</small><b>{product.name}</b></span>
                <span className="featured-price">{money(product.price)} <small>/ {product.unit}</small></span>
              </button>
            )) : <p className="muted-copy">Fresh farmer picks are on the way.</p>}
          </div>
        </section>
          </>
        )}
      </main>

      <footer className="site-footer">
        <a className="brand footer-brand" href="#"><span className="brand-mark"><Beef size={21} /></span><span>meat<span>hub</span><small>LOCAL • FRESH • FAIR</small></span></a>
        <span>Better meat. Better neighbors. © 2025 MeatHub</span>
        {accountRole === 'buyer' && (
          <button className="footer-chat" onClick={() => setChatOpen(true)}><MessageCircle size={16} /> Chat with the community</button>
        )}
      </footer>

      {accountRole === 'buyer' && (
        <button className="chat-fab" onClick={() => setChatOpen((open) => !open)} aria-label="Open community chat">
          {chatOpen ? <X size={21} /> : <MessageCircle size={21} />}
          {!chatOpen && <span>Chat with us</span>}
        </button>
      )}

      {notice && <div className="toast" role="status"><Check size={16} />{notice}</div>}
      {!online && <div className="offline-pill"><span /> Offline mode · {accountRole === 'seller' ? 'saved listings' : 'saved market'}</div>}

      {accountRole === 'buyer' && cartOpen && (
        <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && setCartOpen(false)}>
          <aside className="side-panel cart-panel" aria-label="Shopping bag">
            <div className="panel-heading"><div><small>YOUR MARKET BAG</small><h2>A good little haul.</h2></div><button className="icon-button" onClick={() => setCartOpen(false)} aria-label="Close bag"><X /></button></div>
            {cartItems.length === 0 ? <div className="cart-empty"><ShoppingBag size={34} /><b>Your bag is taking a breather.</b><span>Find a fresh favorite in the market.</span><button className="primary-button" onClick={() => setCartOpen(false)}>Explore the market</button></div> : (
              <>
                <div className="cart-lines">{cartItems.map(({ product, quantity }) => (
                  <div className="cart-line" key={product.id}>
                    <img src={product.image} alt="" />
                    <div className="cart-line-info"><b>{product.name}</b><small>{product.farm} · {product.unit}</small><strong>{money(product.price * quantity)}</strong></div>
                    <div className="quantity-control"><button onClick={() => changeQuantity(product.id, -1)} aria-label={`Remove one ${product.name}`}><Minus size={13} /></button><span>{quantity}</span><button onClick={() => changeQuantity(product.id, 1)} aria-label={`Add one ${product.name}`}><Plus size={13} /></button></div>
                  </div>
                ))}</div>
                <form className="checkout" onSubmit={placeDeliveryOrder}>
                  <label htmlFor="delivery-date">Choose your delivery day</label>
                  <input id="delivery-date" type="date" min={localDateString()} required value={deliveryDate} onChange={(event) => setDeliveryDate(event.target.value)} />
                  <label htmlFor="contact-name">Recipient name</label>
                  <input id="contact-name" type="text" maxLength="100" required value={customerName}
                    onChange={(event) => setCustomerName(event.target.value)} placeholder="Who will receive the order?" />
                  <label htmlFor="contact-phone">Contact number for the rider</label>
                  <input id="contact-phone" type="tel" inputMode="tel" maxLength="20" required value={customerPhone}
                    onChange={(event) => setCustomerPhone(event.target.value)} placeholder="09xx xxx xxxx" />
                  <label htmlFor="delivery-address">Delivery address</label>
                  <textarea id="delivery-address" rows="2" maxLength="500" required value={deliveryAddress}
                    onChange={(event) => setDeliveryAddress(event.target.value)} placeholder="House number, street, barangay, city or municipality" />
                  <div className="delivery-pin-label"><MapPin size={15} /><span>Tap the map or drag the pin to your exact location</span></div>
                  <div className="delivery-map-picker">
                    <Suspense fallback={<div className="map-loading">Loading Philippines map…</div>}>
                      <DeliveryMap destination={deliveryLocation} onSelect={setDeliveryLocation} />
                    </Suspense>
                  </div>
                  <div className="delivery-map-hint">
                    {deliveryLocation
                      ? `Delivery pin: ${deliveryLocation.lat.toFixed(5)}, ${deliveryLocation.lng.toFixed(5)}`
                      : 'Choose a destination pin on the map. The map is limited to the Philippines.'}
                  </div>
                  <div className="cod-payment-choice">
                    <span className="cod-payment-icon"><Truck size={17} /></span>
                    <span><b>Cash on delivery (COD)</b><small>Pay the courier in cash when your order arrives.</small></span>
                    <Check size={17} />
                  </div>
                  <div className="subtotal"><span>Subtotal</span><b>{money(subtotal)}</b></div>
                  <div className="checkout-note"><Clock3 size={15} /> Live tracking starts when the courier shares GPS from their phone.</div>
                  <button className="primary-button checkout-button" type="submit">{online ? 'Place COD delivery' : 'Save delivery for sync'} <ArrowRight size={16} /></button>
                </form>
              </>
            )}
          </aside>
        </div>
      )}

      {accountRole === 'buyer' && ordersOpen && (
        <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && setOrdersOpen(false)}>
          <aside className="side-panel orders-panel" aria-label="My deliveries">
            <div className="panel-heading">
              <div><small>YOUR MEATHUB ORDERS</small><h2>My deliveries.</h2></div>
              <button className="icon-button" onClick={() => setOrdersOpen(false)} aria-label="Close deliveries"><X /></button>
            </div>
            {ordersLoading && <p className="delivery-loading">Loading your deliveries…</p>}
            {!ordersLoading && customerOrders.length === 0 && (
              <div className="cart-empty"><Truck size={34} /><b>No deliveries yet.</b><span>Your COD orders and tracking links will appear here.</span></div>
            )}
            <div className="customer-order-list">
              {customerOrders.map((order) => (
                <article className="customer-order-card" key={order.id}>
                  <div className="customer-order-heading">
                    <b>Delivery #{order.id.slice(0, 8)}</b>
                    <span className={`order-status-pill status-${order.status}`}>{deliveryStatusLabels[order.status] || order.status}</span>
                  </div>
                  <p>{order.deliveryAddress}</p>
                  <small>{new Date(`${order.deliveryDate}T00:00:00`).toLocaleDateString()} · COD · {order.paymentStatus === 'paid' ? 'Paid' : 'Pay on arrival'}</small>
                  {order.status === 'out_for_delivery' && order.deliveryLocation && (
                    <div className="buyer-live-map">
                      <Suspense fallback={<div className="map-loading">Loading live map…</div>}>
                        <DeliveryMap destination={order.deliveryLocation} courierLocation={order.courierLocation} />
                      </Suspense>
                      <small className="buyer-live-map-note">
                        {order.courierLocation
                          ? <><span className="live-dot" /> Rider updated {new Date(order.courierLocation.updatedAt).toLocaleTimeString()}</>
                          : 'Waiting for the rider to share their GPS location.'}
                      </small>
                    </div>
                  )}
                  <div className="customer-order-actions">
                    <a className="text-button" href={`/track/${order.trackingToken}`} target="_blank" rel="noreferrer">Track on map <ArrowRight size={14} /></a>
                    {!['delivered', 'cancelled'].includes(order.status) && (
                      <button className="text-button" onClick={() => createCourierLink(order)}>Create courier link</button>
                    )}
                  </div>
                  {courierLinks[order.id] && (
                    <label className="courier-link-field">Share this link with your courier
                      <input readOnly value={courierLinks[order.id]} onFocus={(event) => event.target.select()} />
                    </label>
                  )}
                </article>
              ))}
            </div>
          </aside>
        </div>
      )}

      {accountRole === 'buyer' && orderConfirmation && (
        <div className="overlay modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && setOrderConfirmation(null)}>
          <section className="delivery-confirmation">
            <div className="panel-heading">
              <div><small>COD ORDER PLACED</small><h2>Waiting for the seller.</h2></div>
              <button className="icon-button" onClick={() => setOrderConfirmation(null)} aria-label="Close confirmation"><X /></button>
            </div>
            <p className="modal-intro">Order #{orderConfirmation.id.slice(0, 8)} · {money(orderConfirmation.total)} · Pay cash on arrival. The seller must confirm before a rider can start.</p>
            <div className="delivery-map-picker"><Suspense fallback={<div className="map-loading">Loading Philippines map…</div>}>
              <DeliveryMap destination={orderConfirmation.deliveryLocation} />
            </Suspense></div>
            <p className="delivery-address"><b>Deliver to:</b> {orderConfirmation.deliveryAddress}</p>
            <div className="confirmation-links">
              <a className="primary-button" href={`/track/${orderConfirmation.trackingToken}`} target="_blank" rel="noreferrer">Track your order <MapPin size={16} /></a>
              <a className="outline-button" href={`/courier/${orderConfirmation.courierToken}`} target="_blank" rel="noreferrer">Share courier GPS link <Truck size={16} /></a>
            </div>
            <small className="commission-note">The courier link grants live-location and status access. Share it only with your assigned courier.</small>
          </section>
        </div>
      )}

      {accountRole === 'seller' && listingOpen && (
        <div className="overlay modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && closeListingForm()}>
          <section className="listing-modal" aria-label="Create a product listing">
            <div className="panel-heading"><div><small>GROW WITH MEATHUB</small><h2>{editingProduct ? 'Update your listing.' : 'List something good.'}</h2></div><button className="icon-button" onClick={closeListingForm} aria-label="Close listing form"><X /></button></div>
            <p className="modal-intro">Tell local shoppers about the cuts you have ready.</p>
            <form className="listing-form" onSubmit={submitListing}>
              <label>Product name<input required value={listingForm.name} onChange={(e) => setListingForm({ ...listingForm, name: e.target.value })} placeholder="e.g. Grass-fed beef sirloin" /></label>
              <div className="form-pair">
                <label>Farm / producer<input required value={listingForm.farm} onChange={(e) => setListingForm({ ...listingForm, farm: e.target.value })} placeholder="Your farm name" /></label>
                <label>Meat type<select value={listingForm.category} onChange={(e) => setListingForm({ ...listingForm, category: e.target.value })}>{categories.slice(1).map((category) => <option key={category}>{category}</option>)}</select></label>
              </div>
              <div className="form-triple">
                <label>Price (₱)<input type="number" min="1" step="1" required value={listingForm.price} onChange={(e) => setListingForm({ ...listingForm, price: e.target.value })} /></label>
                <label>Pack size<input required value={listingForm.unit} onChange={(e) => setListingForm({ ...listingForm, unit: e.target.value })} /></label>
                <label>Stock<input type="number" min="1" step="1" required value={listingForm.stock} onChange={(e) => setListingForm({ ...listingForm, stock: e.target.value })} /></label>
              </div>
              <label>Pickup location<input required value={listingForm.location} onChange={(e) => setListingForm({ ...listingForm, location: e.target.value })} placeholder="Town or city" /></label>
              <label>Product photo <span className="optional">(optional · JPEG, PNG, or WebP · up to 5 MB)</span>
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
                      file.size > maxProductImageBytes) {
                    announce('Choose a JPEG, PNG, or WebP image up to 5 MB.');
                    event.target.value = '';
                    return;
                  }
                  setListingImageFile(file);
                }} />
              </label>
              {(listingImagePreview || listingForm.image) && (
                <img
                  className="listing-image-preview"
                  src={listingImagePreview || listingForm.image}
                  alt="Preview of the product"
                />
              )}
              <label>About this cut<textarea required rows="3" value={listingForm.description} onChange={(e) => setListingForm({ ...listingForm, description: e.target.value })} placeholder="How was it raised? What makes it special?" /></label>
              <button type="submit" className="primary-button checkout-button">{editingProduct ? 'Save listing changes' : 'Publish listing'} <ArrowRight size={16} /></button>
            </form>
          </section>
        </div>
      )}

      {accountRole === 'buyer' && chatOpen && (
        <section className="chat-window" aria-label="MeatHub community chat">
          <div className="chat-heading"><div><span className="chat-live-dot" /><span><b>MeatHub community</b><small>Ask about cuts, farms & pickup</small></span></div><button className="icon-button" onClick={() => setChatOpen(false)} aria-label="Close chat"><X size={18} /></button></div>
          <div className="chat-messages">
            {!messages.length && <div className="chat-welcome"><MessageCircle size={25} /><b>A little help from the community.</b><span>Chat is live while the marketplace is open.</span></div>}
            {messages.map((message) => (
              <div key={message.id} className={message.type === 'system' ? 'chat-message system-message' : 'chat-message'}>
                {message.type !== 'system' && <b>{message.name}</b>}
                <span>{message.text}</span>
              </div>
            ))}
          </div>
          <form className="chat-compose" onSubmit={sendChat}>
            <input value={chatText} onChange={(event) => setChatText(event.target.value)} placeholder="Write a message…" maxLength={500} />
            <button type="submit" aria-label="Send message"><ArrowRight size={17} /></button>
          </form>
        </section>
      )}
    </div>
  );
}

function ProductCard({ product, favorite, onFavorite, onAdd, onArchive, onEdit, canArchive }) {
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <article className="product-card">
      <div className="product-image-wrap">
        {!imageFailed
          ? <img src={product.image} alt={product.name} className="product-image" onError={() => setImageFailed(true)} />
          : <div className="image-placeholder"><Beef size={35} /></div>}
        {product.featured && <span className="featured-badge"><Sparkles size={12} /> FARMER'S PICK</span>}
        <button className={favorite ? 'favorite-button favorite-active' : 'favorite-button'} onClick={onFavorite} aria-label={favorite ? 'Remove from saved cuts' : 'Save this cut'}>
          <Heart size={17} fill={favorite ? 'currentColor' : 'none'} />
        </button>
        {canArchive && <div className="seller-actions"><button onClick={onEdit}>Edit</button><button onClick={onArchive}>Archive</button></div>}
        {product.stock <= 5 && <span className="stock-tag">Only {product.stock} left</span>}
      </div>
      <div className="product-details">
        <div className="product-origin"><span>{product.category}</span><i />{product.farm}</div>
        <h3>{product.name}</h3>
        <div className="product-location"><MapPin size={13} />{product.location}</div>
        <div className="product-buy-row">
          <div className="product-price">{money(product.price)} <small>/ {product.unit}</small></div>
          <button className="add-button" onClick={onAdd} disabled={product.stock < 1} aria-label={`Add ${product.name} to bag`}><Plus size={17} /></button>
        </div>
      </div>
    </article>
  );
}

function decodeBase64Key(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

export default App;
