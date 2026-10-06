import { handleDeployUpload, handleDeployDelete } from '../_lib/deploys.js';

export const onRequestPost = (context) => handleDeployUpload(context.request, context.env);
export const onRequestDelete = (context) => handleDeployDelete(context.request, context.env);
