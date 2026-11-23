(() => {
  const store = storeForHost(location.hostname);
  if (!store) return;

  const PROBLEM_KEY = 'pointsHelperDismissedProblem';
  // Set when you hide the pill with ×; it comes back when the status or the problem changes.
  const HIDE_KEY = 'pointsHelperHidden';
  const GREET_OPEN_KEY = 'pointsHelperGreetOpen';
  const ACT_SHOWN_KEY = 'pointsHelperActivationShown';
  const ACT_OPEN_KEY = 'pointsHelperActivationOpen'; // { path }: the activation card is open on this page
  const ACT_RETURN_KEY = 'pointsHelperReturnShown'; // the return (after activating) the card already opened for
  // Earlier versions kept the greeting open across pages with this flag; clear any leftover.
  sessionStorage.removeItem(GREET_OPEN_KEY);
  let greetChecked = false;
  let greeting = false;
  let host = null;
  let root = null;
  let expanded = false;

  // Where the pill sits, if the user dragged it: { right, top } in px from the window's top-right.
  // Saved for all stores; double-click the pill to put it back.
  let pillPos = null;
  let dragging = false;
  let justDragged = false;
  chrome.storage.local.get('pillPos').then(o => { pillPos = o.pillPos || null; placeWrap(); });

  function clampPos(p) {
    // Keep the pill on screen and leave room for the 300px panel to open to its left.
    return {
      right: Math.round(Math.min(Math.max(p.right, 8), Math.max(8, innerWidth - 316))),
      top: Math.round(Math.min(Math.max(p.top, 8), Math.max(8, innerHeight - 60)))
    };
  }

  function placeWrap() {
    const wrap = root && root.querySelector('.wrap');
    if (!wrap) return;
    const p = pillPos ? clampPos(pillPos) : { right: 16, top: 120 };
    wrap.style.right = p.right + 'px';
    wrap.style.top = p.top + 'px';
    wrap.style.setProperty('--top', p.top + 'px');
  }

  function startDrag(e, wrap) {
    if (e.button !== 0) return;
    const start = { x: e.clientX, y: e.clientY };
    const box = wrap.getBoundingClientRect();
    const from = { right: innerWidth - box.right, top: box.top };
    let moved = false;
    const move = ev => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 5) return;
      moved = true;
      dragging = true;
      pillPos = clampPos({ right: from.right - dx, top: from.top + dy });
      placeWrap();
      ev.preventDefault();
    };
    const up = () => {
      removeEventListener('pointermove', move, true);
      removeEventListener('pointerup', up, true);
      if (!moved) return;
      dragging = false;
      justDragged = true;
      setTimeout(() => { justDragged = false; }, 0);
      chrome.storage.local.set({ pillPos });
    };
    addEventListener('pointermove', move, true);
    addEventListener('pointerup', up, true);
  }
  let lastHref = null;
  let baitResult = null;
  const loggedOrders = new Map(); // confirmation URL -> what to show

  // ---- checks done in the page ---------------------------------------------

  function detectAdblockBait() {
    if (baitResult !== null) return Promise.resolve(baitResult);
    return new Promise(resolve => {
      const bait = document.createElement('div');
      bait.className = 'adsbox ad-banner ad-placement pub_300x250 textads';
      bait.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:10px;height:10px;';
      bait.innerHTML = '&nbsp;';
      document.body.appendChild(bait);
      setTimeout(() => {
        const cs = getComputedStyle(bait);
        baitResult = bait.offsetHeight === 0 || cs.display === 'none' || cs.visibility === 'hidden';
        bait.remove();
        resolve(baitResult);
      }, 300);
    });
  }

  // The page's category: its breadcrumb trail, or (Amazon devices have none) the department bar's name.
  function categoryText(doc) {
    const crumbs = store.breadcrumbs
      .map(sel => doc.querySelector(sel))
      .filter(Boolean)
      .map(el => el.textContent.replace(/\s+/g, ' ').trim())
      .join(' ')
      .trim();
    if (crumbs || store.key !== 'amazon') return crumbs;
    const dept = doc.querySelector('#nav-subnav a');
    return dept ? dept.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  function excludedCategory() {
    const text = categoryText(document);
    if (!text.trim()) return null;
    const hit = store.excluded.find(([, re]) => re.test(text));
    if (hit) {
      return 'This looks like ' + hit[0] + ', which doesn’t earn Aeroplan points at ' + store.name +
        ' (based on the page’s category).';
    }
    if (store.eligible && !store.eligible.some(re => re.test(text))) {
      const crumb = text.replace(/\s+/g, ' ').trim().split(/\s*[›>\/]\s*/).slice(0, 2).join(' › ');
      return crumb + ' isn’t on ' + store.name + '’s list of categories that earn Aeroplan points.';
    }
    return null;
  }

  function orderNumberOnPage() {
    const m = (document.body.innerText || '').match(store.orderNumber);
    if (m) return m[1];
    // Amazon often only puts the number in links ("Review or edit your order"): orderID=702-...
    for (const a of document.querySelectorAll('a[href*="order" i]')) {
      const hm = a.href.match(/order[-_]?id=([0-9][0-9-]{6,})/i);
      if (hm) return decodeURIComponent(hm[1]);
    }
    const input = document.querySelector('input[name*="orderId" i], input[name*="orderID" i]');
    if (input && /\d{5,}/.test(input.value)) return input.value;
    return null;
  }

  // ---- Amazon: items already in the cart when you activate don't earn ------

  // Amazon stamps every cart item with when it was added (data-addedtime, in ms).
  function cartItemsIn(doc) {
    return [...doc.querySelectorAll('#sc-active-cart .sc-list-item[data-asin]')]
      .filter(n => n.dataset.asin)
      .map(n => ({
        asin: n.dataset.asin,
        addedAt: Number(n.getAttribute('data-addedtime')) || null,
        title: (n.getAttribute('data-producttitle') ||
          (n.querySelector('.sc-product-title, .a-truncate-full') || {}).innerText || 'An item')
          .trim().replace(/\s+/g, ' ').slice(0, 70)
      }));
  }

  // Items added before you activated don't earn on Amazon.
  // The cart's items: from this page when it's the cart, otherwise from the cart page
  // (checkout doesn't list add times or product IDs). Re-read at most every 15 seconds.
  let amazonCartCache = null;
  async function amazonCartItems() {
    if (document.querySelector('#sc-active-cart')) return cartItemsIn(document);
    if (amazonCartCache && Date.now() - amazonCartCache.at < 15000) return amazonCartCache.items;
    try {
      const res = await fetch('/gp/cart/view.html', { credentials: 'include' });
      const items = cartItemsIn(new DOMParser().parseFromString(await res.text(), 'text/html'));
      amazonCartCache = { at: Date.now(), items };
      return items;
    } catch (e) {
      return [];
    }
  }

  async function itemsAddedBeforeActivation(activatedAt) {
    if (store.key !== 'amazon' || !activatedAt) return [];
    return (await amazonCartItems()).filter(i => i.addedAt && i.addedAt < activatedAt);
  }

  // ---- Amazon: which cart items are in categories that don't earn ----------

  // Each product page is read once in the background for its breadcrumb trail
  // ("Toys & Games › Building Sets"), then judged with the same lists as product pages.
  const AMZ_CATS_KEY = 'pointsHelperAmazonCats2';
  const amzFetches = new Map();

  function amazonLabelForCrumb(text) {
    if (!text) return null;
    const hit = store.excluded.find(([, re]) => re.test(text));
    if (hit) return hit[0];
    if (store.eligible && !store.eligible.some(re => re.test(text))) {
      return text.split(/\s*›\s*/)[0] || 'Not an earning category';
    }
    return null;
  }

  function fetchAmazonCrumb(asin) {
    if (amzFetches.has(asin)) return amzFetches.get(asin);
    const job = fetch('/dp/' + asin, { credentials: 'include' })
      .then(r => r.text())
      .then(html => {
        const d = new DOMParser().parseFromString(html, 'text/html');
        const cats = readJSON(AMZ_CATS_KEY, {});
        cats[asin] = categoryText(d);
        writeJSON(AMZ_CATS_KEY, cats);
      })
      .catch(() => {});
    amzFetches.set(asin, job);
    return job;
  }

  async function amazonCartCheck(page) {
    if (store.key !== 'amazon' || (page !== 'cart' && page !== 'checkout')) return null;
    const items = await amazonCartItems();
    if (!items.length) return null;
    const cats = readJSON(AMZ_CATS_KEY, {});
    const missing = items.filter(i => !(i.asin in cats));
    if (missing.length) {
      (async () => {
        await inBatches(missing.map(i => i.asin), fetchAmazonCrumb, 2);
        refresh(true);
      })();
    }
    const known = items.filter(i => i.asin in cats);
    return {
      total: items.length,
      checking: missing.length,
      unknown: known.filter(i => !cats[i.asin]).length,
      excluded: known
        .filter(i => cats[i.asin] && amazonLabelForCrumb(cats[i.asin]))
        .map(i => ({ id: i.asin, title: i.title.slice(0, 60), label: amazonLabelForCrumb(cats[i.asin]) }))
    };
  }

  // ---- Walmart: which cart items are in categories that don't earn ---------

  // Walmart's cart doesn't show categories, so each product page is read once in the
  // background (its HTML has "categoryPathName":"Root/Grocery/...") and remembered.
  // Rows without a product link (folded groups, checkout) are matched by name with a search.
  const CATS_KEY = 'pointsHelperWalmartCats';
  const IDS_KEY = 'pointsHelperWalmartIds';
  const catFetches = new Map();
  const idFetches = new Map();

  function readJSON(key, fallback) {
    try { return JSON.parse(sessionStorage.getItem(key)) || fallback; } catch (e) { return fallback; }
  }
  function writeJSON(key, value) {
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* full */ }
  }
  const cleanTitle = t => (t || '').replace(/\s+/g, ' ').trim();
  const slug = t => cleanTitle(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  // Cart rows are the product links that sit next to a "Remove" button
  // (recommendation carousels have "Add" buttons; "Saved for later" is skipped).
  function walmartCartItems() {
    const page = document.querySelector('[data-testid="cart-page"]') || document;
    const found = new Map();
    for (const a of page.querySelectorAll('a[href*="/ip/"]')) {
      if (a.closest('[data-testid="sfl-line-items"]')) continue;
      const href = a.getAttribute('href').split('?')[0];
      const id = href.split('/').pop();
      if (!id || found.has(id)) continue;
      let p = a;
      for (let k = 0; k < 10 && p; k++) {
        p = p.parentElement;
        if (!p) break;
        const ids = new Set([...p.querySelectorAll('a[href*="/ip/"]')]
          .map(x => x.getAttribute('href').split('?')[0].split('/').pop()));
        if (ids.size > 1) break;
        if ([...p.querySelectorAll('button')].some(b => /^\s*remove\s*$/i.test(b.innerText))) {
          const img = p.querySelector('img[alt]');
          const title = cleanTitle(a.innerText.trim() || (img && img.alt) || a.getAttribute('aria-label') || 'An item');
          found.set(id, { id, href, title });
          break;
        }
      }
    }
    return [...found.values()];
  }

  // Names of items listed without a product link:
  // folded groups (a row of thumbnails) on the cart, and every item on checkout.
  function walmartUnlinkedTitles(page) {
    const titles = new Set();
    if (page === 'cart') {
      const root = document.querySelector('[data-testid="cart-page"]');
      const sfl = root && root.querySelector('[data-testid="sfl-line-items"]');
      if (root) {
        for (const img of root.querySelectorAll('[data-testid="collapsedItemList"] img[alt]')) {
          if (!(sfl && sfl.contains(img))) titles.add(cleanTitle(img.alt));
        }
      }
    } else {
      const uuid = /^(.+)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
      for (const scope of document.querySelectorAll('[data-testid$="fulfillment-items"]')) {
        for (const img of scope.querySelectorAll('[data-testid="collapsedItemList"] img[alt]')) {
          titles.add(cleanTitle(img.alt));
        }
        for (const row of scope.querySelectorAll('[data-testid]')) {
          const m = row.dataset.testid.match(uuid);
          if (m) titles.add(cleanTitle(m[1]));
        }
      }
    }
    titles.delete('');
    return [...titles];
  }

  // "Root/Household supplies/Paper Products" -> 'Household supplies' if that department doesn't earn.
  function excludedLabelForPath(path) {
    const dept = (path || '').split('/').slice(1, 3).join(' / ');
    if (!dept) return null;
    const hit = store.excluded.find(([, re]) => re.test(dept));
    return hit ? hit[0] : null;
  }

  function fetchCategory(item) {
    if (catFetches.has(item.id)) return catFetches.get(item.id);
    const job = fetch(item.href, { credentials: 'include' })
      .then(r => r.text())
      .then(html => {
        const m = html.match(/"categoryPathName":"([^"]*)"/);
        let path = '';
        try { path = m ? JSON.parse('"' + m[1] + '"') : ''; } catch (e) { path = m ? m[1] : ''; }
        const cats = readJSON(CATS_KEY, {});
        cats[item.id] = path;
        writeJSON(CATS_KEY, cats);
      })
      .catch(() => {});
    catFetches.set(item.id, job);
    return job;
  }

  // Search Walmart for the exact name and take the first result whose link matches it.
  function findProduct(title) {
    if (idFetches.has(title)) return idFetches.get(title);
    const want = slug(title).slice(0, 15);
    // Long names sometimes return nothing, so fall back to the first few words.
    const words = title.replace(/[^\w\s&'-]/g, ' ').split(/\s+/).filter(Boolean);
    const queries = [...new Set([title, words.slice(0, 6).join(' '), words.slice(0, 3).join(' ')])];
    const job = (async () => {
      let hit = null;
      for (const q of queries) {
        const html = await fetch('/en/search?q=' + encodeURIComponent(q), { credentials: 'include' }).then(r => r.text());
        for (const m of html.matchAll(/\/en\/ip\/([^\/"?#\\\s]+)\/([A-Za-z0-9]+)/g)) {
          if (m[1].toLowerCase().startsWith(want)) {
            hit = { id: m[2], href: '/en/ip/' + m[1] + '/' + m[2] };
            break;
          }
        }
        if (hit) break;
      }
      const ids = readJSON(IDS_KEY, {});
      ids[title] = hit;
      writeJSON(IDS_KEY, ids);
    })().catch(() => {});
    idFetches.set(title, job);
    return job;
  }

  async function inBatches(list, fn, size) {
    for (let i = 0; i < list.length; i += size) await Promise.all(list.slice(i, i + size).map(fn));
  }

  // Returns what's known now; looks up the rest in the background and refreshes when done.
  function walmartCartCheck(page) {
    if (store.key !== 'walmart' || (page !== 'cart' && page !== 'checkout')) return null;
    const linked = page === 'cart' ? walmartCartItems() : [];
    const linkedNames = new Set(linked.map(i => slug(i.title)));
    const ids = readJSON(IDS_KEY, {});
    const byId = new Map(linked.map(i => [i.id, i]));
    const toFind = [];
    let unknown = 0;
    for (const title of walmartUnlinkedTitles(page)) {
      if (linkedNames.has(slug(title))) continue;
      if (!(title in ids)) toFind.push(title);
      else if (ids[title]) { if (!byId.has(ids[title].id)) byId.set(ids[title].id, { ...ids[title], title }); }
      else unknown++;
    }
    const items = [...byId.values()];
    if (!items.length && !toFind.length && !unknown) return null;
    const cats = readJSON(CATS_KEY, {});
    const missing = items.filter(i => !(i.id in cats));
    if (missing.length || toFind.length) {
      (async () => {
        await inBatches(toFind, findProduct, 3);
        const found = readJSON(IDS_KEY, {});
        const more = toFind.map(t => found[t] && { ...found[t], title: t }).filter(Boolean);
        await inBatches([...missing, ...more], fetchCategory, 4);
        refresh(true);
      })();
    }
    return {
      total: items.length + toFind.length + unknown,
      checking: missing.length + toFind.length,
      unknown,
      excluded: items
        .filter(i => i.id in cats && excludedLabelForPath(cats[i.id]))
        .map(i => ({ id: i.id, title: i.title.slice(0, 60), label: excludedLabelForPath(cats[i.id]) }))
    };
  }

  // "LEGO Friends Cat Birthday Party & Tree House Building Toy - ..." -> "LEGO Friends Cat Birthday Party & Tree…"
  function shortTitle(t, max = 42) {
    t = (t || '').replace(/\s+/g, ' ').trim();
    if (t.length <= max) return t;
    const cut = t.slice(0, max + 1);
    const at = cut.lastIndexOf(' ');
    return (at > 20 ? cut.slice(0, at) : t.slice(0, max)).replace(/[\s,;:–—&-]+$/, '') + '…';
  }

  // Which cart items won't earn, grouped by category, and what that means for the rest.
  // preCart: Amazon items added before activating, which don't earn either, so they aren't "the other items".
  function cartCheckNote(cc, preCart = []) {
    const notEarning = new Set([...cc.excluded.map(i => i.id), ...preCart.map(i => i.asin)]);
    const others = cc.total - notEarning.size - (cc.unknown || 0);
    const groups = new Map();
    for (const i of cc.excluded) {
      if (!groups.has(i.label)) groups.set(i.label, []);
      groups.get(i.label).push(i.title.replace(/\s*quantity\s*\d+\s*$/i, ''));
    }
    return el('div', { class: 'warn bad' },
      el('div', { class: 'items' }, [...groups].map(([label, names]) =>
        el('div', { class: 'group' },
          el('div', { class: 'item' },
            el('span', { class: 'name' }, label),
            el('span', { class: 'cat' }, names.length + ' item' + (names.length === 1 ? '' : 's'))
          ),
          el('div', { class: 'names', title: names.join('\n') },
            names.slice(0, 3).map(t => shortTitle(t, 30)).join(' · ') +
            (names.length > 3 ? ' · +' + (names.length - 3) + ' more' : ''))
        )
      )),
      el('div', { class: 'more' }, others > 0
        ? (others === 1 ? 'The other item earns as usual.' : 'The other ' + others + ' items earn as usual.')
        : 'Nothing in this cart earns Aeroplan points.')
    );
  }

  // Keep looking for a few seconds, since parts of the confirmation page load late.
  async function logOrder(status, adblock) {
    let orderNumber = orderNumberOnPage();
    for (let i = 0; !orderNumber && i < 6; i++) {
      await new Promise(r => setTimeout(r, 1500));
      orderNumber = orderNumberOnPage();
    }
    await chrome.runtime.sendMessage({
      type: 'order', storeKey: store.key, orderNumber, url: location.href,
      state: status.state, activatedAt: status.activatedAt, adblock
    });
    return orderNumber;
  }

  function ago(ts) {
    if (!ts) return '';
    const min = Math.round((Date.now() - ts) / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return min + ' min ago';
    const h = Math.floor(min / 60);
    if (h < 48) return h + ' h ago';
    return Math.floor(h / 24) + ' days ago';
  }

  // ---- UI --------------------------------------------------------------------

  const CSS = `
    :host { all: initial; }
    /* Top right, below the store's header (which holds its cart button). Same look as the popup. */
    .wrap { position: fixed; right: 16px; top: 120px; --top: 120px; z-index: 2147483647;
      display: flex; flex-direction: column; align-items: flex-end;
      font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111; }
    .pill { order: -1; display: flex; align-items: center; gap: 8px; padding: 7px 10px 7px 12px; border-radius: 999px;
      background: #fff; border: 1px solid #e3e5e8; box-shadow: 0 4px 14px rgba(0,0,0,.12);
      font-weight: 500; cursor: grab; user-select: none; touch-action: none; }
    .pill.alert { border-color: var(--c); }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--c); flex: none; box-shadow: 0 0 0 3px var(--ring); }
    .hide { margin-left: 2px; padding: 0 2px; color: #9aa0a6; font-size: 15px; line-height: 1; cursor: pointer; font-weight: 400; }
    .hide:hover { color: #111; }
    .panel { width: 300px; background: #fff; border-radius: 14px; border: 1px solid #eceef0; box-shadow: 0 10px 30px rgba(0,0,0,.16);
      padding: 14px; margin-top: 8px; max-height: calc(100vh - var(--top) - 70px); overflow-y: auto; box-sizing: border-box; }
    .top { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #6b7280; }
    .top .where { flex: 1; }
    .top { cursor: grab; touch-action: none; }
    .top .x { cursor: pointer; }
    .chip { font-size: 11px; padding: 3px 8px; border-radius: 999px; background: var(--chip-bg); color: var(--chip-fg); }
    .x { border: 0; background: none; font-size: 18px; line-height: 1; cursor: pointer; color: #9aa0a6; padding: 0 2px; }
    .x:hover { color: #111; }
    .hero { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
    .badge { width: 36px; height: 36px; border-radius: 50%; flex: none; display: flex; align-items: center; justify-content: center;
      font-size: 17px; font-weight: 600; background: var(--chip-bg); color: var(--chip-fg); }
    .headline { font-size: 16px; font-weight: 600; }
    .sub { font-size: 12px; color: #6b7280; }
    .ok, .warn, .note { margin-top: 10px; padding: 9px 10px; border-radius: 8px; font-size: 12px; }
    .ok { background: #E1F5EE; color: #085041; }
    .warn { background: #FAEEDA; color: #633806; }
    .warn.bad { background: #FCEBEB; color: #791F1F; }
    .small { margin-top: 10px; font-size: 11px; color: #6b7280; }
    .items { display: flex; flex-direction: column; gap: 6px; }
    .item { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }
    .item .name { font-weight: 500; }
    .item .cat { flex: none; font-size: 11px; opacity: .8; }
    .more { margin-top: 8px; font-size: 11px; opacity: .85; }
    .names { margin-top: 2px; font-size: 11px; opacity: .85; }
    details { margin-top: 10px; border-radius: 8px; background: #f6f7f8; padding: 8px 10px; font-size: 12px; color: #444; }
    summary { cursor: pointer; color: #6b7280; }
    ul { margin: 6px 0 0; padding-left: 16px; }
    li { margin: 3px 0; }
    .btn { display: block; margin-top: 12px; width: 100%; padding: 9px; border-radius: 8px; border: 1px solid #d9dce0;
      background: #fff; color: #111; font: inherit; font-weight: 500; cursor: pointer; }
    .btn:hover { background: #f6f7f8; }
    .btn.primary { background: #0F6E56; border-color: #0F6E56; color: #fff; }
    .btn.primary:hover { background: #0b5a46; }
    a { color: inherit; }
  `;

  const LABEL = {
    active: ['#0F6E56', 'Aeroplan tracking active'],
    replaced: ['#A32D2D', 'Tracking replaced — activate again'],
    expired: ['#854F0B', 'Activation expired'],
    none: ['#6b7280', 'Not activated for Aeroplan']
  };
  // Card look per state, matching the popup.
  const LOOK = {
    active: { bg: '#E1F5EE', fg: '#085041', chip: 'Active', badge: '✓', head: 'You’re earning points' },
    replaced: { bg: '#FCEBEB', fg: '#791F1F', chip: 'Replaced', badge: '!', head: 'Tracking was replaced' },
    expired: { bg: '#FAEEDA', fg: '#633806', chip: 'Expired', badge: '!', head: 'Activation expired' },
    none: { bg: '#F1EFE8', fg: '#444441', chip: 'Off', badge: '–', head: 'Not activated yet' }
  };
  const RING = { '#0F6E56': '#E1F5EE', '#A32D2D': '#FCEBEB', '#c62828': '#FCEBEB', '#854F0B': '#FAEEDA', '#b26a00': '#FAEEDA', '#6b7280': '#F1EFE8' };

  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'class') n.className = v;
      else n.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null) n.append(kid);
    return n;
  }

  function ensureHost() {
    if (host && document.documentElement.contains(host)) return;
    host = document.createElement('points-helper');
    root = host.attachShadow({ mode: 'closed' });
    document.documentElement.appendChild(host);
  }

  function removeHost() {
    if (host) host.remove();
    host = null;
    root = null;
  }

  function activate() {
    chrome.runtime.sendMessage({ type: 'activate', storeKey: store.key, returnTo: location.href });
  }

  function render(status, ctx) {
    if (dragging) return;
    ensureHost();
    const [color, label] = LABEL[status.state];
    const wrap = el('div', { class: 'wrap', style: '--c:' + color });

    const warnings = [];
    if (status.state === 'replaced') {
      warnings.push(['bad', 'Another site or extension replaced the Aeroplan tracking. Activate again before you buy.']);
    }
    if (status.state === 'expired') {
      warnings.push(['bad', 'Your activation is older than 24 hours. Activate again, then add items to the cart.']);
    }
    if (status.adblockCookie || ctx.adblockBait) {
      warnings.push(['', 'An ad blocker looks active. Pause it on ' + store.host + ' before you check out, or the sale may not be reported.']);
    }
    if (ctx.excluded) {
      warnings.push(['', ctx.excluded]);
    }
    if (ctx.preCart.length) {
      // Same compact layout as the category box: a count, a few short names, then what to do.
      const n = ctx.preCart.length;
      const names = ctx.preCart.map(i => i.title);
      warnings.push(['bad', el('div', { class: 'warn bad' },
        el('div', { class: 'items' }, el('div', { class: 'group' },
          el('div', { class: 'item' },
            el('span', { class: 'name' }, 'Added before you activated'),
            el('span', { class: 'cat' }, n + ' item' + (n === 1 ? '' : 's'))
          ),
          el('div', { class: 'names', title: names.join('\n') },
            names.slice(0, 3).map(t => shortTitle(t, 30)).join(' · ') + (n > 3 ? ' · +' + (n - 3) + ' more' : ''))
        )),
        el('div', { class: 'more' }, (n === 1 ? 'It won’t earn. Remove it from the cart and add it again.'
          : 'They won’t earn. Remove them from the cart and add them again.'))
      )]);
    }
    // A reminder, not a problem: shown as a quiet line, not a coloured note.
    const reminder = !ctx.preCart.length && store.key === 'amazon' && ctx.page === 'cart' &&
      status.state === 'active' && cartItemsIn(document).length
      ? 'Only items added after you activated (' + ago(status.activatedAt) + ') earn points.' : null;
    const cc = ctx.cartCheck;
    if (cc && cc.excluded.length) {
      warnings.push(['bad', cartCheckNote(cc, ctx.preCart)]);
    }

    const close = el('button', { class: 'x', title: 'Close', onclick: e => {
      e.stopPropagation();
      expanded = false;
      greeting = false;
      sessionStorage.removeItem(GREET_OPEN_KEY);
      sessionStorage.removeItem(ACT_OPEN_KEY);
      // Don't pop open again for the same problem.
      if (ctx.problemKey) sessionStorage.setItem(PROBLEM_KEY, ctx.problemKey);
      refresh(true);
    } }, '×');

    const active = status.state === 'active';
    if (expanded) {
      let look = LOOK[status.state] || LOOK.none;
      let sub = status.state === 'replaced' ? 'Activate again before you buy.'
        : status.activatedAt && status.state !== 'none' ? 'Activated ' + ago(status.activatedAt)
        : 'Earn Aeroplan points on eligible items';
      // Tracking is fine but the item or cart won't earn: lead with that, not "You're earning points".
      if (active) {
        const onNote = 'Tracking is on · activated ' + ago(status.activatedAt);
        const bad = { bg: '#FCEBEB', fg: '#791F1F', badge: '!' };
        const warn = { bg: '#FAEEDA', fg: '#633806', badge: '!' };
        if (ctx.preCart.length) {
          look = { ...bad, head: 'Some cart items won’t earn' };
          sub = onNote;
        } else if (cc && cc.excluded.length) {
          look = { ...bad, head: cc.excluded.length === cc.total ? 'Nothing in your cart earns'
            : cc.excluded.length + ' of ' + cc.total + ' cart items won’t earn' };
          sub = onNote;
        } else if (ctx.excluded) {
          look = { ...warn, head: 'This item won’t earn' };
          sub = onNote;
        }
      }
      wrap.append(el('div', { class: 'panel', style: '--chip-bg:' + look.bg + ';--chip-fg:' + look.fg },
        // The card's top row is a drag handle too: on pages with no pill (home, search) it's the only one.
        el('div', { class: 'top', onpointerdown: e => { if (!e.target.closest('.x')) startDrag(e, wrap); } },
          el('span', { class: 'where' }, store.host[0].toUpperCase() + store.host.slice(1)),
          close
        ),
        el('div', { class: 'hero' },
          el('div', { class: 'badge' }, look.badge),
          el('div', {}, el('div', { class: 'headline' }, look.head), el('div', { class: 'sub' }, sub))
        ),
        active && !warnings.length && !(cc && cc.total) && !ctx.orderLogged
          ? el('div', { class: 'ok' }, 'You’re set. Finish buying in this session.')
          : null,
        warnings.map(([cls, text]) => text instanceof Element ? text : el('div', { class: 'warn ' + cls }, text)),
        // Category lists change (e.g. Black Friday), so always point to the eStore's current list:
        // an item marked as earning may have been dropped since this version was made.
        el('div', { class: 'small' }, 'The eStore updates its eligible categories and rates from time to time. ',
          el('a', { href: store.estoreUrl, target: '_blank', rel: 'noopener' }, 'See the current list')),
        reminder ? el('div', { class: 'small' }, reminder) : null,
        cc && cc.checking
          ? el('div', { class: 'small' }, 'Checking the categories of ' + cc.checking + ' cart item' + (cc.checking > 1 ? 's' : '') + '…')
          : null,
        cc && cc.unknown && !cc.checking
          ? el('div', { class: 'warn' }, cc.unknown + ' cart item' + (cc.unknown === 1 ? '' : 's') +
            ' couldn’t be matched to a product category, so ' + (cc.unknown === 1 ? 'it wasn’t' : 'they weren’t') + ' checked.')
          : null,
        cc && cc.total && !cc.checking && !cc.excluded.length && cc.total > cc.unknown
          ? el('div', { class: 'ok' }, cc.unknown
            ? 'The other ' + (cc.total - cc.unknown) + ' cart item' + (cc.total - cc.unknown > 1 ? 's are' : ' is') + ' in categories that earn.'
            : 'All ' + cc.total + ' cart item' + (cc.total > 1 ? 's are' : ' is') + ' in categories that earn.')
          : null,
        ctx.orderLogged ? el('div', { class: 'ok' }, 'Order ' + ctx.orderLogged + ' saved to your log.') : null,
        el('details', {},
          el('summary', {}, 'What counts'),
          el('ul', {}, store.rules.map(r => el('li', {}, r)))
        ),
        el('button', { class: 'btn' + (active ? '' : ' primary'), onclick: activate },
          active ? 'Activate again' : 'Activate on the eStore'),
        active ? null : el('div', { class: 'small' }, 'Opens the eStore page for ' + store.name +
          '. Click “Shop and earn” there and you’ll come back here.')
      ));
    }

    if (ctx.page) {
      // Say the important thing on the pill itself; details stay one click away.
      let text = label;
      let pillColor = color;
      if (ctx.preCart.length) {
        const n = ctx.preCart.length;
        text = 'Tracking active · ' + n + ' cart item' + (n === 1 ? '' : 's') + ' won’t earn';
        pillColor = '#c62828';
      } else if (cc && cc.excluded.length) {
        const n = cc.excluded.length;
        text = (active ? 'Tracking active' : label) + ' · ' +
          (n === cc.total ? 'Nothing in your cart earns' : n + ' of ' + cc.total + ' cart items won’t earn');
        pillColor = '#c62828';
      } else if (cc && cc.unknown && !cc.checking) {
        text = (active ? 'Tracking active' : label) + ' · ' + cc.unknown + ' cart item' + (cc.unknown === 1 ? '' : 's') + ' not checked';
        pillColor = '#b26a00';
      } else if (ctx.excluded) {
        text = (active ? 'Tracking active' : label) + ' · This item won’t earn';
        pillColor = '#b26a00';
      } else if (warnings.length && active) {
        text = label + ' · ' + warnings.length + ' note' + (warnings.length > 1 ? 's' : '');
      }
      const pill = el('div', {
        class: 'pill' + (pillColor !== LABEL.active[0] ? ' alert' : ''),
        style: '--c:' + pillColor + ';--ring:' + (RING[pillColor] || '#F1EFE8'),
        title: (ctx.excluded ? ctx.excluded + '\n' : '') + 'Click for details · drag to move · double-click to reset',
        onpointerdown: e => startDrag(e, wrap),
        ondblclick: () => {
          pillPos = null;
          chrome.storage.local.remove('pillPos');
          placeWrap();
        },
        onclick: () => {
          if (justDragged) return;
          if (expanded && ctx.problemKey) sessionStorage.setItem(PROBLEM_KEY, ctx.problemKey);
          expanded = !expanded;
          sessionStorage.removeItem(ACT_OPEN_KEY); // you opened or closed it yourself, so it stays the way you left it
          if (!expanded) { greeting = false; sessionStorage.removeItem(GREET_OPEN_KEY); }
          refresh(true);
        }
      },
        el('span', { class: 'dot' }),
        el('span', {}, text),
        el('span', {
          class: 'hide',
          title: 'Hide until something changes (the toolbar icon still shows the status)',
          onpointerdown: e => e.stopPropagation(),
          onclick: e => {
            e.stopPropagation();
            sessionStorage.setItem(HIDE_KEY, ctx.hideSig);
            sessionStorage.removeItem(GREET_OPEN_KEY);
            greeting = false;
            expanded = false;
            removeHost();
          }
        }, '×')
      );
      wrap.append(pill);
    }

    root.replaceChildren(el('style', {}, CSS), wrap);
    placeWrap();
  }

  // ---- main loop -------------------------------------------------------------

  // After the extension is reloaded or auto-updated, this copy of the script keeps running in open
  // tabs but can't reach the extension any more ("Extension context invalidated"). Stop it quietly:
  // clear the timers and remove the card; the page's next load gets the new version.
  const timers = [];
  let shutDown = false;
  function stale() {
    if (shutDown) return true;
    if (chrome.runtime && chrome.runtime.id) return false;
    shutDown = true;
    timers.forEach(clearInterval);
    if (host) host.remove();
    return true;
  }

  function refresh(force) {
    if (stale()) return Promise.resolve();
    return refreshPage(force).catch(e => { if (!stale()) throw e; });
  }

  async function refreshPage(force) {
    if (!force && location.href === lastHref) return;
    lastHref = location.href;

    const page = pageType(store, location.pathname);

    let status;
    try {
      status = await chrome.runtime.sendMessage({ type: 'status', storeKey: store.key });
    } catch (e) {
      return; // extension was reloaded; this page's script is stale
    }
    if (!status) return;

    // Pop the card open the first time you land on this store since Chrome started.
    // Like the activation card, it stays on this page only and closes when you go to another one.
    if (!greetChecked) {
      greetChecked = true;
      const r = await chrome.runtime.sendMessage({ type: 'greet', storeKey: store.key }).catch(() => null);
      if (r && r.first) sessionStorage.setItem(ACT_OPEN_KEY, JSON.stringify({ path: location.pathname }));
    }
    // Just came back from the eStore: open the card once for this activation, so you see
    // "You're earning points" even on pages with no pill (home, search).
    if (status.state === 'active' && status.activatedAt && Date.now() - status.activatedAt < 2 * 60 * 1000 &&
        sessionStorage.getItem(ACT_SHOWN_KEY) !== String(status.activatedAt)) {
      sessionStorage.setItem(ACT_SHOWN_KEY, String(status.activatedAt));
      sessionStorage.setItem(ACT_OPEN_KEY, JSON.stringify({ at: status.activatedAt, path: location.pathname }));
    }
    // The extension then sends you back to the page you started from: open it there too.
    if (status.returnedAt && Date.now() - status.returnedAt < 30 * 1000 &&
        location.pathname === status.returnedPath &&
        sessionStorage.getItem(ACT_RETURN_KEY) !== String(status.returnedAt)) {
      sessionStorage.setItem(ACT_RETURN_KEY, String(status.returnedAt));
      sessionStorage.setItem(ACT_OPEN_KEY, JSON.stringify({ path: location.pathname }));
    }
    // A card that opened by itself (greeting or activation) stays open only on that page,
    // and closes as soon as you go to another one.
    // Compares the path, not the full URL, since stores tidy their query strings after loading.
    const actOpen = readJSON(ACT_OPEN_KEY, null);
    if (actOpen) {
      if (location.pathname === actOpen.path) {
        expanded = true;
      } else {
        sessionStorage.removeItem(ACT_OPEN_KEY);
        if (!greeting) expanded = false;
      }
    }

    // Other pages (home, search) only show the card while it's open.
    if (!page && !expanded) {
      reportIssue(null);
      removeHost();
      return;
    }

    const ctx = {
      page,
      adblockBait: await detectAdblockBait(),
      excluded: page === 'product' ? excludedCategory() : null,
      preCart: status.state === 'active' && (page === 'cart' || page === 'checkout')
        ? await itemsAddedBeforeActivation(status.activatedAt) : [],
      cartCheck: walmartCartCheck(page) || await amazonCartCheck(page),
      orderLogged: null
    };

    // Open the card by itself when cart items won't earn, unless you closed it for these same items.
    const cc = ctx.cartCheck;
    ctx.problemKey = ctx.preCart.length ? 'precart:' + ctx.preCart.map(i => i.asin).sort().join(',')
      : cc && cc.excluded.length ? 'walmartcart:' + cc.excluded.map(i => i.id).sort().join(',')
      : null;
    if (ctx.problemKey && !expanded && sessionStorage.getItem(PROBLEM_KEY) !== ctx.problemKey) {
      expanded = true;
    }

    if (page === 'confirm') {
      const key = location.href;
      if (!loggedOrders.has(key)) {
        loggedOrders.set(key, '(looking for the order number…)');
        logOrder(status, status.adblockCookie || ctx.adblockBait).then(num => {
          loggedOrders.set(key, num || '(no number found — check your order email)');
          refresh(true);
        });
      }
      ctx.orderLogged = loggedOrders.get(key);
      expanded = true;
    }

    // Hiding lasts for this kind of page only, so hiding it on products still shows it at cart and checkout.
    ctx.hideSig = status.state + '|' + (ctx.problemKey || '') + '|' + (page || '');
    const hidden = sessionStorage.getItem(HIDE_KEY);
    if (hidden !== null && hidden !== ctx.hideSig) sessionStorage.removeItem(HIDE_KEY);
    if (hidden === ctx.hideSig && page !== 'confirm') removeHost();
    else render(status, ctx);

    // Keep the toolbar badge in line with the page.
    if (ctx.preCart.length) {
      reportIssue('bad', ctx.preCart.length + ' cart item' + (ctx.preCart.length > 1 ? 's' : '') + ' won’t earn');
    } else if (cc && cc.excluded.length) {
      reportIssue('bad', cc.excluded.length === cc.total ? 'nothing in your cart earns'
        : cc.excluded.length + ' of ' + cc.total + ' cart items won’t earn');
    } else if (ctx.excluded) {
      reportIssue('warn', 'this item won’t earn');
    } else {
      reportIssue(null);
    }
  }

  // Sent on every refresh: the background forgets it when it restarts or the URL changes.
  let lastIssue = null;
  function reportIssue(level, message) {
    lastIssue = level ? { level, message } : null;
    if (stale()) return;
    chrome.runtime.sendMessage({ type: 'pageIssue', storeKey: store.key, level, message }).catch(() => {});
  }

  // The popup asks what this page found, and can bring the card back after it was hidden with ×.
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'pageState') {
      sendResponse({ issue: lastIssue, hidden: !host });
    } else if (msg.type === 'showOnPage') {
      sessionStorage.removeItem(HIDE_KEY);
      expanded = true;
      refresh(true);
      sendResponse({ ok: true });
    }
  });

  // Store pages change without full reloads, so watch the URL.
  timers.push(setInterval(() => refresh(false), 1000));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(true); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.track) refresh(true);
    // Reset clears the greeting, so this tab may greet again.
    if (area === 'session' && changes.greeted) { greetChecked = false; refresh(true); }
  });

  // The cart changes in place when you remove or add items; re-check it every few seconds.
  timers.push(setInterval(() => {
    if (!document.hidden && pageType(store, location.pathname) === 'cart') refresh(true);
  }, 3000));

  // Product breadcrumbs can load late; check again shortly after.
  refresh(true);
  setTimeout(() => refresh(true), 2500);
})();
