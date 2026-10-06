import { handleHistoryPages } from '../../_lib/history.js';

export const onRequestPost = (context) => handleHistoryPages(context.request, context.env);
