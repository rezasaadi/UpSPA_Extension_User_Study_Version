import { describe, expect, it } from 'vitest';
import manifest from './manifest';

describe('extension frame coverage', () => {
  it('injects the content script into authentication frames', () => {
    expect(manifest.permissions).toEqual(expect.arrayContaining(['webNavigation', 'sidePanel']));
    expect(manifest.content_scripts?.[0]).toMatchObject({
      all_frames: true,
      match_about_blank: true,
      match_origin_as_fallback: true,
    });
    expect(manifest.side_panel).toMatchObject({ default_path: 'src/popup/popup.html' });
    expect(manifest.web_accessible_resources?.[0]?.resources).toContain('embedded-panel.html');
    expect(manifest.web_accessible_resources?.[0]?.resources).not.toContain('src/popup/popup.html');
  });

  it('requests access only to the curated study registry', () => {
    expect(manifest.host_permissions).not.toContain('<all_urls>');
    expect(manifest.permissions).not.toContain('scripting');
    expect(manifest.host_permissions).toContain('*://*.github.com/*');
    expect(manifest.host_permissions).toEqual(expect.arrayContaining([
      '*://*.overleaf.com/*',
      '*://*.giris.turkiye.gov.tr/*',
      '*://*.dr.com.tr/*',
      '*://*.biletinial.com/*',
      '*://*.n11.com/*',
    ]));
    for (const removedMatch of [
      '*://*.x.com/*',
      '*://*.twitter.com/*',
      '*://*.gitlab.com/*',
      '*://*.bitbucket.org/*',
      '*://*.paypal.com/*',
      '*://*.medium.com/*',
      '*://*.turkiye.gov.tr/*',
    ]) {
      expect(manifest.host_permissions).not.toContain(removedMatch);
    }
    expect(manifest.content_scripts?.[0]?.matches).toEqual(manifest.host_permissions);
    expect(manifest.web_accessible_resources?.[0]?.matches).toEqual(manifest.host_permissions);
  });
});
