import { handleStripeWebhook } from '../../_lib/billing.js';

export const onRequestPost = (context) => handleStripeWebhook(context.request, context.env);
