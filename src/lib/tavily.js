// The Tavily connector, page side of /api/tavily
// (electron/server/tavilyApi.js). The same fetch works in every host: the
// desktop app answers it in-process, server.js and the Vite dev server over
// HTTP, android.js inside the page. The user's key never reaches the page;
// only its last four characters do.
async function call(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { error: 'Couldn’t reach AppBlips’ Tavily service. Try again.' };
  }
  try {
    return await response.json();
  } catch {
    return { error: `Tavily request failed (error ${response.status}).` };
  }
}

export const tavilyStatus = () => call('/api/tavily');
export const saveTavilyKey = (key) => call('/api/tavily/key', { method: 'POST', body: { key } });
export const forgetTavilyKey = () => call('/api/tavily', { method: 'DELETE' });
// -> { results: [{ title, url, content, published_date? }] } | { error, signedOut? }
export const searchTavily = ({ query, topic = 'general', time_range = null }) => call('/api/tavily/search', {
  method: 'POST',
  body: { query, topic, time_range },
});
