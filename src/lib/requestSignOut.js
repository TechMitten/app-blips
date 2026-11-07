import { createContext, useContext } from 'react';

// Opens the "Sign out of AppBlips?" dialog (components/SignOutConfirm.jsx).
// A no-op outside its provider, i.e. in copies without accounts, which have
// no sign-out buttons anyway.
export const RequestSignOutContext = createContext(() => {});

export const useRequestSignOut = () => useContext(RequestSignOutContext);
