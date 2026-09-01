import { handleChatProxy } from '../_lib/chatProxy.js';

export const onRequestPost = (context) => handleChatProxy(context.request, context.env);
