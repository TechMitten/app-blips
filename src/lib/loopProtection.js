import * as acorn from 'acorn';
import { extractInlineScripts } from './syntaxCheck.js';

const INJECTED_FUNCTION = `
window.__orion_loop_check = function(id) {
  var s = window.__orion_loop_state = window.__orion_loop_state || {};
  var n = Date.now();
  if (!s[id] || n - s[id].last > 100) { s[id] = { start: n, last: n }; }
  else {
    s[id].last = n;
    if (n - s[id].start > 1500) throw new Error("Infinite loop detected! Script halted to protect your browser.");
  }
};
`;

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

    // Sort loops in this block descending by start to safely slice strings
    loops.sort((a, b) => b.start - a.start);

    let transformedCode = block.code;
    for (const node of loops) {
      const loopId = loopCounter++;
      const checkStr = `window.__orion_loop_check(${loopId});\n`;
      
      if (node.body.type === 'BlockStatement') {
        transformedCode = transformedCode.slice(0, node.body.start + 1) + checkStr + transformedCode.slice(node.body.start + 1);
      } else {
        transformedCode = transformedCode.slice(0, node.body.start) + '{' + checkStr + transformedCode.slice(node.body.start, node.body.end) + '}' + transformedCode.slice(node.body.end);
      }
    }

    transformedHtml = transformedHtml.slice(0, block.startIdx) + transformedCode + transformedHtml.slice(block.endIdx);
  }

  if (hasInjectedFunction) {
    // Inject the helper function into the head or before the first script
    const headMatch = /<head\b[^>]*>/i.exec(transformedHtml);
    const tag = `<script>${INJECTED_FUNCTION}</script>\n`;
    if (headMatch) {
      transformedHtml = transformedHtml.slice(0, headMatch.index + headMatch[0].length) + tag + transformedHtml.slice(headMatch.index + headMatch[0].length);
    } else {
      transformedHtml = tag + transformedHtml;
    }
  }

  return transformedHtml;
};
