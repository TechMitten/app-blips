const JSON_FENCE_PATTERN = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;
const INSERT_POSITIONS = new Set(['beforebegin', 'afterbegin', 'beforeend', 'afterend']);
const ROOT_TARGET_TAGS = new Set(['HTML', 'HEAD', 'BODY']);
const LARGE_SCOPE_SAFE_TAGS = new Set(['STYLE', 'SCRIPT']);
const MAX_SCOPE_RATIO_BY_TYPE = {
  replace_element: 0.35,
  replace_inner_html: 0.45,
  remove_element: 0.25
};

const stripMarkdownFences = (value = '') => {
  const trimmed = value.trim();
  const fenced = trimmed.match(JSON_FENCE_PATTERN);
  return fenced ? fenced[1].trim() : trimmed;
};

const extractFirstJsonObject = (value) => {
  const input = stripMarkdownFences(value);
  let start = -1;
  let depth = 0;
  let inString = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const prevChar = input[i - 1];

    if (char === '"' && prevChar !== '\\') {
      inString = !inString;
    }

    if (inString) {
      continue;
    }

    if (char === '{') {
      if (start === -1) {
        start = i;
      }
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (start !== -1 && depth === 0) {
        return input.slice(start, i + 1);
      }
    }
  }

  return input.startsWith('{') && input.endsWith('}') ? input : null;
};

const ensureString = (value, fieldName, operationIndex) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Surgical edit ${operationIndex + 1} is missing a valid "${fieldName}" value.`);
  }
  return value;
};

const ensureObject = (value, fieldName, operationIndex) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Surgical edit ${operationIndex + 1} is missing a valid "${fieldName}" object.`);
  }
  return value;
};

const getOccurrence = (value) => {
  if (!Number.isInteger(value) || value < 0) {
    return 0;
  }
  return value;
};

const resolveTarget = (doc, operation, operationIndex) => {
  const selector = ensureString(operation.selector, 'selector', operationIndex);
  const matches = Array.from(doc.querySelectorAll(selector));
  const occurrence = getOccurrence(operation.occurrence);
  const target = matches[occurrence];

  if (!target) {
    throw new Error(
      `Surgical edit ${operationIndex + 1} could not find selector "${selector}" at occurrence ${occurrence}.`
    );
  }

  return target;
};

const validateOperationScope = (target, operation, operationIndex, originalHtml) => {
  const type = ensureString(operation.type, 'type', operationIndex);

  if (ROOT_TARGET_TAGS.has(target.tagName) && ['replace_element', 'replace_inner_html', 'remove_element'].includes(type)) {
    throw new Error(
      `Surgical edit ${operationIndex + 1} targets <${target.tagName.toLowerCase()}> too broadly. Use smaller selectors.`
    );
  }

  const maxRatio = MAX_SCOPE_RATIO_BY_TYPE[type];
  if (!maxRatio || LARGE_SCOPE_SAFE_TAGS.has(target.tagName)) {
    return;
  }

  const targetSize = type === 'replace_inner_html'
    ? target.innerHTML.length
    : target.outerHTML.length;
  const scopeRatio = targetSize / Math.max(originalHtml.length, 1);

  if (scopeRatio > maxRatio) {
    throw new Error(
      `Surgical edit ${operationIndex + 1} changes too much of the document at once (${Math.round(scopeRatio * 100)}%).`
    );
  }
};

const applyOperation = (doc, operation, operationIndex, originalHtml) => {
  const type = ensureString(operation.type, 'type', operationIndex);
  const target = resolveTarget(doc, operation, operationIndex);
  validateOperationScope(target, operation, operationIndex, originalHtml);

  switch (type) {
    case 'replace_element': {
      target.outerHTML = ensureString(operation.html, 'html', operationIndex);
      return;
    }
    case 'replace_inner_html': {
      target.innerHTML = ensureString(operation.html, 'html', operationIndex);
      return;
    }
    case 'insert_html': {
      const position = ensureString(operation.position, 'position', operationIndex);
      if (!INSERT_POSITIONS.has(position)) {
        throw new Error(`Surgical edit ${operationIndex + 1} has an invalid insert position "${position}".`);
      }
      target.insertAdjacentHTML(position, ensureString(operation.html, 'html', operationIndex));
      return;
    }
    case 'set_attribute': {
      const name = ensureString(operation.name, 'name', operationIndex);
      const value = typeof operation.value === 'string' ? operation.value : '';
      target.setAttribute(name, value);
      return;
    }
    case 'set_attributes': {
      const attributes = ensureObject(operation.attributes, 'attributes', operationIndex);
      Object.entries(attributes).forEach(([name, value]) => {
        target.setAttribute(name, typeof value === 'string' ? value : String(value ?? ''));
      });
      return;
    }
    case 'remove_attribute': {
      target.removeAttribute(ensureString(operation.name, 'name', operationIndex));
      return;
    }
    case 'remove_attributes': {
      const names = Array.isArray(operation.names) ? operation.names : null;
      if (!names?.length) {
        throw new Error(`Surgical edit ${operationIndex + 1} is missing a valid "names" array.`);
      }
      names.forEach((name) => {
        target.removeAttribute(ensureString(name, 'names[]', operationIndex));
      });
      return;
    }
    case 'set_text': {
      target.textContent = typeof operation.text === 'string' ? operation.text : '';
      return;
    }
    case 'remove_element': {
      target.remove();
      return;
    }
    default:
      throw new Error(`Unsupported surgical edit operation type "${type}".`);
  }
};

const serializeDocument = (doc, originalHtml) => {
  const html = doc.documentElement?.outerHTML?.trim();
  if (!html) {
    throw new Error('Failed to serialize updated HTML document.');
  }

  return /<!doctype/i.test(originalHtml)
    ? `<!DOCTYPE html>\n${html}`
    : html;
};

export const parseSurgicalEditResponse = (rawText) => {
  const jsonText = extractFirstJsonObject(rawText);
  if (!jsonText) {
    throw new Error('Model did not return a JSON surgical edit plan.');
  }

  const parsed = JSON.parse(jsonText);
  if (parsed?.mode === 'full-rewrite') {
    return {
      mode: 'full-rewrite',
      summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
      html: ensureString(parsed.html, 'html', 0)
    };
  }

  if (!Array.isArray(parsed?.operations)) {
    throw new Error('Model did not return an "operations" array for surgical edits.');
  }

  return {
    mode: 'surgical-edit',
    summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
    operations: parsed.operations
  };
};

export const applySurgicalEdits = (originalHtml, editPlan) => {
  if (!Array.isArray(editPlan?.operations) || editPlan.operations.length === 0) {
    throw new Error('Surgical edit plan did not contain any operations.');
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(originalHtml, 'text/html');

  editPlan.operations.forEach((operation, index) => {
    applyOperation(doc, operation, index, originalHtml);
  });

  return serializeDocument(doc, originalHtml);
};
