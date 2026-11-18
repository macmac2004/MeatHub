import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, Bell, Beef, Check, CircleUserRound, Clock3,
  Heart, Leaf, MapPin, MessageCircle, Minus, Plus, Search, ShieldCheck,
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

const API_URL = import.meta.env.VITE_API_URL || '';
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';
const DeliveryMap = lazy(() => import('./DeliveryMap.jsx'));
const categories = ['All cuts', 'Beef', 'Pork', 'Chicken', 'Lamb'];
const deliveryStatusLabels = {
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

async function request(path, options = {}, user = null) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (user && firebaseEnabled) headers.Authorization = `Bearer ${await user.getIdToken()}`;
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status}).`);
  }
  return response.status === 204 ? null : response.json();
}

function money(value) {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency', currency: 'PHP', maximumFractionDigits: 0
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
        ? currentUser
        : null;
    } catch {
      return null;
    }
  });
  const [authReady, setAuthReady] = useState(!firebaseEnabled);
  const [notice, setNotice] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [apiPushReady, setApiPushReady] = useState(false);
  const [deliveryDate, setDeliveryDate] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryLocation, setDeliveryLocation] = useState(null);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [customerOrders, setCustomerOrders] = useState([]);
  const [courierLinks, setCourierLinks] = useState({});
  const [orderConfirmation, setOrderConfirmation] = useState(null);
  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem('meathub-favorites') || '[]'); } catch { return []; }
  });
  const chatRef = useRef(null);
  const searchRef = useRef(null);
  const syncRef = useRef(null);

  const announce = useCallback((message) => {
    setNotice(message);
    window.clearTimeout(announce.timer);
    announce.timer = window.setTimeout(() => setNotice(''), 3500);
  }, []);

  const loadProducts = useCallback(async () => {
    try {
      const data = await request('/api/products');
      setProducts(data);
      try {
        localStorage.setItem('meathub-products', JSON.stringify(data));
      } catch (error) {
        console.warn('Could not save an offline catalog copy:', error);
      }
    } catch (error) {
      try {
        const cached = JSON.parse(localStorage.getItem('meathub-products') || 'null');
        if (Array.isArray(cached)) {
          setProducts(cached);
          announce('Showing your saved market. Delivery orders will sync when you are online.');
        } else {
          announce(`Couldn't load products: ${error.message}`);
        }
      } catch (cacheError) {
        console.error('Could not read the saved offline catalog:', cacheError);
        announce(`Couldn't load products: ${error.message}`);
      }
    } finally {
      setLoading(false);
    }
  }, [announce]);

  useEffect(() => {
    if (!firebaseEnabled) return undefined;
    return onAuthStateChanged(auth, (authenticatedUser) => {
      setUser(authenticatedUser);
      setAuthReady(true);
    });
  }, []);

  useEffect(() => {
    if (!authReady || !user) return;
    loadProducts();
    request('/api/health').then((health) => setApiPushReady(health.pushEnabled)).catch(() => {});
  }, [authReady, loadProducts, user]);

  useEffect(() => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return undefined;
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
  }, [apiPushReady, user]);

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
    const handleOnline = () => {
      setOnline(true);
      if (user) {
        syncQueuedOrders();
        loadProducts();
      }
    };
    const handleOffline = () => setOnline(false);
    const handleServiceWorkerMessage = (event) => {
      if (event.data?.type === 'SYNC_MEATHUB_RESERVATIONS' && navigator.onLine) syncQueuedOrders();
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    navigator.serviceWorker?.addEventListener('message', handleServiceWorkerMessage);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      navigator.serviceWorker?.removeEventListener('message', handleServiceWorkerMessage);
    };
  }, [loadProducts, user]);

  useEffect(() => {
    if (online && user) syncQueuedOrders();
  }, [online, user]);

  async function syncQueuedOrders() {
    if (syncRef.current) return syncRef.current;
    const run = (async () => {
      try {
        await migrateLegacyQueue(API_URL);
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
        try {
          const response = await fetch(`${record.apiUrl ?? API_URL}/api/orders`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {})
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
    if (!chatOpen) return undefined;
    const apiBase = API_URL || `${window.location.protocol}//${window.location.hostname}:4000`;
    const socketUrl = new URL('/ws', apiBase);
    socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(socketUrl);
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
    socket.addEventListener('error', () => announce('Chat is unavailable right now.'));
    return () => {
      socket.close();
      chatRef.current = null;
    };
  }, [chatOpen, announce]);

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
      paymentMethod: 'cod'
    };
    if (!online) {
      try {
        const token = user && firebaseEnabled ? await user.getIdToken().catch(() => null) : null;
        await enqueueOrder({ order, apiUrl: API_URL, token });
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
        new Notification('COD delivery confirmed', { body: 'Your delivery order is being prepared.' });
      }
    } catch (error) {
      announce(error.message);
    }
  }

  async function submitListing(event) {
    event.preventDefault();
    const body = {
      ...listingForm,
      price: Number(listingForm.price),
      stock: Number(listingForm.stock),
      image: listingForm.image || 'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?auto=format&fit=crop&w=1000&q=85'
    };
    try {
      await request(editingProduct ? `/api/products/${editingProduct.id}` : '/api/products', {
        method: editingProduct ? 'PATCH' : 'POST',
        body: JSON.stringify(body)
      }, user);
      setListingForm(initialForm);
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

  if (!authReady || !user) {
    return (
      <main className="auth-gate" aria-live="polite">
        <span className="brand-mark"><Beef size={22} strokeWidth={1.8} /></span>
        <p>Checking your MeatHub account…</p>
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
          <a className="nav-active" href="#shop">Shop meat</a>
          <a href="#farmers">Our farmers</a>
          <a href="#story">Our story</a>
        </nav>
        <div className="header-actions">
          <button className="icon-button notification-button" aria-label={pushEnabled ? 'Notifications enabled' : 'Enable notifications'} onClick={enableNotifications}>
            <Bell size={19} />
          </button>
          <button className="orders-button" onClick={openOrders}>
            <MapPin size={16} /><span>My deliveries</span>
          </button>
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
          <button className="bag-button" onClick={() => setCartOpen(true)} aria-label={`Open bag, ${cartCount} items`}>
            <ShoppingBag size={18} /><span>My bag</span><b>{cartCount}</b>
          </button>
        </div>
      </header>

      <main>
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
            <button className="outline-button" onClick={() => setListingOpen(true)}>
              <Plus size={16} /> Sell on MeatHub
            </button>
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
                onAdd={() => addToCart(product)}
                onArchive={() => archiveListing(product)}
                onEdit={() => startEditListing(product)}
                canArchive={product.ownerUid && (product.ownerUid === user?.uid || (!firebaseEnabled && product.ownerUid === 'demo-customer'))} />
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
      </main>

      <footer className="site-footer">
        <a className="brand footer-brand" href="#"><span className="brand-mark"><Beef size={21} /></span><span>meat<span>hub</span><small>LOCAL • FRESH • FAIR</small></span></a>
        <span>Better meat. Better neighbors. © 2025 MeatHub</span>
        <button className="footer-chat" onClick={() => setChatOpen(true)}><MessageCircle size={16} /> Chat with the community</button>
      </footer>

      <button className="chat-fab" onClick={() => setChatOpen((open) => !open)} aria-label="Open community chat">
        {chatOpen ? <X size={21} /> : <MessageCircle size={21} />}
        {!chatOpen && <span>Chat with us</span>}
      </button>

      {notice && <div className="toast" role="status"><Check size={16} />{notice}</div>}
      {!online && <div className="offline-pill"><span /> Offline mode · browsing saved market</div>}

      {cartOpen && (
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

      {ordersOpen && (
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

      {orderConfirmation && (
        <div className="overlay modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && setOrderConfirmation(null)}>
          <section className="delivery-confirmation">
            <div className="panel-heading">
              <div><small>COD ORDER CONFIRMED</small><h2>Your delivery is on its way.</h2></div>
              <button className="icon-button" onClick={() => setOrderConfirmation(null)} aria-label="Close confirmation"><X /></button>
            </div>
            <p className="modal-intro">Order #{orderConfirmation.id.slice(0, 8)} · {money(orderConfirmation.total)} · Pay cash on arrival.</p>
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

      {listingOpen && (
        <div className="overlay modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && setListingOpen(false)}>
          <section className="listing-modal" aria-label="Create a product listing">
            <div className="panel-heading"><div><small>GROW WITH MEATHUB</small><h2>{editingProduct ? 'Update your listing.' : 'List something good.'}</h2></div><button className="icon-button" onClick={() => { setListingOpen(false); setEditingProduct(null); setListingForm(initialForm); }} aria-label="Close listing form"><X /></button></div>
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
              <label>Photo URL <span className="optional">(optional)</span><input type="url" value={listingForm.image} onChange={(e) => setListingForm({ ...listingForm, image: e.target.value })} placeholder="https://…" /></label>
              <label>About this cut<textarea required rows="3" value={listingForm.description} onChange={(e) => setListingForm({ ...listingForm, description: e.target.value })} placeholder="How was it raised? What makes it special?" /></label>
              <button type="submit" className="primary-button checkout-button">{editingProduct ? 'Save listing changes' : 'Publish listing'} <ArrowRight size={16} /></button>
            </form>
          </section>
        </div>
      )}

      {chatOpen && (
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
