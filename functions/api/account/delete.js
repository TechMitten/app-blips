import { handleAccountDelete } from '../../_lib/account.js';

export const onRequestPost = (context) => handleAccountDelete(context.request, context.env);
