// Tool execution and validation for multi-page websites. Kept separate from
// llm.js (which pulls in Firebase) so it can be unit-tested with plain node.
import { applySurgicalEdits, listSections, viewCode } from './edits.js';
import { checkSyntax } from './syntaxCheck.js';
import {
  LANDING_PAGE, MAX_PAGES, checkFilesLimits, findBrokenLinks, pageNames, pageTitle, validatePageName,
} from './pages.js';

const looksLikeDocument = (html) => typeof html === 'string' && /<html[\s>]|<!doctype html/i.test(html);

// Runs one tool call against the site's files. Returns the (possibly updated)
// files, whether anything changed, and the JSON-able result reported back to
// the model. Never mutates the input map.
export const executeFilesTool = (files, toolCall) => {
  const name = toolCall.function?.name;
  let args;
  try {
    args = JSON.parse(toolCall.function?.arguments || '{}');
  } catch (e) {
    return { files, applied: false, result: { success: false, error: `Arguments were not valid JSON: ${e.message}` } };
  }
  const fail = (error) => ({ files, applied: false, result: { success: false, error } });
  const pages = pageNames(files);

  if (name === 'list_pages') {
    return {
      files,
      applied: false,
      result: {
        success: true,
        pages: pages.map((p) => ({ name: p, title: pageTitle(files[p]), chars: files[p].length, landing: p === LANDING_PAGE })),
      },
    };
  }

  if (name === 'create_page') {
    const pageName = args.name;
    if (!validatePageName(pageName)) return fail(`Invalid page name "${pageName}". Use lowercase letters, digits and hyphens ending in .html.`);
    if (pageName === LANDING_PAGE || pageName in files) return fail(`Page "${pageName}" already exists. Use apply_surgical_edits with file: "${pageName}" to change it.`);
    if (pages.length >= MAX_PAGES) return fail(`A site can have at most ${MAX_PAGES} pages.`);
    if (!looksLikeDocument(args.html)) return fail('html must be a complete HTML document beginning at <!DOCTYPE html>.');
    const next = { ...files, [pageName]: args.html.trim() };
    const limit = checkFilesLimits(next);
    if (limit) return fail(limit);
    return { files: next, applied: true, result: { success: true, created: pageName } };
  }

  if (name === 'delete_page') {
    const pageName = args.name;
    if (pageName === LANDING_PAGE) return fail('The landing page (index.html) cannot be deleted.');
    if (!(pageName in files)) return fail(`No page named "${pageName}". Existing pages: ${pages.join(', ')}.`);
    const next = { ...files };
    delete next[pageName];
    const linkedFrom = findBrokenLinks(next).filter((b) => b.target === pageName).map((b) => b.page);
    return {
      files: next,
      applied: true,
      result: {
        success: true,
        deleted: pageName,
        ...(linkedFrom.length ? { warning: `These pages still link to ${pageName}; remove or retarget the links: ${[...new Set(linkedFrom)].join(', ')}.` } : {}),
      },
    };
  }

  if (name === 'list_sections' || name === 'view_code' || name === 'apply_surgical_edits') {
    const file = args.file || LANDING_PAGE;
    if (!(file in files)) return fail(`No page named "${file}". Existing pages: ${pages.join(', ')}.`);
    const code = files[file];
    if (name === 'list_sections') return { files, applied: false, result: { success: true, file, sections: listSections(code) } };
    if (name === 'view_code') return { files, applied: false, result: { file, ...viewCode(code, args) } };
    const result = applySurgicalEdits(code, args.edits);
    if (!result.success) return { files, applied: false, result: { file, ...result } };
    const next = { ...files, [file]: result.code };
    const limit = checkFilesLimits(next);
    if (limit) return fail(limit);
    return { files: next, applied: true, result: { file, ...result } };
  }

  return fail(`Unknown tool: ${name}`);
};

// Syntax-checks every page. Errors from pages other than the landing page are
// prefixed with the filename so the model knows which `file` to edit.
export const checkSyntaxFiles = (files) => {
  const errors = [];
  for (const name of pageNames(files)) {
    for (const err of checkSyntax(files[name]).errors) {
      errors.push(name === LANDING_PAGE ? err : { ...err, message: `[${name}] ${err.message}` });
    }
  }
  return { errors };
};

export const buildBrokenLinkInstruction = (broken) => {
  const targets = [...new Set(broken.map((b) => b.target))];
  return `Some pages link to pages that do not exist: ${broken.map((b) => `${b.page} -> ${b.target}`).join(', ')}. For each missing page (${targets.join(', ')}), either create it with create_page or retarget/remove the link with apply_surgical_edits (pass the file parameter).`;
};
