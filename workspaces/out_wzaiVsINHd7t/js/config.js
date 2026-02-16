/**
 * The Cognitive Shift — Configuration
 *
 * Configurable endpoints for PocketBase and Cloudflare Worker.
 * Update these values when deploying to production.
 */
const TCS_CONFIG = {
  // PocketBase instance URL (for subscriber management, publications, etc.)
  pocketbaseUrl: 'https://pb.example.com',

  // Cloudflare Worker URL (for edge functions, email sending, etc.)
  workerUrl: 'https://worker.example.com',

  // Site metadata
  siteName: 'The Cognitive Shift',
  siteTagline: 'Observatory × Workshop',
};
