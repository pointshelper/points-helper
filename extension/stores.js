// Store rules, shared by background.js (importScripts), content.js and popup.js.
// Earn rates and rules copied from the Aeroplan eStore pages on 2026-11-11.

const ESTORE = 'https://aeroplan.rewardops.com/en-CA';

// Beta feedback form (Tally or Google Forms). The popup adds ?version=…&store=…&status=… so
// reports say which build and store they're about. Nothing else (no cart, no URLs) is sent.
const FEEDBACK_URL = '';
// Used when there's no form: opens an email with the same details in the body.
const FEEDBACK_EMAIL = 'pointshelper.support@gmail.com';

const STORES = {
  amazon: {
    key: 'amazon',
    name: 'Amazon',
    host: 'amazon.ca',
    estoreUrl: ESTORE + '/affiliate-details/amazon',
    // Aeroplan's Amazon Associates tag (seen on the eStore click-through).
    ourParam: 'tag',
    ourValue: 'aeropestor02-20',
    otherParams: ['tag'],
    // Amazon keeps the click on its servers, so the only signal is the landing URL.
    trackingCookie: null,
    adblockCookie: null,
    windowHours: 24,
    pages: {
      confirm: /thankyou|thank-you|order-confirmation/i,
      checkout: /^\/(checkout|gp\/buy)\b/,
      cart: /^\/(gp\/cart|cart)\b/,
      product: /\/(dp|gp\/product)\//
    },
    breadcrumbs: ['#wayfinding-breadcrumbs_feature_div'],
    // Checked first: these never earn, even inside an eligible department.
    // Collectibles only as the top department ("Collectibles & Fine Art"): toys like
    // "Toys & Games › Collectible Figures" do earn.
    excluded: [
      ['Collectibles & fine art', /^\s*collectibles/i],
      ['Grocery', /\bgrocery\b|gourmet food/i],
      ['Digital music & video', /digital (music|video)|prime video/i],
      ['Gift cards', /gift cards?/i]
    ],
    // Brands that never earn, whatever the category (eStore exclusions, re-checked 2026-11-23).
    // Matched against the product's brand line only, never the title (a "bag for Coach purses" is fine).
    excludedBrands: [
      ['Coach products', /^coach(\s+new york)?$/i]
    ],
    // Amazon only pays on these (eStore "eligible categories", re-checked 2026-11-22:
    // toys, video games, automotive, movies & music and computers were added since 2026-11-11).
    // Anything else gets a "not on the list" note.
    eligible: [
      /clothing|fashion|\bshoes\b|handbags|wallets|sunglasses|jewel|watches|luggage/i,
      /\bhome\b|kitchen|dining|furniture|home improvement|\btools\b|appliances|patio|lawn|garden/i,
      /beauty|grooming|\bhealth\b|household|personal care|\bbaby\b|nursery|\bpets?\b/i,
      /sports|fitness|outdoor|musical instruments|\bbooks\b|textbooks|handmade|arts|crafts|sewing/i,
      /office|school|industrial|scientific|software/i,
      /cell phones|camera|\bphoto\b|computers?|tablets?|electronic components|home audio|home entertainment/i,
      /\btoys\b|\bgames\b|automotive|\btires?\b|\bwheels\b|blu-ray|\bdvds?\b|\bcds?\b|\bvinyl\b|movies/i,
      /amazon devices|\becho\b|alexa|fire tv|fire tablets?|kindle|\bring\b|\beero\b|cloud cam/i
    ],
    orderNumber: /\b(\d{3}-\d{7}-\d{7})\b/,
    rules: [
      'Most departments earn. Grocery, gift cards and Coach products don’t.',
      'Only items added to the cart after activating earn points.',
      'Buy within 24 hours of adding to the cart.',
      'Don’t visit other sites or use outside coupons before buying.'
    ]
  },

  walmart: {
    key: 'walmart',
    name: 'Walmart',
    host: 'walmart.ca',
    estoreUrl: ESTORE + '/affiliate-details/walmart',
    // The eStore's Rakuten publisher ID (siteID / wmlspartner on the landing URL).
    ourParam: 'wmlspartner',
    ourValue: 'wdmEtJMuL1w',
    otherParams: ['wmlspartner', 'siteID'],
    // Walmart saves the Rakuten click in this cookie (checked 2026-11-11).
    trackingCookie: { name: 'utmContent', ours: 'wdmEtJMuL1w' },
    adblockCookie: 'adblocked',
    windowHours: null,
    pages: {
      confirm: /thank-?you|order-confirmation|\/confirmation/i,
      checkout: /\/checkout/,
      cart: /\/cart\b/,
      product: /\/ip\//
    },
    breadcrumbs: ['nav[aria-label*="breadcrumb" i]', '[data-automation*="breadcrumb" i]', '[data-testid*="breadcrumb" i]'],
    // eStore exclusions, re-checked 2026-11-22: only Grocery, Electronics and Video Games
    // (baby, household, personal care, health, pets and beauty were dropped since 2026-11-11).
    excluded: [
      ['Grocery & food', /\bgrocery\b|(?<!pet )\bfood\b|pantry|snacks|beverages/i],
      ['Electronics', /\belectronics\b/i],
      ['Video games', /video games/i]
    ],
    orderNumber: /order\s*(?:#|number|no\.?)\s*:?\s*([0-9][0-9-]{6,})/i,
    rules: [
      'Finish buying in the same session you started from the eStore.',
      'Don’t visit other sites, use other extensions’ coupons, or block cookies.',
      'Grocery, electronics and video games don’t earn.'
    ]
  },

  uniqlo: {
    key: 'uniqlo',
    name: 'Uniqlo',
    host: 'uniqlo.com',
    // Optional site access (POI-36): Chrome asks the first time you use this store,
    // so adding it never turns the extension off for anyone.
    optional: true,
    origins: ['https://*.uniqlo.com/*'],
    matches: ['https://www.uniqlo.com/ca/*'],
    estoreUrl: ESTORE + '/affiliate-details/uniqlo',
    // Partnerize lands on ?clickref=…&utm_source=aeroplan_estore&utm_medium=affiliate (checked 2026-11-21).
    ourParam: 'utm_source',
    ourValue: 'aeroplan_estore',
    otherParams: ['clickref'],
    // Uniqlo keeps the Partnerize click in this cookie. It has no source, so the click
    // reference seen on the eStore landing is remembered and compared.
    trackingCookie: null,
    clickRefParam: 'clickref',
    clickRefCookie: 'partnerizeClickReference',
    adblockCookie: null,
    windowHours: null,
    pages: {
      // After paying: /ca/en/checkout/payment/status?…&paymentStatus=success (seen 2026-11-24).
      confirm: /\/checkout\/payment\/status/,
      checkout: /\/checkout/,
      cart: /\/cart\b/,
      product: /\/products\//
    },
    confirmQuery: /[?&]paymentStatus=success\b/i,
    // The "Payment completed" page has no order number. "Go to order details" opens
    // /ca/en/member/orders/online-store/<number>, which fills it in for the order just logged.
    orderDetail: /\/member\/orders\/online-store\/([0-9][0-9-]{6,})/,
    noNumberHint: 'Click “Go to order details” to add the order number.',
    breadcrumbs: ['nav[aria-label*="breadcrumb" i]', '[class*="breadcrumb" i]'],
    excluded: [
      ['Gift cards', /gift ?cards?/i]
    ],
    orderNumber: /order\s*(?:#|number|no\.?)\s*:?\s*([A-Z0-9][A-Z0-9-]{6,})/i,
    rules: [
      'Finish buying in the same session you started from the eStore.',
      'Don’t visit other sites, use other extensions’ coupons, or block cookies.',
      'Gift cards don’t earn.',
      'Ad blockers can block the eStore link: pause yours before you click “Shop and earn”.'
    ]
  },

  // Rakuten, same Aeroplan ID as Walmart (POI-2). Checked 2026-11-24: lands on
  // /en-ca/…?CMP=AFC-AffiliateCA-wdmEtJMuL1w-2128561-1202966-4 (our ID inside CMP).
  lego: {
    key: 'lego',
    name: 'LEGO',
    host: 'lego.com',
    site: 'LEGO.com',
    estoreUrl: ESTORE + '/affiliate-details/lego',
    optional: true,
    origins: ['https://*.lego.com/*'],
    matches: ['https://www.lego.com/en-ca/*'],
    ourParam: 'CMP',
    ourValue: 'wdmEtJMuL1w',
    ourMatch: /-wdmEtJMuL1w-/,
    otherParams: [],
    otherMatch: { param: 'CMP', re: /^AFC-/i },
    // The rakuten cookie is JSON with ranEAID (the publisher); another ID means another link took over.
    trackingCookie: { name: 'rakuten', ours: 'wdmEtJMuL1w', other: /ranEAID/i },
    adblockCookie: null,
    windowHours: null,
    pages: {
      confirm: /order-?confirm|thank-?you|\/confirmation/i,
      checkout: /\/checkout/,
      cart: /\/cart\b/,
      // Gift cards are sold on /en-ca/gift-cards, which has no breadcrumb: matched by address (excludedPaths).
      product: /\/product\/|\/gift-cards\b/
    },
    excludedPaths: [
      ['Gift cards', /\/gift-cards\b/]
    ],
    // div[data-test="breadcrumbs-wrapper"] with li items (checked 2026-11-24).
    breadcrumbs: ['[data-test="breadcrumbs-wrapper"]'],
    excluded: [
      ['BrickLink sets', /bricklink/i],
      ['Gift cards', /gift cards?/i]
    ],
    // Cart lines [data-test="cart-item"], checkout lines [data-test="lineItem-content"] (checked 2026-11-24).
    // VIP is now "LEGO Insiders"; "Insiders Points" on a line is just the points you'd earn, not a reward.
    orderRisk: {
      lines: '[data-test="cart-item"], [data-test="lineItem-content"]',
      title: '[data-test="product-title"]',
      match: /\b(insiders|vip)\b(?!®?\s*points)|\breward\b|\bperk\b/i,
      label: 'Insiders reward or perk',
      pill: 'Whole order won’t earn',
      message: 'An order with a LEGO Insiders (VIP) reward or perk earns no Aeroplan points at all. Remove it, or buy it in a separate order.'
    },
    // Not warned on product pages: Insiders-only gifts with purchase show sitewide but only reach
    // signed-in members' bags, where orderRisk catches them ("LEGO® Insiders only" on the line).
    orderNumber: /order\s*(?:#|number|no\.?)\s*:?\s*([A-Z0-9][A-Z0-9-]{5,})/i,
    creditNote: 'The eStore says points can take 6–8 weeks to show up.',
    rules: [
      'An order with any LEGO Insiders (VIP) reward or perk earns nothing, not just that item. That includes Insiders-only gifts with purchase.',
      'Gift cards, BrickLink sets and LEGOLAND tickets don’t earn.',
      'Accept LEGO’s cookie banner: declining cookies stops the points.',
      'Finish buying in the same session. Ad blockers can block the eStore link: click “Proceed”.'
    ]
  },

  // Partnerize, like Uniqlo (POI-43). Landing and cookies checked 2026-11-24:
  // /default.mi?clickref=…&aff=MARWW&affname=1100l36397&… (1100l36397 = Aeroplan's publisher).
  marriott: {
    key: 'marriott',
    name: 'Marriott',
    host: 'marriott.com',
    site: 'Marriott.com',
    estoreUrl: ESTORE + '/affiliate-details/marriott_international',
    optional: true,
    origins: ['https://*.marriott.com/*'],
    matches: ['https://www.marriott.com/*'],
    ourParam: 'affname',
    ourValue: '1100l36397',
    otherParams: ['affname'],
    // The Affiliate cookie names the publisher: "Optional[1100l36397]|aff=MARWW|…" (checked 2026-11-24).
    // Not affMonitorValues: its clickref didn't match a fresh click's in Edge, so it isn't the latest click.
    // Another publisher's ID inside Optional[…] means another link took over.
    trackingCookie: { name: 'Affiliate', ours: '1100l36397', other: /Optional\[[^\]]+\]/ },
    clickRefParam: 'clickref',
    adblockCookie: null,
    windowHours: null,
    pages: {
      // Confirmation page not seen yet (needs a real booking).
      confirm: /\/reservation\/[^/]*confirm/i,
      checkout: /\/reservation\/(reviewguestinformation|guestinfo|payment)/i,
      cart: /(?!)/,
      product: /\/reservation\/rateListMenu/i
    },
    breadcrumbs: [],
    excluded: [],
    orderNumber: /confirmation\s*(?:#|number|no\.?)\s*:?\s*([0-9]{6,})/i,
    rules: [
      'Book in the same session you started from the eStore, and accept Marriott’s cookies.',
      'Corporate, government, employee and other negotiated rates don’t earn.',
      'Member offer rates, packages, and rooms paid or upgraded with Bonvoy points don’t earn.',
      'Some all-inclusive properties (mostly Royalton and Planet Hollywood) are excluded.',
      'Points come up to 90 days after check-out. Taxes, fees, cancellations and no-shows don’t earn.',
      'Ad blockers can block the eStore link: pause yours before you click “Shop and earn”.'
    ]
  },

  // Impact stores (Aeroplan's Impact publisher ID is 58665). Landing URLs checked 2026-11-24.
  // Neither shows a page-readable Impact cookie, so these say "Activated", not "Tracked".
  // Cart, checkout and confirmation pages, and Best Buy's breadcrumbs, aren't verified yet.
  bestbuy: {
    key: 'bestbuy',
    name: 'Best Buy',
    host: 'bestbuy.ca',
    site: 'BestBuy.ca',
    estoreUrl: ESTORE + '/affiliate-details/best_buy',
    optional: true,
    origins: ['https://*.bestbuy.ca/*'],
    matches: ['https://www.bestbuy.ca/*'],
    // Lands on /en-ca?irclickid=…&utm_content=58665&acmp=Aeroplan%20Inc.&utm_source=IR&…
    ourParam: 'utm_content',
    ourValue: '58665',
    creditNote: 'The eStore says points can take 6–8 weeks to show up.',
    otherParams: ['irclickid'],
    trackingCookie: null,
    adblockCookie: null,
    windowHours: null,
    pages: {
      confirm: /thank-?you|order-?confirm|\/confirmation/i,
      checkout: /\/checkout/,
      cart: /\/basket\b|\/cart\b/,
      product: /\/product\//
    },
    // nav[aria-label="Breadcrumbs"] > ol[data-automation="breadcrumb-container"] (checked 2026-11-24).
    breadcrumbs: ['nav[aria-label*="breadcrumb" i]'],
    // Cart: each item is section[data-automation="lineitem-parentproduct"] with a product-name link
    // (free included items are separate child sections). Product pages have the breadcrumb and
    // brand in their HTML, so each is read in the background (checked 2026-11-24).
    cartLines: {
      link: 'section[data-automation="lineitem-parentproduct"] a[data-automation="product-name"]',
      id: /\/(\d{6,})(?:$|[/?#])/
    },
    // "Brand: Apple" sits in a div inside [class*="modelInformationContainer"] (checked 2026-11-24).
    brandSelector: '[class*="modelInformationContainer"] div',
    excludedBrands: [
      ['Apple products', /^apple$/i],
      ['Bose products', /^bose$/i]
    ],
    // eStore exclusions, 2026-11-24. Only clear-cut ones: eligible neighbours (computer and
    // phone accessories, DJI drones and action cameras, office supplies and ink) must never match.
    excluded: [
      ['Video games', /video games|gaming consoles?/i],
      ['TVs and home theatre', /\btvs?\b|home theatre|sound ?bars/i],
      ['Laptops, desktops and monitors', /\blaptops\b|desktop computers|\bmonitors\b/i],
      ['Printers', /\bprinters\b/i],
      ['Headphones and speakers', /headphones|bluetooth speakers|portable audio/i],
      ['Gift cards', /gift cards?/i]
    ],
    orderNumber: /order\s*(?:#|number|no\.?)\s*:?\s*([0-9][0-9-]{6,})/i,
    rules: [
      'Only some categories earn: appliances, smart home, home living, health and fitness, toys, computer and phone accessories, and a few more.',
      'Computers, tablets, phones, TVs, video games, cameras, headphones, Apple and Bose don’t earn.',
      'Marketplace items, gift cards and in-store pickup don’t earn.',
      'Accept cookies on Best Buy’s site, and finish buying in the same session.'
    ]
  },

  decathlon: {
    key: 'decathlon',
    name: 'Decathlon',
    host: 'decathlon.ca',
    estoreUrl: ESTORE + '/affiliate-details/decathlon',
    optional: true,
    origins: ['https://*.decathlon.ca/*'],
    matches: ['https://www.decathlon.ca/*'],
    // Lands on /en?irclickid=…&utm_source=impactradius&utm_term=58665-642729&…
    ourParam: 'utm_term',
    ourValue: '58665',
    ourMatch: /^58665-/,
    creditNote: 'The eStore says points can take 6–8 weeks to show up.',
    otherParams: ['irclickid'],
    trackingCookie: null,
    adblockCookie: null,
    windowHours: null,
    pages: {
      confirm: /thank-?you|order-?confirm|\/confirmation|\/success/i,
      checkout: /\/checkout\/(?!cart)/,
      cart: /\/checkout\/cart\b/,
      product: /\/p\//
    },
    breadcrumbs: ['nav[aria-label*="breadcrumb" i]'],
    excluded: [
      ['Gift cards', /gift cards?/i]
    ],
    orderNumber: /order\s*(?:#|number|no\.?)\s*:?\s*([A-Z0-9][A-Z0-9-]{5,})/i,
    rules: [
      'Everything earns except gift cards.',
      'Accept cookies on Decathlon’s banner: declining them stops the points.',
      'Finish buying in the same session you started from the eStore.'
    ]
  }
};

// Whether the extension can read the store's own record of the eStore click (a cookie).
// Amazon keeps it on its servers, so there "active" only means you activated: say "Activated", not "Tracked".
function confirmsTracking(store) {
  return !!(store && (store.trackingCookie || store.clickRefCookie));
}

function unconfirmedNote(store) {
  return store.name + ' doesn’t let Points Helper confirm tracking, so this only means you activated. ' +
    (store.creditNote || 'Points usually show up within a week or two.');
}

// POI-41: the eStore asks you to buy in the same session as the click. After this long,
// "You're set" turns into a nudge to activate again (the tracking may still be there).
const STALE_AFTER = 2 * 3600 * 1000;
function isStale(status) {
  return status.state === 'active' && !!status.activatedAt && Date.now() - status.activatedAt > STALE_AFTER;
}

// Stores whose site access you grant when you first use them (background.js and popup.js only).
function optionalStores() {
  return Object.values(STORES).filter(s => s.optional);
}

async function hasAccess(store) {
  if (!store.optional) return true;
  return chrome.permissions.contains({ origins: store.origins }).catch(() => false);
}

function storeForHost(hostname) {
  return Object.values(STORES).find(s => hostname === s.host || hostname.endsWith('.' + s.host)) || null;
}

// 'ours' | 'other' | null, from a landing URL's query string.
function affiliateInUrl(store, url) {
  const p = url.searchParams;
  if (p.get(store.ourParam) === store.ourValue) return 'ours';
  // Some networks add more to our ID (Decathlon: utm_term=58665-642729).
  if (store.ourMatch && store.ourMatch.test(p.get(store.ourParam) || '')) return 'ours';
  // A param the store also uses for its own campaigns: only affiliate values count as another link (LEGO CMP=AFC-…).
  if (store.otherMatch && store.otherMatch.re.test(p.get(store.otherMatch.param) || '')) return 'other';
  if (store.key === 'walmart' && (p.get('siteID') || '').startsWith(store.ourValue + '-')) return 'ours';
  if (store.otherParams.some(name => p.has(name))) return 'other';
  if (p.get('utm_medium') === 'affiliate') return 'other';
  return null;
}

function pageType(store, pathname, search) {
  for (const type of ['confirm', 'checkout', 'cart', 'product']) {
    if (!store.pages[type].test(pathname)) continue;
    // Some stores use one URL for every payment result: only a successful one counts.
    if (type === 'confirm' && store.confirmQuery && !store.confirmQuery.test(search || '')) continue;
    return type;
  }
  return null;
}
