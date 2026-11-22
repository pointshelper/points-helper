importScripts('stores.js');

// Let content scripts hear session-storage changes (Reset clears the greeting).
chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });

const HOUR = 3600 * 1000;
const RETURN_WINDOW = 20 * 60 * 1000; // activation must happen within 20 min of pressing Activate

// ---- storage helpers -------------------------------------------------------

async function getAll(key, fallback) {
  const o = await chrome.storage.local.get(key);
  return o[key] ?? fallback;
}

async function patchTrack(storeKey, patch) {
  const track = await getAll('track', {});
  track[storeKey] = { ...(track[storeKey] || {}), ...patch };
  await chrome.storage.local.set({ track });
}

function safeDecode(v) {
  try { return decodeURIComponent(v); } catch (e) { return v; }
}

// ---- status ----------------------------------------------------------------

async function cookieState(store) {
  const result = { state: null, adblock: false };
  if (!store.trackingCookie && !store.adblockCookie) return result;
  const cookies = await chrome.cookies.getAll({ domain: store.host });
  if (store.adblockCookie) {
    result.adblock = cookies.some(c => c.name === store.adblockCookie && c.value === 'true');
  }
  if (store.trackingCookie) {
    const c = cookies.find(c => c.name === store.trackingCookie.name);
    if (c) {
      const v = safeDecode(c.value);
      if (v.includes(store.trackingCookie.ours)) result.state = 'active';
      else if (/rakuten|affiliate|siteid/i.test(v)) result.state = 'replaced';
    }
  }
  return result;
}

async function computeStatus(store) {
  const rec = (await getAll('track', {}))[store.key] || {};
  const now = Date.now();
  const { state: fromCookie, adblock } = await cookieState(store);

  let state = 'none';
  const act = rec.activatedAt || 0;
  const rep = rec.replacedAt || 0;

  if (rep && rep > act) {
    state = 'replaced';
  } else if (fromCookie) {
    state = fromCookie;
  } else if (act) {
    state = store.windowHours && now - act > store.windowHours * HOUR ? 'expired' : 'active';
  }

  return {
    state,
    activatedAt: act || null,
    replacedAt: rep || null,
    cookieChecked: !!store.trackingCookie,
    adblockCookie: adblock
  };
}

const BADGE = {
  active: ['✓', '#1a7f37'],
  replaced: ['!', '#c62828'],
  expired: ['!', '#b26a00'],
  none: ['off', '#6b7280']
};

// Problems the page itself found (items that won't earn), per tab: { level, message }.
const tabIssues = new Map();

const TITLES = {
  active: 'Aeroplan tracking active',
  replaced: 'Aeroplan tracking was replaced — activate again',
  expired: 'Aeroplan activation expired — activate again',
  none: 'Not activated for Aeroplan'
};

// Grey everywhere (the manifest default); green only on a supported store's tabs,
// so the icon never suggests the extension is running on other sites.
const ICON_ON = { 16: 'icons/icon16.png', 32: 'icons/icon32.png' };
const ICON_OFF = { 16: 'icons/icon16-off.png', 32: 'icons/icon32-off.png' };

async function paintBadge(tabId, store) {
  // setIcon logs "Unchecked runtime.lastError" for a closed tab unless the error is read in a callback.
  await new Promise(resolve => chrome.action.setIcon({ tabId, path: store ? ICON_ON : ICON_OFF }, () => {
    void chrome.runtime.lastError;
    resolve();
  }));
  if (!store) {
    await chrome.action.setBadgeText({ tabId, text: '' });
    await chrome.action.setTitle({ tabId, title: 'Points Helper' });
    return;
  }
  const { state } = await computeStatus(store);
  let [text, color] = BADGE[state];
  let title = TITLES[state];
  const issue = tabIssues.get(tabId);
  if (state === 'active' && issue) {
    text = '!';
    color = issue.level === 'bad' ? '#c62828' : '#b26a00';
    title = 'Tracking active, but ' + issue.message;
  }
  await chrome.action.setBadgeText({ tabId, text });
  await chrome.action.setBadgeBackgroundColor({ tabId, color });
  await chrome.action.setTitle({ tabId, title: 'Points Helper — ' + title });
}

// The tab may close or navigate while the badge is being worked out; that's fine, skip it.
async function updateBadge(tabId, store) {
  try { await paintBadge(tabId, store); } catch (e) { /* tab gone */ }
}

chrome.tabs.onRemoved.addListener(tabId => tabIssues.delete(tabId));

// ---- watch tabs: record activations, replacements, send user back ---------

async function maybeReturn(tabId, store) {
  const pending = await getAll('returnTo', null);
  if (!pending || pending.store !== store.key) return;
  if (Date.now() - pending.at > RETURN_WINDOW) {
    await chrome.storage.local.remove('returnTo');
    return;
  }
  const rec = (await getAll('track', {}))[store.key] || {};
  if (!rec.activatedAt || rec.activatedAt < pending.at) return;

  await chrome.storage.local.remove('returnTo');
  // Give the store a moment to save its tracking cookie before leaving the landing page.
  for (let i = 0; i < 10; i++) {
    const { state } = await cookieState(store);
    if (!store.trackingCookie || state === 'active') break;
    await new Promise(r => setTimeout(r, 500));
  }
  if (pending.url) chrome.tabs.update(tabId, { url: pending.url }).catch(() => {});
}

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  const urlStr = info.url || tab.url;
  // No URL means a site this extension has no access to: make sure the icon is grey there.
  if (!urlStr) {
    if (info.status === 'loading' || info.status === 'complete') updateBadge(tabId, null);
    return;
  }
  let url;
  try { url = new URL(urlStr); } catch (e) { return; }
  const store = storeForHost(url.hostname);

  // A new page: forget the old page's problems until its script reports again.
  if (info.url) tabIssues.delete(tabId);

  if (store && info.url) {
    const aff = affiliateInUrl(store, url);
    if (aff === 'ours') await patchTrack(store.key, { activatedAt: Date.now() });
    else if (aff === 'other') await patchTrack(store.key, { replacedAt: Date.now() });
  }

  if (info.status === 'complete') {
    if (store) await maybeReturn(tabId, store);
    updateBadge(tabId, store);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !tab.url) return updateBadge(tabId, null);
  try { updateBadge(tabId, storeForHost(new URL(tab.url).hostname)); } catch (e) { /* not a web page */ }
});

// ---- messages from content script and popup --------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const store = msg.storeKey ? STORES[msg.storeKey] : null;

    if (msg.type === 'status' && store) {
      sendResponse(await computeStatus(store));
      if (sender.tab) updateBadge(sender.tab.id, store);
    } else if (msg.type === 'activate' && store) {
      await chrome.storage.local.set({ returnTo: { store: store.key, url: msg.returnTo || null, at: Date.now() } });
      const opener = sender.tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      await chrome.tabs.create({ url: store.estoreUrl, index: opener ? opener.index + 1 : undefined });
      sendResponse({ ok: true });
    } else if (msg.type === 'order' && store) {
      const orders = await getAll('orders', []);
      const existing = orders.find(o => o.store === store.key &&
        (o.url === msg.url || (msg.orderNumber && o.orderNumber === msg.orderNumber)));
      if (existing) {
        if (!existing.orderNumber && msg.orderNumber) {
          existing.orderNumber = msg.orderNumber;
          await chrome.storage.local.set({ orders });
        }
      } else {
        orders.unshift({
          store: store.key,
          orderNumber: msg.orderNumber || null,
          url: msg.url,
          at: Date.now(),
          state: msg.state,
          activatedAt: msg.activatedAt,
          adblock: !!msg.adblock,
          excluded: msg.excluded || null
        });
        await chrome.storage.local.set({ orders: orders.slice(0, 200) });
      }
      sendResponse({ ok: true });
    } else if (msg.type === 'orders') {
      sendResponse(await getAll('orders', []));
    } else if (msg.type === 'clearOrders') {
      await chrome.storage.local.set({ orders: [] });
      sendResponse({ ok: true });
    } else if (msg.type === 'pageIssue' && store && sender.tab) {
      if (msg.level) tabIssues.set(sender.tab.id, { level: msg.level, message: msg.message });
      else tabIssues.delete(sender.tab.id);
      await updateBadge(sender.tab.id, store);
      sendResponse({ ok: true });
    } else if (msg.type === 'greet' && store) {
      // First landing on this store since Chrome started? (storage.session clears on restart)
      const greeted = (await chrome.storage.session.get('greeted')).greeted || {};
      const first = !greeted[store.key];
      if (first) {
        greeted[store.key] = Date.now();
        await chrome.storage.session.set({ greeted });
      }
      sendResponse({ first });
    } else if (msg.type === 'resetTracking' && store) {
      await patchTrack(store.key, { activatedAt: null, replacedAt: null });
      const greeted = (await chrome.storage.session.get('greeted')).greeted || {};
      delete greeted[store.key];
      await chrome.storage.session.set({ greeted });
      sendResponse({ ok: true });
    } else {
      sendResponse(null);
    }
  })();
  return true; // async response
});
