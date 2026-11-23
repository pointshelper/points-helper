// Each state: chip colours, chip word, headline, and whether "Activate" is the main button.
const STATE = {
  active: { bg: '#E1F5EE', fg: '#085041', chip: 'Active', badge: '✓', head: 'You’re earning points', primary: false },
  replaced: { bg: '#FCEBEB', fg: '#791F1F', chip: 'Replaced', badge: '!', head: 'Tracking was replaced', primary: true },
  expired: { bg: '#FAEEDA', fg: '#633806', chip: 'Expired', badge: '!', head: 'Activation expired', primary: true },
  none: { bg: '#F1EFE8', fg: '#444441', chip: 'Off', badge: '–', head: 'Not activated yet', primary: true }
};
const ORDER_WORD = { active: 'Tracked', replaced: 'Replaced', expired: 'Expired', none: 'Not tracked' };
const ORDER_COLOR = { active: '#0F6E56', replaced: '#A32D2D', expired: '#854F0B', none: '#6b7280' };
const ORDERS_URL = { amazon: 'https://www.amazon.ca/gp/css/order-history', walmart: 'https://www.walmart.ca/en/orders' };
const SHORT_NOTE = {
  walmart: 'Grocery, electronics and video games don’t earn.',
  amazon: 'Most departments earn, and the cart reminder shows items added before activating.'
};
const SHOWN = 3;
let showAll = false;

function h(tag, props = {}, ...kids) {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k);
  return n;
}

function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const hrs = Math.round(m / 60);
  if (hrs < 24) return hrs + (hrs === 1 ? ' hour ago' : ' hours ago');
  const d = Math.round(hrs / 24);
  return d + (d === 1 ? ' day ago' : ' days ago');
}

function shortDate(ts) {
  return new Date(ts).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}

function fullDate(ts) {
  return new Date(ts).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });
}

let currentStore = null;
let currentTab = null;
let currentState = null;

async function showCurrent() {
  const box = document.getElementById('current');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;
  let store = null;
  try { store = tab && tab.url ? storeForHost(new URL(tab.url).hostname) : null; } catch (e) { /* not a web page */ }
  currentStore = store;
  buildMenu();

  if (!store) {
    box.replaceChildren(h('div', { className: 'card', style: '--chip-bg:#F1EFE8;--chip-fg:#444441' },
      h('div', { className: 'hero', style: 'margin-top:0' },
        h('div', { className: 'badge' }, '–'),
        h('div', {}, h('b', {}, 'Off on this site'),
          h('span', {}, 'Points Helper only runs on Amazon.ca and Walmart.ca.'))
      ),
      h('div', { className: 'note' }, 'Chrome doesn’t let it see or read this page, and it sends nothing anywhere.')
    ));
    return;
  }

  const s = await chrome.runtime.sendMessage({ type: 'status', storeKey: store.key, tabId: tab.id });
  currentState = s.state;
  const st = STATE[s.state] || STATE.none;
  const replaced = s.replacedAt && s.replacedAt > (s.activatedAt || 0);
  let sub = replaced ? 'Another link took over ' + ago(s.replacedAt) + '. Activate again before you buy.'
    : s.state === 'expired' ? 'Last activated ' + ago(s.activatedAt) + '. Activate again before you buy.'
    : s.activatedAt ? 'Activated ' + ago(s.activatedAt)
    : 'Activate on the eStore before you shop.';
  let note = s.state === 'active' ? 'Finish buying in this session. ' + (SHORT_NOTE[store.key] || '')
    : SHORT_NOTE[store.key] || '';

  // What the page itself found (items that won't earn), so the toolbar "!" is explained here too.
  const page = await chrome.tabs.sendMessage(tab.id, { type: 'pageState' }).catch(() => null);
  let look = st;
  const issue = s.state === 'active' && page && page.issue;
  if (issue) {
    const msg = page.issue.message;
    look = page.issue.level === 'bad'
      ? { bg: '#FCEBEB', fg: '#791F1F', badge: '!' }
      : { bg: '#FAEEDA', fg: '#633806', badge: '!' };
    look.head = msg[0].toUpperCase() + msg.slice(1);
    sub = 'Tracking is on · activated ' + ago(s.activatedAt);
    note = null;
  }
  const showOnPage = async () => {
    await chrome.tabs.sendMessage(tab.id, { type: 'showOnPage' }).catch(() => {});
    window.close();
  };

  box.replaceChildren(h('div', { className: 'card', style: '--chip-bg:' + look.bg + ';--chip-fg:' + look.fg },
    h('div', { className: 'top' },
      h('span', {}, store.host[0].toUpperCase() + store.host.slice(1)),
      // Rates change with promotions, so link to the eStore instead of showing a fixed rate.
      h('a', { href: store.estoreUrl, target: '_blank', textContent: 'Current rates', style: 'font-size:11px;color:var(--brand)' })
    ),
    h('div', { className: 'hero' },
      h('div', { className: 'badge' }, look.badge),
      h('div', {}, h('b', {}, look.head), h('span', { title: s.activatedAt ? fullDate(s.activatedAt) : '' }, sub))
    ),
    s.adblockCookie ? h('div', { className: 'note' }, store.name + ' reports an ad blocker. Turn it off for this site so points track.') : null,
    note ? h('div', { className: 'note' }, note) : null,
    issue ? h('button', { className: 'btn primary', textContent: 'Show details on the page', onclick: showOnPage }) : null,
    h('button', {
      className: 'btn' + (st.primary ? ' primary' : ''),
      textContent: st.primary ? 'Activate on the eStore' : 'Activate again',
      onclick: async () => {
        await chrome.runtime.sendMessage({ type: 'activate', storeKey: store.key, returnTo: tab.url });
        window.close();
      }
    }),
    !issue && page && page.hidden
      ? h('button', { className: 'link', style: 'display:block;margin:8px auto 0', textContent: 'Show the helper on this page', onclick: showOnPage })
      : null
  ));
}

async function showOrders() {
  const box = document.getElementById('orders');
  const count = document.getElementById('count');
  const orders = (await chrome.runtime.sendMessage({ type: 'orders' })) || [];
  count.textContent = orders.length ? orders.length + ' logged' : '';
  if (!orders.length) {
    box.replaceChildren(h('div', { className: 'empty' }, 'No orders yet. They’re saved when you reach a store’s order confirmation page.'));
    return;
  }
  const list = showAll ? orders : orders.slice(0, SHOWN);
  const rows = list.map(orderRow);
  // replaceChildren prints "null" for an empty slot, so only add the toggle when it's needed.
  if (orders.length > SHOWN) {
    rows.push(h('button', {
      className: 'link',
      textContent: showAll ? 'Show fewer' : 'Show all ' + orders.length + ' orders',
      onclick: () => { showAll = !showAll; showOrders(); }
    }));
  }
  box.replaceChildren(...rows);
}

function orderRow(o) {
  const store = STORES[o.store];
  const name = store ? store.name : o.store;
  const num = o.orderNumber
    ? h('button', {
      className: 'num',
      textContent: o.orderNumber,
      title: 'Copy order number',
      onclick: async e => {
        await navigator.clipboard.writeText(o.orderNumber).catch(() => {});
        const b = e.currentTarget;
        b.textContent = 'Copied';
        setTimeout(() => { b.textContent = o.orderNumber; }, 1200);
      }
    })
    : h('a', { className: 'num', href: ORDERS_URL[o.store] || '#', target: '_blank', textContent: 'No number · see orders' });
  // The store's own favicon from Chrome's cache (like the bookmarks bar); the letter tile if there isn't one.
  const tile = h('div', { className: 'tile ' + o.store }, name[0]);
  if (store) {
    const icon = h('img', { className: 'logo', alt: '' });
    icon.onload = () => { if (icon.naturalWidth > 1) tile.replaceChildren(icon), tile.classList.add('has-logo'); };
    icon.src = chrome.runtime.getURL('/_favicon/?pageUrl=' + encodeURIComponent('https://www.' + store.host + '/') + '&size=32');
  }
  return h('div', { className: 'order', title: fullDate(o.at) },
    tile,
    h('div', { className: 'mid' }, h('div', {}, name), num),
    h('div', { className: 'side' },
      h('div', { style: 'color:' + (ORDER_COLOR[o.state] || '#6b7280') },
        '● ' + (ORDER_WORD[o.state] || o.state) + (o.adblock ? ' · ad blocker' : '')),
      h('div', {}, shortDate(o.at))
    )
  );
}

function buildMenu() {
  const menu = document.getElementById('menu');
  menu.replaceChildren(
    h('div', { className: 'label' }, 'Aeroplan eStore pages'),
    ...Object.values(STORES).map(s => h('a', { href: s.estoreUrl, target: '_blank', textContent: s.name })),
    h('hr'),
    currentStore ? h('button', {
      textContent: 'Reset ' + currentStore.name + ' activation',
      title: 'For testing: forget this store’s activation',
      onclick: async () => {
        await chrome.runtime.sendMessage({ type: 'resetTracking', storeKey: currentStore.key });
        menu.hidden = true;
        showCurrent();
      }
    }) : null,
    h('button', {
      textContent: 'Clear order log',
      onclick: async () => {
        menu.hidden = true;
        if (!confirm('Clear the order log?')) return;
        await chrome.runtime.sendMessage({ type: 'clearOrders' });
        showOrders();
      }
    })
  );
}

document.getElementById('more').addEventListener('click', e => {
  e.stopPropagation();
  const menu = document.getElementById('menu');
  menu.hidden = !menu.hidden;
});
document.addEventListener('click', e => {
  const menu = document.getElementById('menu');
  if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true;
});

// Opens the beta form with which build, store and status the report is about (nothing else).
const VERSION = chrome.runtime.getManifest().version;
document.getElementById('version').textContent = 'v' + VERSION;

// Always show the address: not everyone has an email app, so "Send feedback" may open nothing.
const addr = document.getElementById('addr');
if (FEEDBACK_EMAIL && !FEEDBACK_URL) {
  addr.hidden = false;
  addr.textContent = FEEDBACK_EMAIL;
  addr.addEventListener('click', async () => {
    await navigator.clipboard.writeText(FEEDBACK_EMAIL).catch(() => {});
    addr.textContent = 'Copied';
    setTimeout(() => { addr.textContent = FEEDBACK_EMAIL; }, 1200);
  });
}
document.getElementById('feedback').addEventListener('click', async () => {
  const btn = document.getElementById('feedback');
  const storeName = currentStore ? currentStore.name : 'other site';
  if (FEEDBACK_URL) {
    const url = new URL(FEEDBACK_URL);
    url.searchParams.set('version', VERSION);
    url.searchParams.set('store', storeName);
    url.searchParams.set('status', currentState || 'n/a');
    chrome.tabs.create({ url: url.toString() });
    window.close();
  } else if (FEEDBACK_EMAIL) {
    const subject = 'Points Helper feedback (v' + VERSION + ', ' + storeName + ')';
    const body = 'What happened?\n\n\nDid the points post? (yes / not yet / no / haven’t checked)\n\n\n' +
      '— Version ' + VERSION + ' · ' + storeName + ' · tracking: ' + (currentState || 'n/a');
    // Not everyone has an email app set up, so also copy the address and show it.
    await navigator.clipboard.writeText(FEEDBACK_EMAIL).catch(() => {});
    document.getElementById('feedbackHint').textContent = 'Address copied. Paste it into Gmail.';
    window.open('mailto:' + FEEDBACK_EMAIL + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body));
  } else {
    btn.textContent = 'Not set up yet';
  }
});

showCurrent();
showOrders();
