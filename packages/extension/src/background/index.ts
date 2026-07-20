import { getConfig, setConfig } from '../shared/config';
import type { BgRequest, BgResponse } from '../shared/messages';
import {
  isRuntimeExtensionEventMessage,
  type RuntimeExtensionEventMessage,
} from '../shared/events/chromeEventBridge';
import { updatePendingRegistrationSession } from '../shared/pendingRegistration';
import { makeUpspaClient, setupAndProvision } from '../shared/upspaActions';
import {
  advanceCredentialContinuation,
  clearCredentialContinuation,
  loadCredentialContinuation,
  saveCredentialContinuation,
} from '../shared/credentialContinuation';
import { getSupportedSiteForUrl } from '../shared/supportedSites';
import { getDetectedPageContext, saveDetectedPageContext } from '../shared/pageContext';

async function activeFrameIds(tabId: number): Promise<number[] | undefined> {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    return frames?.map((frame) => frame.frameId);
  } catch {
    return undefined;
  }
}

async function clearInPageContinuation(tabId: number): Promise<void> {
  const frameIds = await activeFrameIds(tabId) ?? [0];
  await Promise.all(frameIds.map(async (frameId) => {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'UPSPA_CLEAR_IN_PAGE_CONTINUATION' }, { frameId });
    } catch {
      // A frame may be navigating or may not permit extension content scripts.
    }
  }));
}

async function getClient() {
  const cfg = await getConfig();
  if (!cfg.enabled) throw new Error('UpSPA is disabled in options.');
  if (!cfg.uid) throw new Error('UpSPA not configured: uid is empty.');
  if (!cfg.sps?.length) throw new Error('UpSPA not configured: no SPs set.');
  if (cfg.threshold < 1 || cfg.threshold > cfg.sps.length) {
    throw new Error('UpSPA config invalid: threshold out of range.');
  }
  const client = await makeUpspaClient();
  return { cfg, client };
}
function normalizeTimestamp(ts: number | bigint): number {
  return Number(ts);
}
chrome.runtime.onMessage.addListener((msg: BgRequest | RuntimeExtensionEventMessage, _sender, sendResponse) => {
  (async (): Promise<BgResponse> => {
    try {
      if (isRuntimeExtensionEventMessage(msg)) {
        if (msg.event.type === 'FORM_DETECTED') {
          await saveDetectedPageContext(msg.event, _sender);
        }
        return { ok: true };
      }

      switch (msg.type) {
        case 'UPSRA_GET_CONFIG': {
          const cfg = await getConfig();
          return { ok: true, cfg };
        }
        case 'UPSRA_SET_CONFIG': {
          await setConfig(msg.cfg);
          return { ok: true };
        }
        case 'UPSRA_SETUP_AND_PROVISION': {
          if (!msg.uid) throw new Error('uid is empty.');
          if (!msg.password) throw new Error('password is empty.');
          if (msg.storageMode !== 'local-prototype' && !msg.sps?.length) throw new Error('no SPs provided.');
          if (msg.storageMode !== 'local-prototype' && (msg.threshold < 1 || msg.threshold > msg.sps.length)) {
            throw new Error('threshold out of range.');
          }
          await setupAndProvision({
            uid: msg.uid.trim(),
            threshold: msg.threshold,
            sps: msg.sps,
            password: msg.password,
            storageMode: msg.storageMode ?? 'local-prototype',
          });
          return { ok: true };
        }
        case 'UPSRA_REGISTER': {
          const { client } = await getClient();
          const out = await client.register(msg.lsj, msg.password);
          return {
            ok: true,
            vinfo_b64: out.to_ls.vinfo,
          };
        }
        case 'UPSRA_AUTH': {
          const { client } = await getClient();
          const out = await client.authenticate(msg.lsj, msg.password);
          return {
            ok: true,
            vinfo_prime_b64: out.vinfo_prime,
          };
        }
        case 'UPSRA_SECRET_UPDATE_PREP': {
          const { client } = await getClient();
          const out = await client.secretUpdate(msg.lsj, msg.password);
          return {
            ok: true,
            secret_update: {
              vinfo_prime_b64: out.vinfo_prime,
              vinfo_new_b64: out.vinfo_new,
              cj_new: out.cj_new,
              suids: out.suids,
              old_ctr: out.old_ctr,
              new_ctr: out.new_ctr,
            },
          };
        }
        case 'UPSRA_SECRET_UPDATE_COMMIT': {
          const { client } = await getClient();
          await client.applySecretUpdateToSPs(msg.suids, msg.cj_new);
          return { ok: true };
        }
        case 'UPSRA_PASSWORD_UPDATE': {
          const { client } = await getClient();
          const out = await client.passwordUpdate(
            msg.old_password,
            msg.new_password,
            normalizeTimestamp(msg.timestamp),
          );
          return {
            ok: true,
            password_update: {
              cid_new: out.cid_new,
            },
          };
        }
        case 'UPSPA_REGISTRATION_FORM_SUBMITTED': {
          const senderOrigin = _sender.url ? new URL(_sender.url).origin : '';
          if (senderOrigin && senderOrigin !== msg.origin) {
            throw new Error('Registration submission origin did not match sender tab.');
          }
          await updatePendingRegistrationSession(msg.flowId, {
            status: 'submitted_to_website',
          });
          await updatePendingRegistrationSession(msg.flowId, {
            status: 'awaiting_confirmation',
          });
          return { ok: true };
        }
        case 'UPSPA_OPEN_POPUP_REQUESTED': {
          const tabId = _sender.tab?.id;
          let sidePanelError: unknown;
          if (tabId !== undefined && chrome.sidePanel?.open) {
            try {
              await chrome.sidePanel.open({ tabId });
              return { ok: true, opened: 'side-panel' };
            } catch (error) {
              sidePanelError = error;
            }
          }
          const openPopup = chrome.action.openPopup;
          if (openPopup) {
            try {
              await openPopup(_sender.tab?.windowId === undefined ? undefined : { windowId: _sender.tab.windowId });
              return { ok: true, opened: 'action-popup' };
            } catch (error) {
              sidePanelError ??= error;
            }
          }
          if (tabId !== undefined) {
            const embeddedPanelMessage = { type: 'UPSPA_SHOW_EMBEDDED_PANEL' };
            try {
              await chrome.tabs.sendMessage(tabId, embeddedPanelMessage, { frameId: 0 });
            } catch {
              await chrome.tabs.sendMessage(tabId, embeddedPanelMessage, { frameId: _sender.frameId });
            }
            return { ok: true, opened: 'embedded-panel' };
          }
          throw new Error(`Chrome could not open the UpSPA interface from this field.${sidePanelError ? ` ${String(sidePanelError)}` : ''}`);
        }
        case 'UPSPA_SAVE_CREDENTIAL_CONTINUATION': {
          const senderTabId = _sender.tab?.id;
          if (senderTabId !== undefined && senderTabId !== msg.continuation.tabId) {
            throw new Error('Credential continuation tab did not match the sender tab.');
          }
          await saveCredentialContinuation(msg.continuation);
          return { ok: true };
        }
        case 'UPSPA_GET_CREDENTIAL_CONTINUATION': {
          const tabId = _sender.tab?.id ?? msg.tabId;
          if (tabId === undefined) throw new Error('Credential continuation request has no tab id.');
          const senderSite = getSupportedSiteForUrl(_sender.url) ?? getSupportedSiteForUrl(_sender.tab?.url);
          if (_sender.tab && senderSite?.id !== msg.siteId) {
            throw new Error('Credential continuation site did not match the sender page.');
          }
          const continuation = await loadCredentialContinuation(tabId, msg.siteId);
          return { ok: true, continuation };
        }
        case 'UPSPA_CLEAR_CREDENTIAL_CONTINUATION': {
          const tabId = _sender.tab?.id ?? msg.tabId;
          if (tabId === undefined) throw new Error('Credential continuation clear request has no tab id.');
          if (_sender.tab?.id !== undefined && msg.tabId !== undefined && _sender.tab.id !== msg.tabId) {
            throw new Error('Credential continuation tab did not match the sender tab.');
          }
          const senderSite = getSupportedSiteForUrl(_sender.url) ?? getSupportedSiteForUrl(_sender.tab?.url);
          if (_sender.tab && senderSite?.id !== msg.siteId) {
            throw new Error('Credential continuation site did not match the sender page.');
          }
          await clearCredentialContinuation(tabId, msg.siteId, msg.flowId);
          await clearInPageContinuation(tabId);
          return { ok: true };
        }
        case 'UPSPA_ADVANCE_CREDENTIAL_CONTINUATION': {
          const tabId = _sender.tab?.id ?? msg.tabId;
          if (tabId === undefined) throw new Error('Credential continuation advance request has no tab id.');
          if (_sender.tab?.id !== undefined && msg.tabId !== undefined && _sender.tab.id !== msg.tabId) {
            throw new Error('Credential continuation tab did not match the sender tab.');
          }
          const senderSite = getSupportedSiteForUrl(_sender.url) ?? getSupportedSiteForUrl(_sender.tab?.url);
          if (_sender.tab && senderSite?.id !== msg.siteId) {
            throw new Error('Credential continuation site did not match the sender page.');
          }
          await advanceCredentialContinuation(
            tabId,
            msg.siteId,
            msg.expectedStage,
            msg.flowId,
          );
          return { ok: true };
        }
        case 'UPSPA_GET_PAGE_CONTEXT': {
          const pageContext = await getDetectedPageContext(
            msg.tabId,
            msg.siteId,
            await activeFrameIds(msg.tabId),
          );
          return { ok: true, pageContext };
        }
        default:
          return {
            ok: false,
            error: `Unknown message: ${(msg as any).type}`,
          };
      }
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  })()
    .then(sendResponse)
    .catch((e) => {
      sendResponse({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    });
  return true;
});
