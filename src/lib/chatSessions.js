// Chat-session grouping for version history. A chat session is a run of
// consecutive turns that begins either at the project's first build or right
// after the user clicks "+ new chat" (which cuts the chat context without
// discarding versions). Every version records the id of the session it was
// created in (`sessionId`), so sessions survive truncation/undo-redo and can
// be re-derived by scanning the flat `versions` array. Pure helpers -- no
// React, no persistence.

let sessionSeq = 0;

export const newChatSessionId = () =>
  `cs-${Date.now().toString(36)}-${(sessionSeq += 1).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// Upgrades persisted projects to the session model. Legacy rows carry no
// `sessionId` on any version and at most one chat-context cutoff
// (`chatContextStartIndex`): everything before the cutoff was one session,
// everything from the cutoff on (plus the not-yet-used "new chat" itself,
// when the cutoff sits at the end) is the current session.
export function migrateChatSessions(versions, chatContextStartIndex, currentChatSessionId) {
  const list = Array.isArray(versions) ? versions : [];
  if (list.length === 0) {
    return { versions: list, currentChatSessionId: currentChatSessionId || newChatSessionId() };
  }
  if (list.every(v => v.sessionId)) {
    return {
      versions: list,
      currentChatSessionId: currentChatSessionId || list[list.length - 1].sessionId,
    };
  }
  const cutoff = Math.max(0, Math.min(chatContextStartIndex ?? 0, list.length));
  if (cutoff === 0) {
    const id = currentChatSessionId || newChatSessionId();
    return { versions: list.map(v => ({ ...v, sessionId: id })), currentChatSessionId: id };
  }
  const earlierId = newChatSessionId();
  const currentId = currentChatSessionId || newChatSessionId();
  return {
    versions: list.map((v, i) => ({ ...v, sessionId: i < cutoff ? earlierId : currentId })),
    currentChatSessionId: currentId,
  };
}

// Groups the flat versions array into contiguous chat sessions in
// chronological order: [{ id, start, end }] with inclusive indices. Versions
// missing a sessionId (shouldn't happen post-migration) are kept contiguous.
export function groupVersionsByChatSession(versions) {
  const groups = [];
  for (let i = 0; i < versions.length; i += 1) {
    const id = versions[i].sessionId ?? null;
    const last = groups[groups.length - 1];
    if (last && last.id === id) {
      last.end = i;
    } else {
      groups.push({ id, start: i, end: i });
    }
  }
  return groups;
}

// First index of the chat session that versions[index] belongs to.
export function getChatSessionStartIndex(versions, index) {
  if (index < 0 || index >= versions.length) return 0;
  const id = versions[index].sessionId ?? null;
  let i = index;
  while (i > 0 && (versions[i - 1].sessionId ?? null) === id) i -= 1;
  return i;
}
