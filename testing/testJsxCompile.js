// Run: node testing/testJsxCompile.js
import assert from 'node:assert/strict';
import { compileJsxScripts, hasJsxScripts, REACT_IMPORTS } from '../src/lib/jsxCompile.js';
import { checkSyntax } from '../src/lib/syntaxCheck.js';
import { injectLoopProtection } from '../src/lib/loopProtection.js';
import { buildViteProject, projectDependencies } from '../src/lib/reactProject.js';

const reactApp = `<!DOCTYPE html>
<html lang="en">
<head>
  <script src="https://cdn.tailwindcss.com"></script>
  <script type="importmap">{"imports":{
    "react": "${REACT_IMPORTS.react}",
    "react-dom/client": "${REACT_IMPORTS['react-dom/client']}",
    "lucide-react": "https://esm.sh/lucide-react@0.468.0?external=react"
  }}</script>
</head>
<body>
  <div id="app"></div>
  <script type="text/jsx">
    import { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    // @section: app
    function App() {
      const [items, setItems] = useState([1, 2]);
      for (let i = 0; i < 2; i++) {}
      return <ul className="p-4">{items.map((n) => <li key={n}>{n}</li>)}</ul>;
    }
    createRoot(document.getElementById('app')).render(<App />);
  </script>
</body>
</html>`;

// Compile: same line count, module type, no JSX left, jsx-runtime mapped.
assert.ok(hasJsxScripts(reactApp));
const compiled = compileJsxScripts(reactApp);
assert.equal(compiled.split('\n').length, reactApp.split('\n').length, 'compile keeps line numbers');
assert.ok(!compiled.includes('text/jsx'));
assert.ok(compiled.includes('<script type="module">'));
assert.ok(!compiled.includes('<li key'));
assert.ok(compiled.includes(`"react/jsx-runtime":"${REACT_IMPORTS['react/jsx-runtime']}"`));
assert.equal(checkSyntax(compiled).errors.length, 0, 'compiled output parses as plain JS');
assert.ok(!hasJsxScripts(compiled));

// Loop protection reaches the compiled module.
assert.ok(injectLoopProtection(compiled).includes('__orion_loop_check(1)'));

// No import map at all: a React one is added on the head line.
const noMap = reactApp.replace(/<script type="importmap">[\s\S]*?<\/script>/, '');
const compiledNoMap = compileJsxScripts(noMap);
assert.ok(compiledNoMap.includes('"react-dom/client"'));
assert.equal(compiledNoMap.split('\n').length, noMap.split('\n').length);

// Broken JSX: syntax check reports the right document line; preview throws.
const broken = reactApp.replace('<ul className="p-4">', '<ul className="p-4"><div>');
const errors = checkSyntax(broken).errors;
assert.equal(errors.length, 1);
const brokenCompiled = compileJsxScripts(broken);
assert.ok(brokenCompiled.includes('throw new SyntaxError('));
assert.equal(brokenCompiled.split('\n').length, broken.split('\n').length, 'error stub keeps line numbers');
assert.equal(checkSyntax(reactApp).errors.length, 0, 'valid JSX passes the syntax check');

// JSX outside text/jsx is still an error, with a hint pointing at text/jsx.
const misplaced = reactApp.replace('type="text/jsx"', 'type="module"');
assert.match(checkSyntax(misplaced).errors[0].message, /text\/jsx/);

// Pages without JSX (websites, games, older Preact apps) are untouched.
const preact = `<!DOCTYPE html><html><head></head><body><script type="module">
import { html } from 'htm/preact';
const x = html\`<div>hi</div>\`;
</script></body></html>`;
assert.equal(compileJsxScripts(preact), preact);
assert.ok(!hasJsxScripts(preact));

// Vite project export.
assert.deepEqual(projectDependencies(reactApp), {
  'lucide-react': '^0.468.0', react: '^19.2.0', 'react-dom': '^19.2.0',
});
const entries = buildViteProject(reactApp, { name: 'todo', title: 'Todo' });
const byName = Object.fromEntries(entries.map((e) => [e.name, e.data]));
assert.deepEqual(Object.keys(byName).sort(), ['todo/README.md', 'todo/index.html', 'todo/package.json', 'todo/src/main.jsx', 'todo/vite.config.js']);
assert.ok(!byName['todo/index.html'].includes('importmap'));
assert.ok(byName['todo/index.html'].includes('<script type="module" src="/src/main.jsx"></script>'));
assert.ok(byName['todo/index.html'].includes('cdn.tailwindcss.com'));
assert.ok(byName['todo/src/main.jsx'].startsWith("import { useState } from 'react';"));
assert.equal(JSON.parse(byName['todo/package.json']).dependencies['lucide-react'], '^0.468.0');
assert.equal(buildViteProject(preact), null);

console.log('testJsxCompile: ok');
