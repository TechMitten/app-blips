import { useState, useEffect } from 'react';
import { safeStorage, loadChatFont, CHAT_FONT_KEY } from '../lib/config';

// Owns the chat transcript font-size preference and mirrors it onto
// <html data-chat-font="...">, which selects the matching CSS variable set in
// App.css. Follows the same shape as useTheme.
export default function useChatFont() {
  const [chatFont, setChatFont] = useState(loadChatFont);

  useEffect(() => {
    document.documentElement.dataset.chatFont = chatFont;
  }, [chatFont]);

  useEffect(() => {
    try {
      safeStorage('local')?.setItem(CHAT_FONT_KEY, chatFont);
    } catch {
      /* storage blocked -- the preference just will not persist */
    }
  }, [chatFont]);

  return { chatFont, setChatFont };
}
