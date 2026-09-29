import { useState } from 'react';
import { supabaseEnabled } from '../supabase';
import {
  registerDeployment, uploadDeploy, makeStorageToken, makePublicSlug,
  deployUrlForSlug, deployObjectPath, makeAiToken, removeStalePages, removeDeployment
} from '../lib/deploy';
import { getLanding } from '../lib/pages';
import { createAnalyticsWebsite } from '../lib/appAnalytics';
import { fetchPostBySlug, publishToGallery, unpublishPost } from '../lib/gallery';

// Publish-to-public-URL state: the active deployment record (persisted inside
// the project's data blob by `saveProject`) plus the modal/UI state around
// deploy / redeploy / undeploy. Deploy is a Supabase Storage feature with no
// self-hosted equivalent, so every action here is a no-op unless
// supabaseEnabled -- DeployModal shows a "not available" state in that case.
export default function useDeployment({
  files, isSignedIn, user, username, projectName, currentProjectId, currentVersionId,
  deployment, setDeployment, saveProject, aiEnabled, studioMode
}) {
  const [isDeployModalOpen, setIsDeployModalOpen] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployError, setDeployError] = useState(null);
  const [deployCopied, setDeployCopied] = useState(false);
  const [confirmUndeploy, setConfirmUndeploy] = useState(false);
  // The deployment's gallery listing, if any: undefined while loading, null
  // when not listed. Fetched fresh on each modal open.
  const [galleryPost, setGalleryPost] = useState(null);
  const [galleryPostLoading, setGalleryPostLoading] = useState(false);
  // Non-fatal: the deploy itself succeeded but the gallery step did not.
  const [galleryError, setGalleryError] = useState(null);

  // The live deployment is one version behind the workspace.
  const isDeployStale = Boolean(deployment) && (deployment.versionId !== currentVersionId || Boolean(deployment.aiEnabled) !== Boolean(aiEnabled));
  const deploymentUrl = deployment
    ? (deployment.slug ? deployUrlForSlug(deployment.slug) : deployment.url)
    : '';

  const openDeployModal = () => {
    setDeployError(null);
    setGalleryError(null);
    setConfirmUndeploy(false);
    setGalleryPost(null);
    setIsDeployModalOpen(true);
    if (supabaseEnabled && isSignedIn && deployment?.slug) {
      setGalleryPostLoading(true);
      fetchPostBySlug(deployment.slug)
        .then(setGalleryPost)
        .catch((err) => console.warn('Failed to load gallery listing:', err))
        .finally(() => setGalleryPostLoading(false));
    }
  };

  const closeDeployModal = () => {
    if (isDeploying) return;
    setIsDeployModalOpen(false);
    setConfirmUndeploy(false);
  };

  // `gallery`: { enabled, title, description, allowRemix, thumbnailBlob }, or
  // null to leave any existing listing as it is.
  const handleDeploy = async (password = '', customSlug = '', preventIndexing = false, favicon = null, analyticsEnabled = false, gallery = null) => {
    if (!getLanding(files) || isDeploying) return false;
    if (!supabaseEnabled) {
      setDeployError('Deploy is not available in self-hosted mode.');
      return false;
    }
    if (!isSignedIn || !user?.id) return false;

    setIsDeploying(true);
    setDeployError(null);
    setGalleryError(null);
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

      // The site's own `files` only -- never the bridge-injected preview srcDoc.
      const uploaded = await uploadDeploy({ path, files, password, preventIndexing, favicon, analyticsWebsiteId: websiteId, aiEnabled, aiToken });

      const slug = await registerDeployment({
        slug: desiredSlug,
        userId: user.id,
        projectId: currentProjectId,
        storagePath: path,
        name: projectName,
        analyticsEnabled,
        analyticsWebsiteId: websiteId,
        aiEnabled,
        aiToken,
        pageNames: uploaded.pageNames,
        bundle: uploaded.bundled,
        passwordProtected: Boolean(password)
      });

      // Pages dropped since the last deploy (or folded into a password bundle)
      // must stop being served from storage.
      await removeStalePages(path, deployment?.pageObjects, uploaded.pageObjects);

      const next = {
        slug,
        url: deployUrlForSlug(slug),
        path,
        pageObjects: uploaded.pageObjects,
        deployedAt: new Date().toISOString(),
        versionId: currentVersionId,
        analyticsEnabled,
        analyticsWebsiteId: websiteId,
        aiEnabled
      };
      setDeployment(next);
      saveProject({ deploymentToSave: next, force: true });

      // The app is live either way; a gallery failure is reported separately
      // rather than failing the deploy. A password deploy is never listed
      // (the DB also drops any existing listing when it becomes protected).
      if (gallery) {
        try {
          if (gallery.enabled && !password) {
            const post = await publishToGallery({
              slug,
              userId: user.id,
              title: gallery.title || projectName,
              description: gallery.description,
              allowRemix: gallery.allowRemix,
              thumbnailBlob: gallery.thumbnailBlob,
              source: { files, studioMode, aiEnabled: Boolean(aiEnabled) },
            });
            setGalleryPost(post);
          } else if (galleryPost) {
            // After a password deploy the row is already gone (DB trigger);
            // this still removes its thumbnail/source files.
            await unpublishPost(galleryPost);
            setGalleryPost(null);
          }
        } catch (err) {
          setGalleryError(err.message || 'Your app is live, but publishing to the gallery failed.');
        }
      }
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
    if (!supabaseEnabled) return;

    setIsDeploying(true);
    setDeployError(null);

    try {
      await removeDeployment(deployment);

      setDeployment(null);
      setGalleryPost(null);
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
    galleryPost,
    galleryPostLoading,
    galleryError,
  };
}
