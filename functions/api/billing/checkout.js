import { handleBillingCheckout } from '../../_lib/billing.js';

export const onRequestPost = (context) => handleBillingCheckout(context.request, context.env);
