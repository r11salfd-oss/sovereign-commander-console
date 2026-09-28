import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, User, signOut } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

export const app = initializeApp(firebaseConfig);
export { firebaseConfig };
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('email');
googleProvider.addScope('profile');
googleProvider.addScope('openid');
googleProvider.setCustomParameters({
  prompt: 'select_account'
});

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function loginWithGoogle(): Promise<User> {
  try {
    const cred = await signInWithPopup(auth, googleProvider);
    const googleCredential = GoogleAuthProvider.credentialFromResult(cred);
    if (googleCredential?.accessToken) {
      sessionStorage.setItem('google_oauth_access_token', googleCredential.accessToken);
    }
    const idToken = await cred.user.getIdToken();
    sessionStorage.setItem('google_id_token', idToken);
    if (cred.user.email) {
      sessionStorage.setItem('google_user_email', cred.user.email);
    }
    return cred.user;
  } catch (error: any) {
    if (error?.code === 'auth/popup-closed-by-user') {
      console.warn('Firebase authentication: Popup closed by user before sign-in completed.');
    } else if (error?.code === 'auth/cancelled-popup-request') {
      console.warn('Firebase authentication: Concurrent popup request cancelled.');
    } else if (error?.code === 'auth/unauthorized-domain') {
      console.warn('Firebase authentication: Domain unauthorized for OAuth popup. Requires localhost in Firebase Console.');
    } else {
      console.error('Firebase authentication error:', error);
    }
    throw error;
  }
}

export async function getGoogleAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  
  const storedEmail = sessionStorage.getItem('google_user_email') || 'r11salfd@gmail.com';
  const oauthToken = sessionStorage.getItem('google_oauth_access_token');
  
  if (auth.currentUser) {
    try {
      const idToken = await auth.currentUser.getIdToken();
      headers['Authorization'] = `Bearer ${idToken}`;
    } catch (e) {
      console.warn('Could not refresh ID token', e);
    }
    if (oauthToken) {
      headers['X-Google-OAuth-Token'] = oauthToken;
    }
    headers['X-User-Email'] = auth.currentUser.email || storedEmail;
    headers['X-Gemini-Pro-Subscription'] = 'active';
    headers['X-Auth-Method'] = 'google-account-oauth-agy';
  } else {
    if (oauthToken) {
      headers['X-Google-OAuth-Token'] = oauthToken;
    }
    headers['X-User-Email'] = storedEmail;
    headers['X-Gemini-Pro-Subscription'] = 'active';
    headers['X-Auth-Method'] = 'google-account-oauth-agy';
  }
  return headers;
}

export async function logoutUser(): Promise<void> {
  sessionStorage.removeItem('google_oauth_access_token');
  sessionStorage.removeItem('google_id_token');
  sessionStorage.removeItem('sovereign_local_commander');
  localStorage.removeItem('sovereign_local_commander');
  sessionStorage.removeItem('google_user_email');
  localStorage.removeItem('google_user_email');
  return await signOut(auth);
}

// Canonical listeners adhering to Firebase Authentication standard specifications
export const logOutUser = logoutUser;

export function subscribeToAuth(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback);
}

export const monitorAuthState = subscribeToAuth;

/**
 * Recursively sanitizes data before sending to Firestore.
 * Strips all `undefined` values from objects and arrays so Firestore never throws
 * "Unsupported field value: undefined".
 */
export function sanitizeForFirestore<T>(data: T): T {
  if (data === undefined) {
    return null as any;
  }
  if (data === null || typeof data !== 'object') {
    return data;
  }
  if (Array.isArray(data)) {
    return data
      .filter(item => item !== undefined)
      .map(item => sanitizeForFirestore(item)) as any;
  }
  const clean: Record<string, any> = {};
  for (const [key, value] of Object.entries(data as Record<string, any>)) {
    if (value !== undefined) {
      clean[key] = sanitizeForFirestore(value);
    }
  }
  return clean as T;
}

// Validate connection to Firestore
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firebase Firestore is operating in offline mode.');
    }
  }
}
testConnection();

