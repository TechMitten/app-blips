// The AI edit loop for imported codebases. Follows the refinement loop in
// ../llm.js (tool calls against an in-memory copy, bounded turns) but with
// codebase tools, and after every turn that changed files it runs a real
// build check (the preview bundler) and feeds errors back for repair.
import { generateChatReply, generateCompletionReply, requestModelText } from '../llm.js';
import { CODEBASE_READ_TOOLS, CODEBASE_TOOLS, describeCodebaseToolCall, executeCodebaseTool } from './tools.js';
import { CODEBASE_ASK_PROMPT, CODEBASE_SYSTEM_PROMPT, buildRepairInstruction, formatCodebaseContext } from './prompts.js';

export const MAX_CODEBASE_TURNS = 20;
export const MAX_CODEBASE_ASK_TURNS = 8;
export const MAX_BUILD_REPAIRS = 3;

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
//   isAsk, isAutoFix, buildCheck(files, assets) -> Promise<{ errors }> }
// Returns { files, assets, editMode, editSummary, reply, buildErrors }.
export async function generateCodebaseEdit({
  prompt, files, assets = {}, meta, chatHistory = [], onChunk = null, signal = null,
  attachment = null, isAsk = false, isAutoFix = false, buildCheck,
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
    }
  }

  let changed = false;
  let nudged = false;
  let repairs = 0;
  let buildErrors = [];
  const replyParts = [];

  const runBuildCheck = async () => {
    if (!buildCheck) return [];
    status('Checking that the project still builds…');
    try {
      const result = await buildCheck(state.files, state.assets);
      return result?.errors || [];
    } catch (err) {
      return [{ message: String(err?.message || err) }];
    }
  };

  for (let turn = 1; turn <= MAX_CODEBASE_TURNS; turn++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (turn === 1) status('Looking through your site\'s files…');
    const message = await requestModelText({
      messages,
      onChunk: forwardChunks(onChunk),
      tools: CODEBASE_TOOLS,
      tool_choice: turn === 1 ? 'required' : 'auto',
      signal,
      forceTemperatureZero: true,
      reasoningEffort: 'none',
    });
    if (message.content?.trim()) replyParts.push(message.content.trim());
    messages.push(assistantTurn(message));

    if (!message.tool_calls?.length) {
      if (!changed) {
        if (nudged) throw new Error('The AI did not make any change to the project.');
        nudged = true;
        messages.push({ role: 'user', content: 'Use the tools to make the requested change (search_files / read_file, then apply_surgical_edits or create_file).' });
        continue;
      }
      buildErrors = await runBuildCheck();
      if (buildErrors.length && repairs < MAX_BUILD_REPAIRS) {
        repairs++;
        status('Fixing build errors…');
        messages.push({ role: 'user', content: buildRepairInstruction(buildErrors) });
        continue;
      }
      break;
    }

    let changedThisTurn = false;
    for (const toolCall of message.tool_calls) {
      status(describeCodebaseToolCall(toolCall));
      const outcome = executeCodebaseTool(state, toolCall);
      state = outcome.state;
      if (outcome.applied) { changed = true; changedThisTurn = true; }
      messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(outcome.result) });
    }
    if (changedThisTurn) {
      buildErrors = await runBuildCheck();
      if (buildErrors.length && repairs < MAX_BUILD_REPAIRS) {
        repairs++;
        messages.push({ role: 'user', content: buildRepairInstruction(buildErrors) });
      }
    }
  }

  if (!changed) throw new Error('The AI did not make any change to the project.');

  let reply = [intro, replyParts.join(' ').trim()].filter(Boolean).join('\n\n');
  if (!isAutoFix && !replyParts.length) {
    status('Writing a summary of the changes…');
    const completion = await generateCompletionReply({ prompt, editMode: 'surgical', studioMode: 'codebase', signal });
    onChunk?.(`${intro ? '\n\n' : ''}${completion}`, 'reply');
    reply = [intro, completion].filter(Boolean).join('\n\n');
  } else if (replyParts.length) {
    onChunk?.(`${intro ? '\n\n' : ''}${replyParts.join(' ').trim()}`, 'reply');
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
