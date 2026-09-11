import { handleAnalyticsWebsiteCreate } from '../../_lib/umamiProxy.js';

export const onRequestPost = (context) => handleAnalyticsWebsiteCreate(context.request, context.env);
