import { handleBillingStatus } from '../../_lib/billing.js';

export const onRequestGet = (context) => handleBillingStatus(context.request, context.env);
