import { auth } from '../firebase';
import { applySurgicalEdits, listSections, viewCode, sanitizeHtmlResponse, extractLeadingReply } from './edits';
import { checkSyntax } from './syntaxCheck';
import {
  HTML_SYSTEM_PROMPT,
  SURGICAL_EDIT_TOOL,
  SUGGESTIONS_SYSTEM_PROMPT,
  SUGGEST_NEXT_STEPS_TOOL,
  STARTER_IDEAS_SYSTEM_PROMPT,
  GENERATE_STARTER_IDEAS_TOOL,
  REFINEMENT_TOOLS,
  VIEW_CODE_TOOL,
  LIST_SECTIONS_TOOL,
  ASK_CLARIFYING_QUESTIONS_TOOL,
  buildInitialGenerationPrompt,
  buildSuggestionsPrompt,
  buildSyntaxRepairInstruction
} from './prompts';

// --- API Helper with Exponential Backoff ---
export const requestModelText = async ({
  messages,
  onChunk = null,
  tools = null,
  tool_choice = null,
  reasoningEffort = null,
  retryCount = 0,
  signal = null
}) => {
  const delays = [1000, 2000, 4000, 8000, 16000];

  try {
    const user = auth.currentUser;
    if (!user) throw new Error('Sign in required.');
    const token = await user.getIdToken();

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };

    const bodyObj = {
      stream: !!onChunk,
      messages
    };

    if (reasoningEffort !== null) bodyObj.reasoning_effort = reasoningEffort;
    if (tools) bodyObj.tools = tools;
    if (tool_choice) bodyObj.tool_choice = tool_choice;

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyObj),
      signal
    });

    if (response.status === 401) throw new Error('Your session has expired. Please sign in again.');
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const err = new Error(retryAfter
        ? `You're sending requests too quickly. Please try again in about ${retryAfter}s.`
        : "You're sending requests too quickly. Please slow down and try again shortly.");
      err.isRateLimit = true;
      throw err;
    }
    if (!response.ok) throw new Error(`API Error: ${response.status}`);

    if (!onChunk) {
      const data = await response.json();
      return data.choices[0].message;
    }

    // Streaming implementation
    const STREAM_READ_TIMEOUT_MS = 180000;

    let text = '';
    let toolCallsBuffer = [];
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const readWithTimeout = async () => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const readPromise = reader.read();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Stream stalled: no data received for ' + (STREAM_READ_TIMEOUT_MS / 1000) + 's')), STREAM_READ_TIMEOUT_MS)
      );
      return await Promise.race([readPromise, timeoutPromise]);
    };

    let isDone = false;
    while (!isDone) {
      const { done, value } = await readWithTimeout();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith('data: ')) {
          const data = trimmedLine.slice(6);
          if (data === '[DONE]') {
            isDone = true;
            break;
          }
          try {
            const json = JSON.parse(data);
            const delta = json.choices[0]?.delta;
            
            if (delta?.content) {
              text += delta.content;
              onChunk(delta.content, 'content');
            }

            if (delta?.reasoning_content) {
              // Thinking tokens never become code. Reported only so the UI can
              // flip to a "thinking" indicator instead of looking frozen during
              // long reasoning -- the token text itself is discarded.
              onChunk(delta.reasoning_content, 'reasoning');
            }

            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? (tc.id ? toolCallsBuffer.length : Math.max(0, toolCallsBuffer.length - 1));
                if (!toolCallsBuffer[idx]) toolCallsBuffer[idx] = { id: tc.id, type: 'function', function: { name: tc.function?.name, arguments: '' } };
                if (tc.function?.arguments) toolCallsBuffer[idx].function.arguments += tc.function.arguments;
              }
            }
          } catch { /* ignore */ }
        }
      }
    }

    return { content: text, tool_calls: toolCallsBuffer.filter(Boolean) };
  } catch (err) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (retryCount < delays.length && err.name !== 'AbortError' && !err.isRateLimit) {
      await new Promise(r => setTimeout(r, delays[retryCount]));
      return requestModelText({
        messages, onChunk, tools, tool_choice, retryCount: retryCount + 1, signal
      });
    }
    throw new Error(err.message || 'Failed to generate app.');
  }
};

export const MAX_REFINEMENT_TURNS = 8;
export const MAX_SYNTAX_REPAIR_ATTEMPTS = 2;

export const describeToolCall = (toolCall) => {
  const name = toolCall.function?.name;
  let args = {};
  try { args = JSON.parse(toolCall.function?.arguments || '{}'); } catch { /* ignore, use defaults below */ }

  if (name === 'list_sections') return 'Listing sections...';
  if (name === 'view_code') {
    return args.section ? `Inspecting section "${args.section}"...` : `Inspecting lines ${args.start_line ?? '?'}-${args.end_line ?? '?'}...`;
  }
  if (name === 'apply_surgical_edits') {
    const count = Array.isArray(args.edits) ? args.edits.length : 1;
    return `Applying ${count} edit${count === 1 ? '' : 's'}...`;
  }
  return `Calling ${name}...`;
};

// Executes one tool call against workingCode. Returns the (possibly updated) code plus
// the JSON-able result to report back to the model as a tool message.
export const executeRefinementTool = (workingCode, toolCall) => {
  const name = toolCall.function?.name;
  let args;
  try {
    args = JSON.parse(toolCall.function?.arguments || '{}');
  } catch (e) {
    return { code: workingCode, applied: false, result: { success: false, error: `Arguments were not valid JSON: ${e.message}` } };
  }

  if (name === 'list_sections') {
    return { code: workingCode, applied: false, result: { success: true, sections: listSections(workingCode) } };
  }
  if (name === 'view_code') {
    return { code: workingCode, applied: false, result: viewCode(workingCode, args) };
  }
  if (name === 'apply_surgical_edits') {
    const result = applySurgicalEdits(workingCode, args.edits);
    return { code: result.success ? result.code : workingCode, applied: result.success, result };
  }
  return { code: workingCode, applied: false, result: { success: false, error: `Unknown tool: ${name}` } };
};

export const generateAppCode = async (
  prompt,
  currentCode = null,
  chatHistory = [],
  onChunk = null,
  layoutTarget = 'both',
  signal = null,
  isAskMode = false,
  askClarifyingQuestions = true
) => {
  if (isAskMode && currentCode) {
    const messages = [
      { role: 'system', content: 'You are a helpful coding assistant. The user is asking a question about their current app code. Answer the question directly and concisely. Do NOT generate or output the full HTML code. Provide a plain-text or markdown answer.' },
      ...chatHistory,
      { role: 'user', content: `Current App Code:\n\`\`\`html\n${currentCode}\n\`\`\`\n\nQuestion: ${prompt}` }
    ];
    const message = await requestModelText({ messages, onChunk, signal });
    const rawText = (message.content || message).trim();
    return {
      code: currentCode,
      editMode: 'ask',
      editSummary: prompt,
      reply: rawText
    };
  }

  if (!currentCode) {
    const formattedChatHistory = chatHistory.map((msg, idx) => {
      if (idx === 0 && msg.role === 'user') {
        return { ...msg, content: buildInitialGenerationPrompt(msg.content, layoutTarget) };
      }
      return msg;
    });

    const messages = [
      { role: 'system', content: HTML_SYSTEM_PROMPT },
      ...formattedChatHistory,
      { role: 'user', content: chatHistory.length > 0 ? prompt : buildInitialGenerationPrompt(prompt, layoutTarget) }
    ];
    
    const tools = askClarifyingQuestions ? [ASK_CLARIFYING_QUESTIONS_TOOL] : undefined;
    const message = await requestModelText({ messages, onChunk, tools, signal });
    
    if (message.tool_calls && message.tool_calls.length > 0) {
      const clarifyTool = message.tool_calls.find(t => t.function?.name === 'ask_clarifying_questions');
      if (clarifyTool) {
        let args;
        try {
          args = JSON.parse(clarifyTool.function.arguments);
        } catch {
          args = { question: "Could you clarify what you mean?" };
        }
        
        let q = args?.question || args?.questions?.[0] || "Could you clarify what you mean?";
        if (typeof q === 'object' && q !== null) q = q.question || Object.values(q)[0] || JSON.stringify(q);
        q = String(q).trim() || "Could you clarify what you mean?";

        return {
          code: currentCode || '',
          editMode: 'clarify',
          editSummary: prompt,
          reply: q
        };
      }
    }

    const rawText = message.content || message;
    let code = sanitizeHtmlResponse(rawText);
    const reply = extractLeadingReply(rawText) || undefined;

    // End-of-generation syntax gate: parse the finished document, and if it
    // doesn't parse, feed the errors back for correction. Repair requests use
    // surgical edits so we don't regenerate the entire document.
    let check = checkSyntax(code);
    if (check.errors.length) {
      let repairMessages = [
        { role: 'system', content: HTML_SYSTEM_PROMPT },
        { role: 'user', content: `Current App Code:\n\`\`\`html\n${code}\n\`\`\`\n\nTask: ${buildSyntaxRepairInstruction(check.errors)}` }
      ];

      for (let repairs = 0; check.errors.length && repairs < MAX_SYNTAX_REPAIR_ATTEMPTS; repairs++) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        if (onChunk) onChunk('Syntax errors found — fixing…', 'status');
        
        let repairMessage;
        try {
          repairMessage = await requestModelText({
            messages: repairMessages,
            tools: REFINEMENT_TOOLS,
            tool_choice: 'auto',
            signal
          });
        } catch {
          repairMessage = await requestModelText({
            messages: repairMessages,
            tools: REFINEMENT_TOOLS,
            tool_choice: { type: 'function', function: { name: 'apply_surgical_edits' } },
            signal
          });
        }

        repairMessages.push({
          role: 'assistant',
          content: repairMessage.content || null,
          tool_calls: repairMessage.tool_calls?.length ? repairMessage.tool_calls : undefined
        });

        if (!repairMessage.tool_calls || repairMessage.tool_calls.length === 0) {
          break; // Exit if model didn't use any tools
        }

        let editsApplied = false;
        let nextCode = code;
        for (const toolCall of repairMessage.tool_calls) {
          if (toolCall.function?.name === 'ask_clarifying_questions') continue;
          if (onChunk) onChunk(describeToolCall(toolCall), 'status');
          const result = executeRefinementTool(nextCode, toolCall);
          nextCode = result.code;
          if (result.applied) editsApplied = true;
          repairMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result.result) });
        }

        if (editsApplied) {
          code = nextCode;
          check = checkSyntax(code);
          if (check.errors.length) {
            repairMessages.push({ role: 'user', content: buildSyntaxRepairInstruction(check.errors) });
          }
        } else {
          repairMessages.push({ role: 'user', content: 'You must call a tool (apply_surgical_edits, view_code, or list_sections) to make progress on the task.' });
        }
      }
    }

    return {
      code,
      editMode: 'full-generation',
      editSummary: 'Initial app generation.',
      reply,
      ...(check.errors.length ? { syntaxErrors: check.errors } : {})
    };
  }

  // REFINEMENT MODE: multi-turn agentic tool-use loop. The model can inspect the code
  // (view_code / list_sections) and apply edits (apply_surgical_edits) across several
  // turns in one conversation, self-correcting from real tool-result errors instead of
  // blindly restarting from scratch each attempt.
  const messages = [
    { role: 'system', content: HTML_SYSTEM_PROMPT },
    ...chatHistory,
    {
      role: 'user',
      content: `Current App Code:\n\`\`\`html\n${currentCode}\n\`\`\`\n\nTask: ${prompt}. Use apply_surgical_edits to update the app. If you're unsure a search string is unique, call list_sections or view_code first, or set occurrence/replace_all explicitly.`
    }
  ];

  let workingCode = currentCode;
  let editsApplied = false;
  let nudged = false;
  let replyParts = [];
  let syntaxErrors = [];
  let syntaxRepairCycles = 0;

  const nudgeSyntaxRepair = () => {
    syntaxRepairCycles++;
    if (onChunk) onChunk('Syntax errors found — fixing…', 'status');
    messages.push({ role: 'user', content: buildSyntaxRepairInstruction(syntaxErrors) });
  };

  const syntaxResultFields = () =>
    syntaxErrors.length ? { syntaxErrors } : {};

  for (let turn = 1; turn <= MAX_REFINEMENT_TURNS; turn++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const currentTools = askClarifyingQuestions && !editsApplied && turn === 1 
      ? [...REFINEMENT_TOOLS, ASK_CLARIFYING_QUESTIONS_TOOL] 
      : REFINEMENT_TOOLS;

    let message;
    try {
      message = await requestModelText({
        messages,
        onChunk,
        tools: currentTools,
        tool_choice: turn === 1 && !askClarifyingQuestions ? 'required' : 'auto',
        signal
      });
    } catch (e) {
      if (turn !== 1 || signal?.aborted) throw e;
      // Some OpenAI-compatible backends don't support tool_choice: 'required' — fall back
      // to forcing the one edit tool by name, matching the old always-forced behavior.
      message = await requestModelText({
        messages,
        onChunk,
        tools: currentTools,
        tool_choice: { type: 'function', function: { name: 'apply_surgical_edits' } },
        signal
      });
    }

    if (message.content && message.content.trim()) {
      replyParts.push(message.content.trim());
    }

    messages.push({
      role: 'assistant',
      content: message.content || null,
      tool_calls: message.tool_calls?.length ? message.tool_calls : undefined
    });

    if (!message.tool_calls || message.tool_calls.length === 0) {
      if (editsApplied) {
        if (syntaxErrors.length && syntaxRepairCycles < MAX_SYNTAX_REPAIR_ATTEMPTS) {
          nudgeSyntaxRepair();
          continue;
        }
        return { code: workingCode, editMode: 'surgical', editSummary: prompt, reply: replyParts.join(' ').trim() || undefined, ...syntaxResultFields() };
      }
      if (nudged) throw new Error('Model did not use any tool to make the requested edit.');
      nudged = true;
      messages.push({ role: 'user', content: 'You must call a tool (apply_surgical_edits, view_code, or list_sections) to make progress on the task.' });
      continue;
    }

    for (const toolCall of message.tool_calls) {
      if (toolCall.function?.name === 'ask_clarifying_questions') {
        let args;
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch {
          args = { question: "Could you clarify what you mean?" };
        }
        
        let q = args?.question || args?.questions?.[0] || "Could you clarify what you mean?";
        if (typeof q === 'object' && q !== null) q = q.question || Object.values(q)[0] || JSON.stringify(q);
        q = String(q).trim() || "Could you clarify what you mean?";

        return {
          code: workingCode,
          editMode: 'clarify',
          editSummary: prompt,
          reply: q,
          ...(syntaxErrors.length ? { syntaxErrors } : {})
        };
      }

      if (onChunk) onChunk(describeToolCall(toolCall), 'status');
      const { code: nextCode, applied, result } = executeRefinementTool(workingCode, toolCall);
      workingCode = nextCode;
      if (applied) editsApplied = true;
      messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) });
    }

    // After every edit-applying turn, parse the working code; if it no longer
    // parses, inject the errors as corrective context and let the model fix
    // them with the same tools before the loop is allowed to finish.
    if (editsApplied) {
      syntaxErrors = checkSyntax(workingCode).errors;
      if (syntaxErrors.length && syntaxRepairCycles < MAX_SYNTAX_REPAIR_ATTEMPTS) {
        syntaxRepairCycles++;
        if (onChunk) onChunk('Syntax errors found — fixing…', 'status');
        
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.role === 'tool') {
          try {
            const parsed = JSON.parse(lastMsg.content);
            parsed.syntaxErrors = syntaxErrors;
            parsed.instruction = buildSyntaxRepairInstruction(syntaxErrors);
            lastMsg.content = JSON.stringify(parsed);
          } catch {
            messages.push({ role: 'user', content: buildSyntaxRepairInstruction(syntaxErrors) });
          }
        } else {
          messages.push({ role: 'user', content: buildSyntaxRepairInstruction(syntaxErrors) });
        }
      }
    }
  }

  if (editsApplied) {
    syntaxErrors = checkSyntax(workingCode).errors;
    return { code: workingCode, editMode: 'surgical', editSummary: prompt, reply: replyParts.join(' ').trim() || undefined, ...syntaxResultFields() };
  }
  throw new Error(`Failed to apply updates after ${MAX_REFINEMENT_TURNS} turns.`);
};

export const generateContextualSuggestions = async ({ code, versions, projectName, signal }) => {
  try {
    const messages = [
      { role: 'system', content: SUGGESTIONS_SYSTEM_PROMPT },
      { role: 'user', content: buildSuggestionsPrompt(code, versions, projectName) }
    ];

    const message = await requestModelText({
      messages,
      tools: [SUGGEST_NEXT_STEPS_TOOL],
      tool_choice: { type: 'function', function: { name: 'return_suggestions' } },
      signal
    });

    const toolCall = message.tool_calls?.[0];
    if (!toolCall) return [];

    let args;
    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch {
      return [];
    }

    if (!Array.isArray(args.suggestions)) return [];

    return args.suggestions
      .map((s) => (typeof s === 'string' ? s.trim() : ''))
      .filter(Boolean)
      .slice(0, 4);
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    console.warn('[Orion] Failed to generate contextual suggestions:', err);
    return [];
  }
};

export const generateNewStarterIdeas = async ({ signal }) => {
  const messages = [
    { role: 'system', content: STARTER_IDEAS_SYSTEM_PROMPT },
    { role: 'user', content: "Generate 7 new starter app ideas." }
  ];

  const message = await requestModelText({
    messages,
    tools: [GENERATE_STARTER_IDEAS_TOOL],
    tool_choice: { type: 'function', function: { name: 'return_starter_ideas' } },
    reasoningEffort: 'none',
    signal
  });

  const toolCall = message.tool_calls?.[0];
  if (!toolCall) return null;

  let args;
  try {
    args = JSON.parse(toolCall.function.arguments);
  } catch {
    return null;
  }

  if (!Array.isArray(args.ideas)) return null;
  return args.ideas;
};
