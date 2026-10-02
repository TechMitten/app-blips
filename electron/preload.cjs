// Preload for the AppBlips window. CommonJS because sandboxed preloads cannot
// be ES modules. Exposes window.appblipsDesktop only to the app's own page:
// the blob: window Open in new tab creates inherits this preload, so the
// protocol check keeps the API away from it (its generated code is sandboxed
// in an iframe anyway, where preloads don't run). The main process
// re-checks the sender of every call (fromApp in main.js).
const { contextBridge, ipcRenderer } = require('electron');

if (window.location.protocol === 'appblips:') {
  const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

  contextBridge.exposeInMainWorld('appblipsDesktop', {
    platform: process.platform,
    projects: {
      list: call('desktop:projects:list'),
      save: call('desktop:projects:save'),
      delete: call('desktop:projects:delete'),
    },
    appData: {
      save: call('desktop:appData:save'),
    },
    provider: {
      get: call('desktop:provider:get'),
      set: call('desktop:provider:set'),
      clear: call('desktop:provider:clear'),
    },
    folder: {
      get: call('desktop:folder:get'),
      open: call('desktop:folder:open'),
      choose: call('desktop:folder:choose'),
    },
  });
}
