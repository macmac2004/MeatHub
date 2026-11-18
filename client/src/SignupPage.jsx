import { useState } from 'react';
import { Beef, Heart, ShieldCheck, Sprout, Truck } from 'lucide-react';
import { createUserWithEmailAndPassword, signInWithPopup, signOut, updateProfile } from '@firebase/auth';
import { auth, firebaseEnabled, googleProvider } from './firebase.js';
import { createDemoSalt, hashDemoPassword } from './demoAuth.js';
import { clearPendingAccountRole, rememberPendingAccountRole, saveAccountRole } from './accountRole.js';

export default function SignupPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('buyer');

  async function finishFirebaseSignup(user, accountEmail) {
    const normalizedEmail = accountEmail.trim().toLowerCase();
    rememberPendingAccountRole(normalizedEmail, role);
    try {
      await saveAccountRole(user, role);
      clearPendingAccountRole();
      await signOut(auth);
      redirectToSignIn(normalizedEmail);
    } catch (saveError) {
      await signOut(auth);
      if (saveError.status === 409) {
        clearPendingAccountRole();
        setError(`${saveError.message} Sign in with the account's existing type.`);
        return;
      }
      const query = new URLSearchParams({ rolePending: '1', email: normalizedEmail });
      window.location.assign(`/login?${query.toString()}`);
    }
  }

  function redirectToSignIn(accountEmail) {
    const query = new URLSearchParams({ created: '1', email: accountEmail });
    window.location.assign(`/login?${query.toString()}`);
  }

  async function createAccount(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (firebaseEnabled) {
        const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await updateProfile(credential.user, { displayName: name.trim() });
        await finishFirebaseSignup(credential.user, email);
        localStorage.removeItem('meathub-demo-user');
        return;
      } else {
        const normalizedEmail = email.trim().toLowerCase();
        const accounts = JSON.parse(localStorage.getItem('meathub-demo-accounts') || '[]');
        if (accounts.some((account) => account.email === normalizedEmail)) {
          throw new Error('An account with this email already exists. Please sign in.');
        }
        if (password.length < 6) throw new Error('Password must be at least 6 characters.');
        const passwordSalt = createDemoSalt();
        const account = {
          uid: `demo-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: name.trim(),
          email: normalizedEmail,
          role,
          passwordSalt,
          passwordHash: await hashDemoPassword(password, passwordSalt)
        };
        localStorage.setItem('meathub-demo-accounts', JSON.stringify([...accounts, account]));
        localStorage.removeItem('meathub-demo-user');
      }
      redirectToSignIn(email.trim().toLowerCase());
    } catch (signInError) {
      setError(signInError.code === 'auth/popup-closed-by-user'
        ? 'The sign-up window was closed. Please try again.'
        : signInError.message);
    } finally {
      setBusy(false);
    }
  }

  async function signUpWithGoogle() {
    setError('');
    setBusy(true);
    try {
      const credential = await signInWithPopup(auth, googleProvider);
      const accountEmail = credential.user.email || '';
      await finishFirebaseSignup(credential.user, accountEmail);
    } catch (signInError) {
      setError(signInError.code === 'auth/popup-closed-by-user'
        ? 'The sign-up window was closed. Please try again.'
        : signInError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-brand-panel" aria-label="MeatHub">
        <a className="login-brand" href="/" aria-label="MeatHub home">
          <span className="brand-mark"><Beef size={24} strokeWidth={1.8} /></span>
          <span>meat<span>hub</span><small>LOCAL • FRESH • FAIR</small></span>
        </a>
        <div className="login-story">
          <div className="eyebrow"><span /> GOOD MEAT, GOOD PEOPLE</div>
          <h1>Join a market<br />closer to <em>home.</em></h1>
          <p>Create an account to save favorites, list products, and follow local deliveries.</p>
        </div>
        <div className="login-farm-note">
          <Sprout size={18} />
          <span><b>Traceable by nature</b><small>Know the farms behind your food</small></span>
        </div>
      </section>

      <section className="login-card-section">
        <a className="login-back" href="/">← Back to the market</a>
        <div className="login-card">
          <div className="login-heading">
            <div className="eyebrow section-eyebrow">JOIN THE LOCAL MARKET</div>
            <h2>Create your <em>MeatHub account.</em></h2>
            <p>{firebaseEnabled ? 'Create an account with email or Google.' : 'Create a local account to try MeatHub.'}</p>
          </div>
          {error && <div className="login-error" role="alert">{error}</div>}
          <form className="auth-form" onSubmit={createAccount}>
            <label>Full name
              <input type="text" value={name} onChange={(event) => setName(event.target.value)} required autoComplete="name" placeholder="Your name" />
            </label>
            <label>Email address
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" placeholder="you@example.com" />
            </label>
            <label>Password
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} autoComplete="new-password" placeholder="At least 6 characters" />
            </label>
            <fieldset className="account-role-options">
              <legend>How will you use MeatHub?</legend>
              <label className={role === 'buyer' ? 'account-role-option selected' : 'account-role-option'}>
                <input type="radio" name="account-role" value="buyer" checked={role === 'buyer'} onChange={() => setRole('buyer')} />
                <span><b>Buyer</b><small>Browse the market and place deliveries.</small></span>
              </label>
              <label className={role === 'seller' ? 'account-role-option selected' : 'account-role-option'}>
                <input type="radio" name="account-role" value="seller" checked={role === 'seller'} onChange={() => setRole('seller')} />
                <span><b>Seller</b><small>Manage your meat listings and stock.</small></span>
              </label>
            </fieldset>
            <button className="auth-submit" type="submit" disabled={busy}>
              {busy ? 'Creating account…' : `Create ${role} account`}
            </button>
          </form>
          {firebaseEnabled && (
            <>
              <div className="auth-divider"><span>or</span></div>
              <button className="google-signin" type="button" onClick={signUpWithGoogle} disabled={busy}>
                <span className="google-mark" aria-hidden="true">G</span>
                {busy ? 'Creating account…' : 'Sign up with Google'}
              </button>
            </>
          )}
          <div className="login-benefits">
            <span><Heart size={16} /> Save favorite cuts</span>
            <span><Truck size={16} /> Track your deliveries</span>
            <span><ShieldCheck size={16} /> Secure account access</span>
          </div>
          <p className="login-switch">Already have an account? <a href="/login">Sign in</a></p>
        </div>
        <p className="login-terms">By continuing, you agree to MeatHub&apos;s terms and community guidelines.</p>
      </section>
    </main>
  );
}
