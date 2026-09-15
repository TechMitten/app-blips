import { handleAiChat } from '../_lib/aiRelay.js';

export const onRequestPost = (context) =>
  handleAiChat(context.request, context.env, (promise) => context.waitUntil(promise));
