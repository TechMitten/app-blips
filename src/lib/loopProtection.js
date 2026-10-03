import * as acorn from 'acorn';
import { extractInlineScripts } from './syntaxCheck.js';

const INJECTED_FUNCTION = `
window.__orion_loop_check = function(id) {
  var s = window.__orion_loop_state = window.__orion_loop_state || {};
  var n = Date.now();
  var e = s[id];
  // Start a fresh window on first entry and clear it once the current
  // synchronous task finishes. A genuinely infinite loop never yields, so the
  // timeout never runs and the elapsed check below still halts it. A loop that
  // merely runs again each frame/tick (animation, game, timer) yields between
  // runs, so its window resets and it is never mistaken for a hang. The old
  // 100ms-gap heuristic accumulated across those runs and threw on valid code.
  if (!e) { s[id] = { start: n }; setTimeout(function () { delete s[id]; }, 0); return; }
  if (n - e.start > 1500) throw new Error("Infinite loop detected! Script halted to protect your browser.");
};
`;

// Comments stripped and lines joined (the function has no statement that
// relies on a newline), so the injected tag adds no lines.
const INJECTED_FUNCTION_ONE_LINE = INJECTED_FUNCTION
  .split('\n')
  .map((line) => line.replace(/^\s*\/\/.*$/, '').trim())
  .filter(Boolean)
  .join(' ');

const walk = (node, visitor) => {
  if (!node || typeof node !== 'object') return;
  visitor(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const c of child) walk(c, visitor);
    } else if (child && typeof child === 'object') {
      walk(child, visitor);
    }
  }
};

export const injectLoopProtection = (html) => {
  if (!html || typeof html !== 'string') return html;

  const scripts = extractInlineScripts(html);
  if (!scripts.length) return html;

  // Process scripts from last to first so that modifications
  // to the html string don't invalidate earlier start/end offsets.
  scripts.reverse();

  let transformedHtml = html;
  let hasInjectedFunction = false;
  let loopCounter = 1;

  for (const block of scripts) {
    if (block.unclosed || !block.code) continue;

    let ast;
    try {
      ast = acorn.parse(block.code, {
        ecmaVersion: 'latest',
        sourceType: block.type === 'module' ? 'module' : 'script',
        locations: true
      });
    } catch {
      // If parsing fails (e.g., JSX which we don't support, or syntax errors),
      // skip loop protection for this block.
      continue;
    }

    const loops = [];
    walk(ast, (node) => {
      if (['ForStatement', 'WhileStatement', 'DoWhileStatement', 'ForInStatement', 'ForOfStatement'].includes(node.type)) {
        loops.push(node);
      }
    });

    if (loops.length === 0) continue;
    hasInjectedFunction = true;

    // Every insertion is recorded against the ORIGINAL offsets and applied in
    // one pass, last first. Slicing loop by loop broke nested braceless loops
    // (`for(..)for(..){..}`): wrapping the inner one shifted the code, so the
    // outer one's stale body.end put its closing brace mid-statement and the
    // preview threw "Unexpected token '}'" on valid code. No newlines are
    // inserted, so runtime error line numbers still match the app's source.
    const inserts = [];
    for (const node of loops) {
      const checkStr = `window.__orion_loop_check(${loopCounter++});`;
      if (node.body.type === 'BlockStatement') {
        inserts.push({ at: node.body.start + 1, text: checkStr });
      } else {
        inserts.push({ at: node.body.start, text: '{' + checkStr });
        inserts.push({ at: node.body.end, text: '}' });
      }
    }
    inserts.sort((a, b) => b.at - a.at);

    let transformedCode = block.code;
    for (const { at, text } of inserts) {
      transformedCode = transformedCode.slice(0, at) + text + transformedCode.slice(at);
    }

    transformedHtml = transformedHtml.slice(0, block.startIdx) + transformedCode + transformedHtml.slice(block.endIdx);
  }

  if (hasInjectedFunction) {
    // Inject the helper function into the head or before the first script
    const headMatch = /<head\b[^>]*>/i.exec(transformedHtml);
    // One line, no trailing newline: the app's own lines keep their numbers.
    const tag = `<script>${INJECTED_FUNCTION_ONE_LINE}</script>`;
    if (headMatch) {
      transformedHtml = transformedHtml.slice(0, headMatch.index + headMatch[0].length) + tag + transformedHtml.slice(headMatch.index + headMatch[0].length);
    } else {
      transformedHtml = tag + transformedHtml;
    }
  }

  return transformedHtml;
};
