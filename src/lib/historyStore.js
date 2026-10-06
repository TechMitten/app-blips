import authProvider from './auth';
import { createHistoryStore } from './historyArchive';

// The app's version-history store (see lib/historyArchive.js), signed in as
// the current user.
export { KEEP_FULL_VERSIONS, isArchivedVersion } from './historyArchive';
export const { archiveVersions, ensureVersionFiles, deleteProjectHistory } = createHistoryStore({
  getIdToken: () => authProvider.getIdToken(),
});
