import { useState } from 'react';
import { storage, firebaseEnabled } from '../firebase';
import { ref, deleteObject } from 'firebase/storage';
import {
  registerDeployment, unregisterDeployment, uploadDeploy, makeStorageToken, makePublicSlug,
  deployUrlForSlug, deployObjectPath, makeAiToken, DEPLOY_BUCKET
} from '../lib/deploy';
import { createAnalyticsWebsite } from '../lib/appAnalytics';

// Publish-to-public-URL state: the active deployment record (persisted inside
// the project's data blob by `saveProject`) plus the modal/UI state around
// deploy / redeploy / undeploy. Deploy is a Firebase Storage feature with no
// self-hosted equivalent, so every action here is a no-op unless
// firebaseEnabled -- DeployModal shows a "not available" state in that case.
export default function useDeployment({
  generatedCode, isSignedIn, user, username, projectName, currentProjectId, currentVersionId,
  deployment, setDeployment, saveProject, aiEnabled
}) {
  const [isDeployModalOpen, setIsDeployModalOpen] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployError, setDeployError] = useState(null);
  const [deployCopied, setDeployCopied] = useState(false);
  const [confirmUndeploy, setConfirmUndeploy] = useState(false);

  // The live deployment is one version behind the workspace.
  const isDeployStale = Boolean(deployment) && (deployment.versionId !== currentVersionId || Boolean(deployment.aiEnabled) !== Boolean(aiEnabled));
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

  const handleDeploy = async (password = '', customSlug = '', preventIndexing = false, favicon = null, analyticsEnabled = false) => {
    if (!generatedCode || isDeploying) return;
    if (!firebaseEnabled) {
      setDeployError('Deploy is not available in self-hosted mode.');
      return;
    }
    if (!isSignedIn || !user?.id) return;

    setIsDeploying(true);
    setDeployError(null);
    setConfirmUndeploy(false);

    try {
      // Reuse the existing path and slug so the shared link stays stable.
      const path = deployment?.path || deployObjectPath(user.id, makeStorageToken());

      let desiredSlug = deployment?.slug;
      if (!desiredSlug) {
        const baseSlug = customSlug || makePublicSlug(projectName);
        desiredSlug = username ? `${username}/${baseSlug}` : baseSlug;
      }

      // Reuse the existing Umami website on redeploy/re-enable rather than
      // creating a second one and orphaning prior stats.
      // Every redeploy rotates the public deployment binding token and bumps the
      // token generation. Old copied HTML therefore loses AI access after the
      // relay cache expires (legacy token) or immediately (short-lived session
      // tokens), by design.
      const aiToken = aiEnabled ? makeAiToken() : null;

      let websiteId = null;
      if (analyticsEnabled) {
        websiteId = deployment?.analyticsWebsiteId || await createAnalyticsWebsite(desiredSlug);
      }

      // `generatedCode` only -- never the bridge-injected preview srcDoc.
      await uploadDeploy({ path, html: generatedCode, password, preventIndexing, favicon, analyticsWebsiteId: websiteId, aiEnabled, aiToken });

      const slug = await registerDeployment({
        slug: desiredSlug,
        userId: user.id,
        projectId: currentProjectId,
        storagePath: path,
        name: projectName,
        analyticsEnabled,
        analyticsWebsiteId: websiteId,
        aiEnabled,
        aiToken
      });

      const next = {
        slug,
        url: deployUrlForSlug(slug),
        path,
        deployedAt: new Date().toISOString(),
        versionId: currentVersionId,
        analyticsEnabled,
        analyticsWebsiteId: websiteId,
        aiEnabled
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
    if (!firebaseEnabled) return;

    setIsDeploying(true);
    setDeployError(null);

    try {
      if (deployment.slug) await unregisterDeployment(deployment.slug);

      try {
        const storageRef = ref(storage, `${DEPLOY_BUCKET}/${deployment.path}`);
        await deleteObject(storageRef);
      } catch (removeError) {
        throw new Error(removeError.message || 'Failed to remove deployment.');
      }

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
