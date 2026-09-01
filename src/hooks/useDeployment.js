import { useState } from 'react';
import { supabase } from '../supabase';
import {
  registerDeployment, unregisterDeployment, uploadDeploy, makeStorageToken, makePublicSlug,
  deployUrlForSlug, deployObjectPath, DEPLOY_BUCKET
} from '../lib/deploy';

// Publish-to-public-URL state: the active deployment record (persisted inside
// the project's data blob by `saveProject`) plus the modal/UI state around
// deploy / redeploy / undeploy.
export default function useDeployment({
  generatedCode, isSignedIn, user, projectName, currentProjectId, currentVersionId,
  deployment, setDeployment, saveProject
}) {
  const [isDeployModalOpen, setIsDeployModalOpen] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployError, setDeployError] = useState(null);
  const [deployCopied, setDeployCopied] = useState(false);
  const [confirmUndeploy, setConfirmUndeploy] = useState(false);

  // The live deployment is one version behind the workspace.
  const isDeployStale = Boolean(deployment) && deployment.versionId !== currentVersionId;
  const deploymentUrl = deployment
    ? (deployment.slug ? deployUrlForSlug(deployment.slug) : deployment.url)
    : '';

  const openDeployModal = () => {
    setDeployError(null);
    setConfirmUndeploy(false);
    setIsDeployModalOpen(true);
  };

  const closeDeployModal = () => {
    if (isDeploying) return;
    setIsDeployModalOpen(false);
    setConfirmUndeploy(false);
  };

  const handleDeploy = async (password = '') => {
    if (!generatedCode || isDeploying) return;
    if (!isSignedIn || !user?.id) return;
    if (!password) {
      setDeployError('A password is required to deploy.');
      return;
    }

    setIsDeploying(true);
    setDeployError(null);
    setConfirmUndeploy(false);

    try {
      // Reuse the existing path and slug so the shared link stays stable.
      const path = deployment?.path || deployObjectPath(user.id, makeStorageToken());
      // `generatedCode` only -- never the bridge-injected preview srcDoc.
      await uploadDeploy({ path, html: generatedCode, password });

      const slug = await registerDeployment({
        slug: deployment?.slug || makePublicSlug(projectName),
        userId: user.id,
        projectId: currentProjectId,
        storagePath: path
      });

      const next = {
        slug,
        url: deployUrlForSlug(slug),
        path,
        deployedAt: new Date().toISOString(),
        versionId: currentVersionId
      };
      setDeployment(next);
      saveProject({ deploymentToSave: next, force: true });
    } catch (err) {
      setDeployError(err.message || 'Failed to deploy.');
    } finally {
      setIsDeploying(false);
    }
  };

  const handleUndeploy = async () => {
    if (!deployment || isDeploying) return;

    setIsDeploying(true);
    setDeployError(null);

    try {
      if (deployment.slug) await unregisterDeployment(deployment.slug);

      const { error: removeError } = await supabase.storage
        .from(DEPLOY_BUCKET)
        .remove([deployment.path]);
      if (removeError) throw new Error(removeError.message || 'Failed to remove deployment.');

      setDeployment(null);
      setConfirmUndeploy(false);
      saveProject({ deploymentToSave: null, force: true });
    } catch (err) {
      setDeployError(err.message || 'Failed to remove deployment.');
    } finally {
      setIsDeploying(false);
    }
  };

  const handleCopyDeployUrl = async () => {
    if (!deploymentUrl) return;
    try {
      await navigator.clipboard.writeText(deploymentUrl);
      setDeployCopied(true);
      setTimeout(() => setDeployCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy deploy URL:', err);
    }
  };

  return {
    isDeployModalOpen,
    setIsDeployModalOpen,
    isDeploying,
    deployError,
    setDeployError,
    deployCopied,
    confirmUndeploy,
    setConfirmUndeploy,
    isDeployStale,
    deploymentUrl,
    openDeployModal,
    closeDeployModal,
    handleDeploy,
    handleUndeploy,
    handleCopyDeployUrl,
  };
}
