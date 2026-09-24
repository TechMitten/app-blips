import { handleDebugUnlock } from '../_lib/debugUnlock.js';

export const onRequest = ({ request, env }) => handleDebugUnlock(request, env);
