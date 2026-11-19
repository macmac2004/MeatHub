import { useState } from 'react';
import { Beef, Heart, ShieldCheck, Sprout, Truck } from 'lucide-react';
import { sendPasswordResetEmail, signInWithPopup, signInWithEmailAndPassword } from '@firebase/auth';
import { auth, firebaseEnabled, friendlyAuthError, googleProvider } from './firebase.js';
import { createDemoSalt, hashDemoPassword } from './demoAuth.js';
import { applyPendingAccountRole } from './accountRole.js';

export default function LoginPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(() => (
    (() => {
      const params = new URLSearchParams(window.location.search);
      if (params.get('rolePending') === '1') return 'Account created. Sign in to finish saving your account type.';
      return params.get('created') === '1' ? 'Account created. Sign in with your new email and password.' : '';
    })()
  ));
  const [email, setEmail] = useState(() => new URLSearchParams(window.location.search).get('email') || '');
  const [password, setPassword] = useState('');
  const [resetMode, setResetMode] = useState(false);
  const [newPassword, setNewPassword] = useState('');

  async function loginWithEmail(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (firebaseEnabled) {
        const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
        await applyPendingAccountRole(credential.user);
      } else {
        const rawAccounts = JSON.parse(localStorage.getItem('meathub-demo-accounts') || '[]');
        const account = rawAccounts.find((item) => item.email === email.trim().toLowerCase());
        if (!account) {
          throw new Error('No account was found. Create an account first.');
        }
        if (account.passwordHash !== await hashDemoPassword(password, account.passwordSalt)) {
          throw new Error('The email or password is incorrect.');
        }
        localStorage.setItem('meathub-demo-user', JSON.stringify({
          uid: account.uid,
          displayName: account.name,
          email: account.email,
          role: ['buyer', 'seller', 'rider'].includes(account.role) ? account.role : 'buyer'
        }));
      }
      window.location.assign('/');
    } catch (loginError) {
      setError(friendlyAuthError(loginError));
    } finally {
      setBusy(false);
    }
  }

  async function continueWithGoogle() {
    setError('');
    if (!firebaseEnabled) {
      setError('Create an account first with your name, email, and password.');
      return;
    }
    setBusy(true);
    try {
      const credential = await signInWithPopup(auth, googleProvider);
      await applyPendingAccountRole(credential.user);
      window.location.assign('/');
    } catch (signInError) {
      setError(friendlyAuthError(signInError));
    } finally {
      setBusy(false);
    }
  }

  async function sendPasswordReset() {
    setError('');
    setNotice('');
    if (!email.trim()) {
      setError('Enter your email address first, then choose Forgot password.');
      return;
    }
    if (!firebaseEnabled) {
      setResetMode(true);
      setNotice('Local demo reset: choose a new password for this account on this device.');
      return;
    }
    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setNotice('If an account exists for this email, a password reset link has been sent.');
    } catch (resetError) {
      setError(friendlyAuthError(resetError));
    } finally {
      setBusy(false);
    }
  }

  async function resetDemoPassword(event) {
    event.preventDefault();
    setError('');
    try {
      const accounts = JSON.parse(localStorage.getItem('meathub-demo-accounts') || '[]');
      const account = accounts.find((item) => item.email === email.trim().toLowerCase());
      if (!account) throw new Error('No account was found with this email.');
      if (newPassword.length < 6) throw new Error('Password must be at least 6 characters.');
      const passwordSalt = createDemoSalt();
      const passwordHash = await hashDemoPassword(newPassword, passwordSalt);
      const updatedAccounts = accounts.map((item) => item.email === account.email
        ? { ...item, passwordSalt, passwordHash }
        : item);
      localStorage.setItem('meathub-demo-accounts', JSON.stringify(updatedAccounts));
      setPassword('');
      setNewPassword('');
      setResetMode(false);
      setNotice('Your demo password was updated. Sign in with your new password.');
    } catch (resetError) {
      setError(resetError.message);
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
          <h1>Welcome back to<br />your <em>local market.</em></h1>
          <p>Sign in to view favorites, manage listings, and track every delivery.</p>
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
            <div className="eyebrow section-eyebrow">WELCOME BACK</div>
            <h2>Sign in to <em>your market.</em></h2>
            <p>{firebaseEnabled ? 'Sign in with your email or Google account.' : 'Sign in with an account you created on this device.'}</p>
          </div>
          {notice && <div className="login-notice" role="status">{notice}</div>}
          {error && <div className="login-error" role="alert">{error}</div>}
          {resetMode ? (
            <form className="auth-form" onSubmit={resetDemoPassword}>
              <label>Email address
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" placeholder="you@example.com" />
              </label>
              <label>New password
                <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required minLength={6} autoComplete="new-password" placeholder="At least 6 characters" />
              </label>
              <button className="auth-submit" type="submit">Set new password</button>
              <button className="forgot-password" type="button" onClick={() => setResetMode(false)}>Back to sign in</button>
            </form>
          ) : (
            <>
              <form className="auth-form" onSubmit={loginWithEmail}>
                <label>Email address
                  <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" placeholder="you@example.com" />
                </label>
                <label>Password
                  <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" placeholder="Your password" />
                </label>
                <button className="forgot-password" type="button" onClick={sendPasswordReset} disabled={busy}>
                  Forgot password?
                </button>
                <button className="auth-submit" type="submit" disabled={busy}>
                  {busy ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
              {firebaseEnabled && (
                <>
                  <div className="auth-divider"><span>or</span></div>
                  <button className="google-signin" type="button" onClick={continueWithGoogle} disabled={busy}>
                    <span className="google-mark" aria-hidden="true">G</span>
                    {busy ? 'Opening sign-in…' : 'Continue with Google'}
                  </button>
                </>
              )}
            </>
          )}
          <div className="login-benefits">
            <span><Heart size={16} /> Save favorite cuts</span>
            <span><Truck size={16} /> Track your deliveries</span>
            <span><ShieldCheck size={16} /> Secure account access</span>
          </div>
          <p className="login-switch">New to MeatHub? <a href="/signup">Create an account</a></p>
        </div>
        <p className="login-terms">By continuing, you agree to MeatHub&apos;s terms and community guidelines.</p>
      </section>
    </main>
  );
}
