import { createContext, useContext } from 'react';

// The account dialogs (components/AccountDialogs.jsx): "Sign out of
// AppBlips?" and, in the desktop app, the sign-in dialog with Google and
// GitHub. No-ops outside their provider, i.e. in copies without accounts,
// which have no account buttons anyway.
export const RequestSignOutContext = createContext(() => {});
export const useRequestSignOut = () => useContext(RequestSignOutContext);

// openSignIn('sign-in' | 'sign-up')
export const OpenSignInContext = createContext(() => {});
export const useOpenSignIn = () => useContext(OpenSignInContext);
