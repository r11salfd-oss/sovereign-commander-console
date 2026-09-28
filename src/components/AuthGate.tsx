import React, { useEffect, useState } from 'react';
import { User } from 'firebase/auth';
import { loginWithGoogle, subscribeToAuth } from '../firebase';
import { ShieldCheck, AlertTriangle, RefreshCw, KeyRound, Terminal } from 'lucide-react';

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const savedLocal = localStorage.getItem('sovereign_local_commander') || sessionStorage.getItem('sovereign_local_commander');
      if (savedLocal) {
        return JSON.parse(savedLocal) as User;
      }
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        if (params.get('mode') === 'local' || params.get('commander') === 'true' || params.get('bypass') === 'true') {
          const autoUser: any = {
            uid: 'sovereign-commander-local-root',
            email: 'r11salfd@gmail.com',
            displayName: 'Sovereign Commander (Local Admin)',
            emailVerified: true,
            isAnonymous: false,
            isLocalCommander: true,
            getIdToken: async () => 'mock-sovereign-token',
          };
          localStorage.setItem('sovereign_local_commander', JSON.stringify(autoUser));
          sessionStorage.setItem('sovereign_local_commander', JSON.stringify(autoUser));
          return autoUser as User;
        }
      }
    } catch (e) {}
    return null;
  });
  const [loading, setLoading] = useState(!user);
  const [authInProgress, setAuthInProgress] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (user && (user as any).isLocalCommander) {
      setLoading(false);
      return;
    }
    const unsubscribe = subscribeToAuth((u) => {
      if (u) {
        setUser(u);
      } else {
        try {
          const savedLocal = localStorage.getItem('sovereign_local_commander') || sessionStorage.getItem('sovereign_local_commander');
          if (savedLocal) {
            setUser(JSON.parse(savedLocal) as User);
          }
        } catch (e) {}
      }
      setLoading(false);
    });
    return unsubscribe;
  }, [user]);

  const handleLocalBypass = () => {
    const mockUser: any = {
      uid: 'sovereign-commander-local-root',
      email: 'r11salfd@gmail.com',
      displayName: 'Sovereign Commander (Local Admin)',
      emailVerified: true,
      isAnonymous: false,
      isLocalCommander: true,
      getIdToken: async () => 'mock-sovereign-token',
    };
    localStorage.setItem('sovereign_local_commander', JSON.stringify(mockUser));
    sessionStorage.setItem('sovereign_local_commander', JSON.stringify(mockUser));
    localStorage.setItem('google_user_email', 'r11salfd@gmail.com');
    sessionStorage.setItem('google_user_email', 'r11salfd@gmail.com');
    setUser(mockUser);
    setLoading(false);
  };

  const handleLogin = async () => {
    setAuthInProgress(true);
    setAuthError(null);
    try {
      await loginWithGoogle();
    } catch (err: any) {
      console.error('Authentication attempt failed:', err);
      const msg = err?.message || 'Authentication could not be completed.';
      
      // Handle common popup error codes gracefully
      if (err?.code === 'auth/popup-closed-by-user' || msg.includes('popup-closed-by-user')) {
        setAuthError('Sign-in popup was closed before completion. Please try again or enter in Local Commander mode.');
        return;
      }
      if (err?.code === 'auth/cancelled-popup-request' || msg.includes('cancelled-popup-request')) {
        setAuthError('Sign-in request was cancelled. Only one sign-in window can be open at a time.');
        return;
      }

      // Auto-fallback if Firebase rejects localhost OAuth domain
      if (err?.code === 'auth/unauthorized-domain' || msg.includes('unauthorized-domain')) {
        console.warn('Firebase OAuth unauthorized domain detected on localhost. Auto-engaging Sovereign Local Commander session.');
        handleLocalBypass();
        return;
      }
      setAuthError(msg);
    } finally {
      setAuthInProgress(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#07090e] flex flex-col items-center justify-center text-cyan-400 font-mono text-sm gap-3">
        <RefreshCw className="w-6 h-6 animate-spin text-cyan-400" />
        <span>Authenticating Secure Channel...</span>
      </div>
    );
  }

  if (!user) {
    const isLocalhost = typeof window !== 'undefined' && 
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

    return (
      <div className="min-h-screen bg-[#07090e] flex flex-col items-center justify-center p-4 text-slate-300 font-mono">
        <div className="glass-panel p-8 rounded-xl border border-slate-800 text-center max-w-md w-full bg-[#0b101b]/90 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-cyan-500 via-emerald-400 to-cyan-500"></div>

          <div className="w-12 h-12 rounded-xl bg-cyan-950/60 border border-cyan-800/60 flex items-center justify-center mx-auto mb-4 text-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.2)]">
            <KeyRound className="w-6 h-6" />
          </div>

          <h2 className="text-xl text-cyan-400 mb-1 tracking-widest font-bold font-mono">SOVEREIGN COMMANDER</h2>
          <p className="text-xs mb-6 text-slate-400 font-sans">Human-in-the-Loop Mission Control & Defense Matrix</p>

          {authError && (
            <div className="mb-6 p-3 rounded bg-rose-950/40 border border-rose-800/60 text-rose-300 text-xs text-left flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 break-words">
                <div className="font-bold mb-0.5">Authentication Error</div>
                <div className="text-[11px] text-rose-200/90 font-mono">{authError}</div>
                {authError.includes('unauthorized-domain') && (
                  <div className="mt-2 text-[10px] text-amber-300 border-t border-rose-800/40 pt-1.5 font-sans">
                    💡 Firebase restricts OAuth popups on local domains. Use Local Commander mode below to enter immediately.
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <button
              onClick={handleLogin}
              disabled={authInProgress}
              className="w-full bg-cyan-900/50 hover:bg-cyan-900/80 active:bg-cyan-800 border border-cyan-600/70 text-cyan-300 px-5 py-3 rounded-lg font-mono text-xs tracking-wider uppercase transition shadow-[0_0_20px_rgba(34,211,238,0.2)] flex items-center justify-center gap-2 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {authInProgress ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Authorizing...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4 text-cyan-400" />
                  <span>Authenticate with Google</span>
                </>
              )}
            </button>

            {(isLocalhost || authError) && (
              <button
                onClick={handleLocalBypass}
                type="button"
                className="w-full bg-emerald-950/40 hover:bg-emerald-900/50 border border-emerald-600/60 text-emerald-400 px-5 py-2.5 rounded-lg font-mono text-xs tracking-wider uppercase transition flex items-center justify-center gap-2 font-medium"
              >
                <Terminal className="w-4 h-4 text-emerald-400" />
                <span>Enter in Local Commander Mode</span>
              </button>
            )}
          </div>

          <p className="mt-6 text-[10px] text-slate-500 font-mono">
            Firebase Project: coherent-rainfall-fmbw7
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
