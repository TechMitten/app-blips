import { handleAnalyticsStats } from '../../_lib/umamiProxy.js';

export const onRequestGet = (context) => handleAnalyticsStats(context.request, context.env);
