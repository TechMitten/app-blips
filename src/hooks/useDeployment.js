import { useState } from 'react';
import { firebaseEnabled } from '../firebase';
import { buildDeployPages, publishDeployment, makePublicSlug, deployUrlForSlug, removeDeployment } from '../lib/deploy';
import { getLanding } from '../lib/pages';
import { createAnalyticsWebsite } from '../lib/appAnalytics';

// Publish-to-public-URL state: the active deployment record (persisted inside
// the project's data blob by `saveProject`) plus the modal/UI state around
// deploy / redeploy / undeploy. Deploy is a hosted feature (Firebase sign-in
// plus the server's R2 storage) with no self-hosted equivalent, so every
// action here is a no-op unless firebaseEnabled -- DeployModal shows a "not
// available" state in that case.
export default function useDeployment({
  files, isSignedIn, user, username, projectName, currentProjectId, currentVersionId,
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

  const handleDeploy = async (password = '', customSlug = '', preventIndexing = false, favicon = null, analyticsEnabled = false) => {
    if (!getLanding(files) || isDeploying) return false;
    if (!firebaseEnabled) {
      setDeployError('Deploy is not available on this installation.');
      return false;
    }
    if (!isSignedIn || !user?.id) return false;

    setIsDeploying(true);
    setDeployError(null);
    setConfirmUndeploy(false);

    try {
      // Reuse the existing slug so the shared link stays stable.
      let desiredSlug = deployment?.slug;
      if (!desiredSlug) {
        const baseSlug = customSlug || makePublicSlug(projectName);
        desiredSlug = username ? `${username}/${baseSlug}` : baseSlug;
      }

      // Reuse the existing Umami website on redeploy/re-enable rather than
      // creating a second one and orphaning prior stats. Still ask the server
      // (it's idempotent per slug) because it also supplies the script URL.
      let websiteId = null;
      let analyticsScriptUrl = '';
      if (analyticsEnabled) {
        const site = await createAnalyticsWebsite(desiredSlug);
        websiteId = deployment?.analyticsWebsiteId || site.websiteId;
        analyticsScriptUrl = site.scriptUrl;
      }

      // The site's own `files` only -- never the bridge-injected preview srcDoc.
      const built = await buildDeployPages({
        files, password, preventIndexing, favicon, analyticsWebsiteId: websiteId, analyticsScriptUrl,
      });

      const published = await publishDeployment({
        slug: desiredSlug,
        ...built,
        passwordProtected: Boolean(password),
        projectId: currentProjectId,
        name: projectName,
        analyticsEnabled,
        analyticsWebsiteId: websiteId,
      });
      const slug = published.slug;

      const next = {
        slug,
        url: deployUrlForSlug(slug),
        path: published.path,
        pageObjects: published.pageObjects,
        deployedAt: new Date().toISOString(),
        versionId: currentVersionId,
        analyticsEnabled,
        analyticsWebsiteId: websiteId
      };
      setDeployment(next);
      saveProject({ deploymentToSave: next, force: true });
      return true;
    } catch (err) {
      setDeployError(err.message || 'Failed to deploy.');
      return false;
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
      await removeDeployment(deployment);

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
