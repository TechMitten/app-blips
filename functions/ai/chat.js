import { handleAiChat } from '../_lib/aiRelay.js';

export const onRequestPost = ({ request, env }) => handleAiChat(request, env);
