import { handleAiSession } from '../_lib/aiRelay.js';

export const onRequestPost = ({ request, env }) => handleAiSession(request, env);
