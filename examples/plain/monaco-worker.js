// Monaco's editor worker, loaded from the local copy in node_modules (the AMD build needs a classic worker script).
const base = new URL('../../node_modules/monaco-editor/min/', self.location.href).href;
self.MonacoEnvironment = { baseUrl: base };
importScripts(base + 'vs/base/worker/workerMain.js');
