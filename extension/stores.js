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
    earn: 'up to 1 pt/$',
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
    excluded: [
      ['Automotive', /\bautomotive\b|\btires?\b/i],
      ['Movies & music', /blu-ray|\bcds?\b|\bdvds?\b|\bvinyl\b|movies & tv|\bmusic\b/i],
      ['Kindle eBooks & digital', /digital (books|music|video)|kindle (ebooks|store|unlimited)/i],
      ['Collectibles', /\bcollectible/i],
      ['Computers & tablets', /\bcomputers?\b|(?<!fire )\btablets?\b/i],
      ['Electronic components & home audio', /electronic components|home audio|home entertainment/i],
      ['Grocery', /\bgrocery\b|gourmet food/i],
      ['Toys & games', /toys & games|\btoys\b/i],
      ['Video games', /video games/i],
      ['Gift cards', /gift cards?/i]
    ],
    // Amazon only pays on these (eStore "eligible categories", 2026-11-11).
    // Anything else gets a "not on the list" note.
    eligible: [
      /clothing|fashion|\bshoes\b|handbags|wallets|sunglasses|jewel|watches|luggage/i,
      /\bhome\b|kitchen|dining|furniture|home improvement|\btools\b|appliances|patio|lawn|garden/i,
      /beauty|grooming|\bhealth\b|household|personal care|\bbaby\b|nursery|\bpets?\b/i,
      /sports|fitness|outdoor|musical instruments|\bbooks\b|textbooks|handmade/i,
      /office|school|industrial|scientific|software/i,
      /cell phones|camera|\bphoto\b/i,
      /amazon devices|\becho\b|alexa|fire tv|fire tablets?|kindle e-readers?|\bring\b|\beero\b|cloud cam/i
    ],
    orderNumber: /\b(\d{3}-\d{7}-\d{7})\b/,
    rules: [
      'Only some categories earn: clothing, home, kitchen, sports, beauty, health, office, phones and Amazon devices, among others.',
      'Only items added to the cart after activating earn points.',
      'Buy within 24 hours of adding to the cart.',
      'Don’t visit other sites or use outside coupons before buying.'
    ]
  },

  walmart: {
    key: 'walmart',
    name: 'Walmart',
    host: 'walmart.ca',
    earn: '1 pt/$',
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
    excluded: [
      ['Grocery & food', /\bgrocery\b|\bfood\b|pantry|snacks|beverages/i],
      ['Electronics', /\belectronics\b/i],
      ['Video games', /video games/i],
      ['Baby', /\bbaby\b/i],
      ['Household supplies', /household/i],
      ['Personal care', /personal care/i],
      ['Health', /\bhealth\b|pharmacy/i],
      ['Pets', /\bpets?\b/i],
      ['Beauty', /\bbeauty\b/i]
    ],
    orderNumber: /order\s*(?:#|number|no\.?)\s*:?\s*([0-9][0-9-]{6,})/i,
    rules: [
      'Finish buying in the same session you started from the eStore.',
      'Don’t visit other sites, use other extensions’ coupons, or block cookies.',
      'Grocery, electronics, baby, household, health, pets and beauty don’t earn.'
    ]
  }
};

function storeForHost(hostname) {
  return Object.values(STORES).find(s => hostname === s.host || hostname.endsWith('.' + s.host)) || null;
}

// 'ours' | 'other' | null, from a landing URL's query string.
function affiliateInUrl(store, url) {
  const p = url.searchParams;
  if (p.get(store.ourParam) === store.ourValue) return 'ours';
  if (store.key === 'walmart' && (p.get('siteID') || '').startsWith(store.ourValue + '-')) return 'ours';
  if (store.otherParams.some(name => p.has(name))) return 'other';
  if (p.get('utm_medium') === 'affiliate') return 'other';
  return null;
}

function pageType(store, pathname) {
  for (const type of ['confirm', 'checkout', 'cart', 'product']) {
    if (store.pages[type].test(pathname)) return type;
  }
  return null;
}
