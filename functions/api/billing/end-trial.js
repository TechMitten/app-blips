import { handleBillingEndTrial } from '../../_lib/billing.js';

export const onRequestPost = (context) => handleBillingEndTrial(context.request, context.env);
