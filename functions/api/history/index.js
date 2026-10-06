import { handleHistoryDelete } from '../../_lib/history.js';

export const onRequestDelete = (context) => handleHistoryDelete(context.request, context.env);
