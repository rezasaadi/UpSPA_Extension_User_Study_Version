import type { ManifestV3Export } from '@crxjs/vite-plugin';
import { supportedPrototypeMatchPatterns } from './shared/supportedSites';
type ManifestV3Object = Exclude<Awaited<ManifestV3Export>, (...args: any[]) => any>;
type ManifestWithSidePanel = Omit<ManifestV3Object, 'content_scripts'> & {
  side_panel: { default_path: string };
  content_scripts: Array<NonNullable<ManifestV3Object['content_scripts']>[number] & {
    match_origin_as_fallback?: boolean;
  }>;
};

const studySiteMatches = supportedPrototypeMatchPatterns();

const manifest: ManifestWithSidePanel = {
  manifest_version: 3,
  name: 'UpSPA Relaxed Study',
  version: '0.1.0',
  description: 'Local-first UpSPA usability-study prototype for a curated set of websites.',
  permissions: ['storage', 'activeTab', 'webNavigation', 'sidePanel'],
  host_permissions: studySiteMatches,
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
  },
  action: {
    default_title: 'UpSPA',
    default_popup: 'src/popup/popup.html',
  },
  side_panel: {
    default_path: 'src/popup/popup.html',
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: studySiteMatches,
      js: ['src/content/index.ts'],
      run_at: 'document_start',
      all_frames: true,
      match_about_blank: true,
      match_origin_as_fallback: true,
    },
  ],
  options_page: 'src/options/options.html',
  web_accessible_resources: [
    {
      matches: studySiteMatches,
      resources: ['assets/*', 'embedded-panel.html'],
    },
  ],
};
export default manifest;
