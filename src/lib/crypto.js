import { PWA_HEAD_SNIPPET } from './pwa';
import { UMAMI_SCRIPT_TAG } from './analytics';
import { NOINDEX_META_TAG, DEFAULT_FAVICON_URL } from './seo';

// Derives a PBKDF2 key from a string password and a random salt
const deriveKey = async (password, salt) => {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
};

const payloadToBase64 = (payload) => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(reader.result.split(',')[1]);
    };
    reader.readAsDataURL(new Blob([payload]));
  });
};

export const encryptApp = async (html, password, favicon = DEFAULT_FAVICON_URL) => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  
  const enc = new TextEncoder();
  const encoded = enc.encode(html);
  
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    encoded
  );
  
  const cipherBytes = new Uint8Array(ciphertext);
  
  // Combine salt, iv, and ciphertext into a single payload
  const payload = new Uint8Array(salt.length + iv.length + cipherBytes.length);
  payload.set(salt, 0);
  payload.set(iv, salt.length);
  payload.set(cipherBytes, salt.length + iv.length);
  
  const base64 = await payloadToBase64(payload);
  
  return wrapWithUnlockScreen(base64, favicon);
};

const wrapWithUnlockScreen = (encryptedBase64, favicon = DEFAULT_FAVICON_URL) => {
  const faviconTag = `<link rel="icon" href="${favicon || DEFAULT_FAVICON_URL}">`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Protected App</title>
  ${faviconTag}
  ${NOINDEX_META_TAG}
  ${PWA_HEAD_SNIPPET}
${UMAMI_SCRIPT_TAG ? `  ${UMAMI_SCRIPT_TAG}\n` : ''}  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f8fafc; color: #334155; }
    .card { background: white; padding: 2.5rem; border-radius: 1rem; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1); width: 100%; max-width: 24rem; text-align: center; }
    h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 1.5rem; color: #0f172a; }
    input { width: 100%; box-sizing: border-box; padding: 0.75rem 1rem; border: 1px solid #cbd5e1; border-radius: 0.5rem; outline: none; margin-bottom: 1rem; font-size: 1rem; transition: border-color 0.15s; }
    input:focus { border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1); }
    button { width: 100%; padding: 0.75rem 1rem; background: #3b82f6; color: white; border: none; border-radius: 0.5rem; font-size: 1rem; font-weight: 500; cursor: pointer; transition: background 0.15s; }
    button:hover { background: #2563eb; }
    button:disabled { opacity: 0.7; cursor: not-allowed; }
    .error { color: #ef4444; font-size: 0.875rem; margin-top: 1rem; display: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Password Protected</h1>
    <form id="unlock-form">
      <input type="password" id="password" placeholder="Enter password" required autofocus>
      <button type="submit" id="submit-btn">Unlock App</button>
      <div id="error" class="error">Incorrect password. Please try again.</div>
    </form>
  </div>
  <script>
    const encryptedBase64 = "${encryptedBase64}";
    const storageKey = 'unlock_state_' + window.location.pathname;
    
    const getRateLimitState = () => {
      try {
        const state = localStorage.getItem(storageKey);
        if (state) return JSON.parse(state);
      } catch (e) {}
      return { attempts: 0, lockoutUntil: 0 };
    };
    
    const saveRateLimitState = (state) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(state));
      } catch (e) {}
    };

    const checkRateLimit = () => {
      const state = getRateLimitState();
      const now = Date.now();
      const submitBtn = document.getElementById('submit-btn');
      const errorDiv = document.getElementById('error');
      
      if (state.lockoutUntil > now) {
        const remainingSec = Math.ceil((state.lockoutUntil - now) / 1000);
        submitBtn.disabled = true;
        submitBtn.textContent = 'Locked';
        errorDiv.textContent = 'Too many attempts. Try again in ' + remainingSec + 's.';
        errorDiv.style.display = 'block';
        setTimeout(checkRateLimit, 1000);
        return true;
      }
      
      if (state.attempts >= 5 && state.lockoutUntil <= now) {
        saveRateLimitState({ attempts: 0, lockoutUntil: 0 });
        submitBtn.disabled = false;
        submitBtn.textContent = 'Unlock App';
        errorDiv.style.display = 'none';
      }
      return false;
    };
    
    checkRateLimit();
    
    document.getElementById('unlock-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      if (checkRateLimit()) return;
      
      const password = document.getElementById('password').value;
      const errorDiv = document.getElementById('error');
      const submitBtn = document.getElementById('submit-btn');
      
      errorDiv.style.display = 'none';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Decrypting...';
      
      // Artificial delay to deter fast automated guesses
      await new Promise(resolve => setTimeout(resolve, 500));
      
      try {
        // base64 to Uint8Array
        const binaryString = atob(encryptedBase64);
        const payload = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          payload[i] = binaryString.charCodeAt(i);
        }
        
        const salt = payload.slice(0, 16);
        const iv = payload.slice(16, 28);
        const ciphertext = payload.slice(28);
        
        const enc = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
          'raw',
          enc.encode(password),
          { name: 'PBKDF2' },
          false,
          ['deriveKey']
        );
        const key = await crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: 100000, hash: 'SHA-256' },
          keyMaterial,
          { name: 'AES-GCM', length: 256 },
          false,
          ['decrypt']
        );
        
        const decryptedBuffer = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: iv },
          key,
          ciphertext
        );
        
        const dec = new TextDecoder();
        const html = dec.decode(decryptedBuffer);
        
        saveRateLimitState({ attempts: 0, lockoutUntil: 0 });
        
        document.open();
        document.write(html);
        document.close();
      } catch (err) {
        const state = getRateLimitState();
        state.attempts += 1;
        if (state.attempts >= 5) {
          state.lockoutUntil = Date.now() + 60 * 1000;
        }
        saveRateLimitState(state);
        
        if (checkRateLimit()) return;
        
        errorDiv.textContent = 'Incorrect password. Please try again.';
        errorDiv.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Unlock App';
      }
    });
  </script>
</body>
</html>`;
};
