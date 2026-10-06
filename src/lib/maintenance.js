// Maintenance mode (APPBLIPS_MAINTENANCE=true): building, Ask and upgrading
// are paused for everyone. The server enforces it (chatProxy, billing
// checkout); this copy only shows the notice and locks the prompt box. It is
// read at build time, so changing it needs a redeploy.
export const maintenanceMode = ['1', 'true', 'on', 'yes'].includes(
  String(import.meta.env.APPBLIPS_MAINTENANCE || '').trim().toLowerCase(),
);

export const MAINTENANCE_MESSAGE = "AppBlips is down for maintenance while we make some improvements. Building and Ask are paused for now, and your projects are safe. Please check back soon.";
