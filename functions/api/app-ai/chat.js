import { handleSelfHostedAiChat } from '../../_lib/selfHostedAiRelay.js';

export const onRequest = ({ request, env }) => handleSelfHostedAiChat(request, env);
