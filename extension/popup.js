// Each state: chip colours, chip word, headline, and whether "Activate" is the main button.
const STATE = {
  active: { bg: '#E1F5EE', fg: '#085041', chip: 'Active', badge: '✓', head: 'You’re earning points', primary: false },
  replaced: { bg: '#FCEBEB', fg: '#791F1F', chip: 'Replaced', badge: '!', head: 'Tracking was replaced', primary: true },
  expired: { bg: '#FAEEDA', fg: '#633806', chip: 'Expired', badge: '!', head: 'Activation expired', primary: true },
  none: { bg: '#F1EFE8', fg: '#444441', chip: 'Off', badge: '–', head: 'Not activated yet', primary: true }
};
const ORDER_WORD = { active: 'Tracked', replaced: 'Replaced', expired: 'Expired', none: 'Not tracked' };
// Stores whose tracking can't be confirmed (Amazon): say what we know, that you activated.
const ORDER_WORD_UNCONFIRMED = { active: 'Activated', none: 'Not activated' };
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
  const sure = confirmsTracking(store);
  let st = STATE[s.state] || STATE.none;
  if (s.state === 'active' && !sure) st = { ...st, chip: 'Activated', head: 'Activated for Aeroplan' };
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
    sub = (sure ? 'Tracking is on · activated ' : 'Activated ') + ago(s.activatedAt);
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
    s.state === 'active' && !sure && !issue ? h('div', { className: 'note' }, unconfirmedNote(store)) : null,
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
        // Read the button before awaiting: the event's currentTarget is null once the click has finished.
        const b = e.currentTarget;
        await navigator.clipboard.writeText(o.orderNumber).catch(() => {});
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
  const word = o.arrived ? 'Marked arrived'
    : (store && !confirmsTracking(store) && ORDER_WORD_UNCONFIRMED[o.state]) || ORDER_WORD[o.state] || o.state;
  const color = o.arrived ? 'var(--brand)' : ORDER_COLOR[o.state] || '#6b7280';
  return h('div', { className: 'order', title: fullDate(o.at) },
    tile,
    h('div', { className: 'mid' }, h('div', {}, name), num, arrivedLine(o)),
    h('div', { className: 'side' },
      h('div', { style: 'color:' + color }, '● ' + word + (o.adblock && !o.arrived ? ' · ad blocker' : '')),
      h('div', {}, shortDate(o.at))
    )
  );
}

// POI-34: you mark when an order's points land (optionally how many). It stays on this device;
// Points Helper never reads your Aeroplan or eStore account.
const CLAIM_AFTER_DAYS = 14;
const ESTORE_ORDERS = 'https://aeroplan.rewardops.com/en-CA/order-history';

async function markArrived(o, points, clear) {
  await chrome.runtime.sendMessage({ type: 'markArrived', store: o.store, at: o.at, points, clear: !!clear });
  showOrders();
}

function arrivedLine(o) {
  const line = h('div', { className: 'act' });
  if (o.arrived) {
    line.append(
      h('span', { className: 'done', title: 'You marked this on ' + fullDate(o.arrived.at) + '. Points Helper can’t see your Aeroplan account.' },
        '✓ ' + (o.arrived.points ? o.arrived.points.toLocaleString('en-CA') + ' pts' : 'Points') + ' arrived'),
      h('button', { className: 'undo', textContent: 'Undo', onclick: () => markArrived(o, null, true) })
    );
    return line;
  }
  const ask = h('button', { textContent: 'Points arrived?', title: 'Mark this order once its points show up in Aeroplan' });
  ask.onclick = () => {
    const input = h('input', { type: 'number', min: '1', step: '1', inputMode: 'numeric', placeholder: 'Points', title: 'How many points (optional)' });
    const save = () => markArrived(o, input.value ? Number(input.value) : null);
    input.onkeydown = e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') showOrders(); };
    line.replaceChildren(input,
      h('button', { className: 'save', textContent: 'Save', onclick: save }),
      h('button', { className: 'undo', textContent: 'Cancel', onclick: () => showOrders() }));
    input.focus();
  };
  line.append(ask);
  // Activated orders with nothing marked after two weeks: a gentle pointer to a missing points claim.
  const days = (Date.now() - o.at) / 86400000;
  if (o.state === 'active' && days >= CLAIM_AFTER_DAYS) {
    line.append(h('a', { href: ESTORE_ORDERS, target: '_blank', title: 'Still no points ' + CLAIM_AFTER_DAYS + '+ days after ordering? You can file a missing points claim from your eStore orders.' },
      'No points yet? Claim them'));
  }
  return line;
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
