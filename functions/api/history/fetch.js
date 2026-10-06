import { handleHistoryFetch } from '../../_lib/history.js';

export const onRequestPost = (context) => handleHistoryFetch(context.request, context.env);
