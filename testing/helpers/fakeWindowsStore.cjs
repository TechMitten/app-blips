// Preloaded into Electron's main process (electron -r) by
// testing/testStoreUpdateNotice.mjs: Electron sets process.windowsStore only in
// a real Microsoft Store (MSIX) install, which can't be made outside Windows.
process.windowsStore = true;
