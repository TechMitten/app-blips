// The AI edit loop for imported codebases. Follows the refinement loop in
// ../llm.js (tool calls against an in-memory copy, bounded turns) but with
// codebase tools, and after every turn that changed files it runs a real
// build check (the preview bundler) and feeds errors back for repair.
import { generateChatReply, generateCompletionReply, requestModelText } from '../llm.js';
import { CODEBASE_READ_TOOLS, CODEBASE_TOOLS, describeCodebaseToolCall, executeCodebaseTool } from './tools.js';
import { CODEBASE_ASK_PROMPT, CODEBASE_SYSTEM_PROMPT, buildRepairInstruction, formatCodebaseContext } from './prompts.js';
import { changedProjectPaths, createCodebaseDiagnostics, toolDiagnostic } from './diagnostics.js';

export const MAX_CODEBASE_TURNS = 20;
export const MAX_CODEBASE_ASK_TURNS = 8;
export const MAX_BUILD_REPAIRS = 3;
const MAX_EDIT_RECOVERIES = 3;
const MUTATION_TOOLS = new Set(['apply_surgical_edits', 'apply_file_changes', 'create_file', 'delete_file']);

function mutationPaths(toolCall) {
  try {
    const args = JSON.parse(toolCall.function.arguments);
    const paths = toolCall.function.name === 'apply_file_changes'
      ? args.changes?.map((change) => change?.path) : [args.file || args.path];
    return (paths || []).filter((path) => typeof path === 'string' && path.trim())
      .map((path) => path.trim().replace(/^\.\//, ''));
  } catch { return []; }
}

function sameMap(a, b) {
  const paths = Object.keys(a);
  return paths.length === Object.keys(b).length && paths.every((path) => a[path] === b[path]);
}

const userContent = (text, attachment) => (attachment?.dataUrl
  ? [{ type: 'text', text }, { type: 'image_url', image_url: { url: attachment.dataUrl } }]
  : text);

const assistantTurn = (message) => {
  const turn = { role: 'assistant', content: message.content || null };
  for (const field of ['reasoning_content', 'reasoning', 'reasoning_details']) {
    if (message[field]?.length) turn[field] = message[field];
  }
  if (message.tool_calls?.length) turn.tool_calls = message.tool_calls;
  return turn;
};

// Only status, reply and thinking markers reach the UI; streamed tool
// arguments are HTML-page specific there.
const forwardChunks = (onChunk) => (chunk, kind) => {
  if (!onChunk) return;
  if (kind === 'thinking_start' || kind === 'thinking_end' || kind === 'reasoning') onChunk(chunk, kind);
};

// opts: { prompt, files, assets, meta, chatHistory, onChunk, signal, attachment,
//   isAsk, isAutoFix, buildCheck(files, assets, { diagnostics }) -> Promise<{ errors }> }
// Returns { files, assets, editMode, editSummary, reply, buildErrors }.
export async function generateCodebaseEdit(options) {
  const diagnostics = createCodebaseDiagnostics(options.isAsk ? 'ask' : 'edit', {
    projectId: options.projectId, entry: options.meta?.entry, isAutoFix: Boolean(options.isAutoFix),
  });
  diagnostics.info('Started', {
    fileCount: Object.keys(options.files).length,
    assetCount: Object.keys(options.assets || {}).length,
    maxTurns: options.isAsk ? MAX_CODEBASE_ASK_TURNS : MAX_CODEBASE_TURNS,
    maxBuildRepairs: MAX_BUILD_REPAIRS,
  });
  try {
    const result = await runCodebaseEdit({ ...options, diagnostics });
    diagnostics.info('Completed', {
      changedFiles: changedProjectPaths(result.files, result.assets, options.files, options.assets || {}),
    });
    return result;
  } catch (error) {
    if (error?.name === 'AbortError') diagnostics.info('Cancelled');
    else diagnostics.error('Failed; previous version kept', { error });
    throw error;
  }
}

async function runCodebaseEdit({
  prompt, files, assets = {}, meta, chatHistory = [], onChunk = null, signal = null,
  attachment = null, isAsk = false, isAutoFix = false, buildCheck, diagnostics,
}) {
  const status = (text) => onChunk?.(text, 'status');
  const context = formatCodebaseContext(files, assets, meta);
  const messages = [
    { role: 'system', content: isAsk ? CODEBASE_ASK_PROMPT : CODEBASE_SYSTEM_PROMPT },
    ...chatHistory,
    { role: 'user', content: userContent(`${context}\n\n## Request\n${prompt}`, attachment) },
  ];
  let state = { files, assets };

  if (isAsk) {
    for (let turn = 1; turn <= MAX_CODEBASE_ASK_TURNS; turn++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const last = turn === MAX_CODEBASE_ASK_TURNS;
      let streamed = '';
      const message = await requestModelText({
        messages,
        tools: last ? null : CODEBASE_READ_TOOLS,
        signal,
        askMode: true,
        reasoningEffort: 'none',
        onChunk: (chunk, kind) => {
          if (kind !== 'content') return;
          streamed += chunk;
          onChunk?.(chunk, 'content');
        },
      });
      messages.push(assistantTurn(message));
      if (!message.tool_calls?.length) {
        return { ...state, editMode: 'ask', editSummary: prompt, reply: (streamed || message.content || '').trim() };
      }
      for (const toolCall of message.tool_calls) {
        status(describeCodebaseToolCall(toolCall));
        const allowed = CODEBASE_READ_TOOLS.some((t) => t.function.name === toolCall.function?.name);
        const { result } = allowed
          ? executeCodebaseTool(state, toolCall)
          : { result: { success: false, error: 'Read-only mode: this tool is not available.' } };
        messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) });
      }
    }
    return { ...state, editMode: 'ask', editSummary: prompt, reply: 'Sorry, I couldn\'t finish looking into that. Try asking a narrower question.' };
  }

  // A short acknowledgement first, so the chat responds while tools run.
  let intro = '';
  if (!isAutoFix) {
    try {
      intro = await generateChatReply({ prompt, currentCode: 'codebase', onChunk, signal, studioMode: 'codebase' });
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      diagnostics.warn('Acknowledgement failed; continuing edits', { error: err });
    }
  }

  let changed = false;
  let nudged = false;
  let repairs = 0;
  let buildErrors = [];
  let completionText = '';
  let completed = false;
  let editRecoveries = 0;
  const pendingFailures = new Map();
  let buildChecks = 0;

  const runBuildCheck = async () => {
    if (!buildCheck) {
      diagnostics.warn('Build check skipped: no checker supplied');
      return [];
    }
    status('Checking that the project still builds…');
    const buildCheckNumber = ++buildChecks;
    const started = performance.now();
    diagnostics.info('Build check started', {
      buildCheckNumber, repairs,
      changedFiles: changedProjectPaths(state.files, state.assets, files, assets),
    });
    try {
      const result = await buildCheck(state.files, state.assets, { diagnostics });
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const errors = result?.errors || [];
      diagnostics[errors.length ? 'error' : 'info'](errors.length ? 'Build check failed' : 'Build check passed', {
        buildCheckNumber, durationMs: Math.round(performance.now() - started), errors,
      });
      return errors;
    } catch (err) {
      if (err?.name === 'AbortError' || signal?.aborted) throw err;
      diagnostics.error('Build checker threw', { buildCheckNumber, error: err });
      return [{ message: String(err?.message || err) }];
    }
  };

  for (let turn = 1; turn <= MAX_CODEBASE_TURNS; turn++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (turn === 1) status('Looking through your site\'s files…');
    diagnostics.info('Requesting model turn', { turn, repairs, pendingFailures: [...pendingFailures.keys()] });
    const modelStarted = performance.now();
    const message = await requestModelText({
      messages,
      onChunk: forwardChunks(onChunk),
      tools: CODEBASE_TOOLS,
      tool_choice: turn === 1 ? 'required' : 'auto',
      signal,
      forceTemperatureZero: true,
      reasoningEffort: 'none',
    });
    diagnostics.info('Model turn received', {
      turn, durationMs: Math.round(performance.now() - modelStarted),
      tools: (message.tool_calls || []).map((call) => call.function?.name),
      finishReason: message.finish_reason,
    });
    messages.push(assistantTurn(message));

    if (!message.tool_calls?.length) {
      if (pendingFailures.size) {
        if (editRecoveries++ >= MAX_EDIT_RECOVERIES) {
          throw new Error('Some requested edits could not be applied. Your previous version has been kept. Try a more specific change.');
        }
        status('Retrying edits that did not apply…');
        diagnostics.warn('Retrying failed edits', { turn, editRecoveries, failures: [...pendingFailures.entries()] });
        messages.push({ role: 'user', content: `Some requested changes failed and must be retried before finishing. Read the current source and retry the failed operation:\n${[...new Set(pendingFailures.values())].join('\n')}` });
        continue;
      }
      if (!changed) {
        if (nudged) throw new Error('The AI did not make any change to the project.');
        nudged = true;
        diagnostics.warn('Model finished without changes; requesting edits', { turn });
        messages.push({ role: 'user', content: 'Use the tools to make the requested change (search_files / read_file, then apply_surgical_edits or apply_file_changes).' });
        continue;
      }
      if (buildErrors.length && repairs < MAX_BUILD_REPAIRS) {
        repairs++;
        status('Fixing build errors…');
        diagnostics.warn('Requesting build repair', { turn, repair: repairs, maxBuildRepairs: MAX_BUILD_REPAIRS, errors: buildErrors });
        messages.push({ role: 'user', content: buildRepairInstruction(buildErrors) });
        continue;
      }
      completionText = message.content?.trim() || '';
      completed = true;
      break;
    }

    let changedThisTurn = false;
    for (const toolCall of message.tool_calls) {
      status(describeCodebaseToolCall(toolCall));
      const outcome = executeCodebaseTool(state, toolCall);
      diagnostics[outcome.result.success === false ? 'warn' : 'info']('Tool result', { turn, ...toolDiagnostic(toolCall, outcome) });
      state = outcome.state;
      if (outcome.applied) { changed = true; changedThisTurn = true; }
      if (MUTATION_TOOLS.has(toolCall.function?.name)) {
        const paths = mutationPaths(toolCall);
        if (!outcome.result.success) {
          for (const path of paths.length ? paths : ['*']) pendingFailures.set(path, outcome.result.error);
        } else if (outcome.applied) {
          for (const path of paths) pendingFailures.delete(path);
          pendingFailures.delete('*');
        }
      }
      messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(outcome.result) });
    }
    if (changedThisTurn) {
      buildErrors = await runBuildCheck();
      if (buildErrors.length && repairs < MAX_BUILD_REPAIRS) {
        repairs++;
        diagnostics.warn('Requesting build repair', { turn, repair: repairs, maxBuildRepairs: MAX_BUILD_REPAIRS, errors: buildErrors });
        messages.push({ role: 'user', content: buildRepairInstruction(buildErrors) });
      } else if (buildErrors.length) {
        diagnostics.error('Build repair limit reached', { turn, repairs, maxBuildRepairs: MAX_BUILD_REPAIRS, errors: buildErrors });
      }
    }
  }

  if (pendingFailures.size) {
    throw new Error('Some requested edits could not be applied. Your previous version has been kept. Try a more specific change.');
  }
  if (!changed || (sameMap(files, state.files) && sameMap(assets, state.assets))) {
    throw new Error('The AI did not make any change to the project.');
  }
  // App.jsx saves every returned surgical result. Throw before returning if
  // repairs fail, so an invalid or partially applied attempt never becomes
  // the user's current version. The original maps were never mutated.
  if (buildErrors.length) {
    diagnostics.error('Unresolved build errors', { buildChecks, repairs, errors: buildErrors });
    const details = buildErrors.slice(0, 3).map((e) => e.message || e.text || 'Unknown build error').join('\n');
    throw new Error(`The edits could not pass the project build check. Your previous version has been kept.\n${details}`);
  }

  if (!completed) {
    diagnostics.error('Model turn limit reached', { maxTurns: MAX_CODEBASE_TURNS, buildChecks, repairs });
    throw new Error('The AI could not finish the requested changes in time. Your previous version has been kept. Try a smaller change.');
  }

  let reply = [intro, completionText].filter(Boolean).join('\n\n');
  if (!isAutoFix && !completionText) {
    status('Writing a summary of the changes…');
    const completion = await generateCompletionReply({ prompt, editMode: 'surgical', studioMode: 'codebase', signal });
    onChunk?.(`${intro ? '\n\n' : ''}${completion}`, 'reply');
    reply = [intro, completion].filter(Boolean).join('\n\n');
  } else if (completionText) {
    onChunk?.(`${intro ? '\n\n' : ''}${completionText}`, 'reply');
  }

  return {
    files: state.files,
    assets: state.assets,
    editMode: 'surgical',
    editSummary: prompt,
    reply: reply || undefined,
    buildErrors,
  };
}
