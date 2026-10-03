import { handleBillingPortal } from '../../_lib/billing.js';

export const onRequestPost = (context) => handleBillingPortal(context.request, context.env);
