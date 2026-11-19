// Country flags: standard 4:3 SVG flags (flag-icons, MIT, see flags/LICENSE) served from /flags/<iso2>.svg. Geo data names the
// country in English (or by its ISO code); COUNTRY_CODES maps a normalised name to the ISO 3166-1 alpha-2 code.

const COUNTRY_CODES = {"afghanistan":"af","albania":"al","algeria":"dz","american samoa":"as","andorra":"ad","angola":"ao","anguilla":"ai","antarctica":"aq","antigua and barbuda":"ag","argentina":"ar","armenia":"am","aruba":"aw","australia":"au","austria":"at","azerbaijan":"az","bahamas":"bs","bahrain":"bh","bangladesh":"bd","barbados":"bb","belarus":"by","belgium":"be","belize":"bz","benin":"bj","bermuda":"bm","bhutan":"bt","bolivia":"bo","bosnia and herzegovina":"ba","botswana":"bw","bouvet island":"bv","brazil":"br","british indian ocean territory":"io","brunei darussalam":"bn","bulgaria":"bg","burkina faso":"bf","burundi":"bi","cambodia":"kh","cameroon":"cm","canada":"ca","cape verde":"cv","cayman islands":"ky","central african republic":"cf","chad":"td","chile":"cl","people s republic of china":"cn","china":"cn","christmas island":"cx","cocos keeling islands":"cc","colombia":"co","comoros":"km","republic of the congo":"cg","congo":"cg","democratic republic of the congo":"cd","cook islands":"ck","costa rica":"cr","cote d ivoire":"ci","ivory coast":"ci","croatia":"hr","cuba":"cu","cyprus":"cy","czech republic":"cz","czechia":"cz","denmark":"dk","djibouti":"dj","dominica":"dm","dominican republic":"do","ecuador":"ec","egypt":"eg","el salvador":"sv","equatorial guinea":"gq","eritrea":"er","estonia":"ee","ethiopia":"et","falkland islands malvinas":"fk","faroe islands":"fo","fiji":"fj","finland":"fi","france":"fr","french guiana":"gf","french polynesia":"pf","french southern territories":"tf","gabon":"ga","republic of the gambia":"gm","the gambia":"gm","gambia":"gm","georgia":"ge","germany":"de","ghana":"gh","gibraltar":"gi","greece":"gr","greenland":"gl","grenada":"gd","guadeloupe":"gp","guam":"gu","guatemala":"gt","guinea":"gn","guinea bissau":"gw","guyana":"gy","haiti":"ht","heard island and mcdonald islands":"hm","holy see vatican city state":"va","honduras":"hn","hong kong":"hk","hungary":"hu","iceland":"is","india":"in","indonesia":"id","islamic republic of iran":"ir","iran":"ir","iraq":"iq","ireland":"ie","israel":"il","italy":"it","jamaica":"jm","japan":"jp","jordan":"jo","kazakhstan":"kz","kenya":"ke","kiribati":"ki","north korea":"kp","south korea":"kr","korea republic of":"kr","republic of korea":"kr","kuwait":"kw","kyrgyzstan":"kg","lao people s democratic republic":"la","latvia":"lv","lebanon":"lb","lesotho":"ls","liberia":"lr","libya":"ly","liechtenstein":"li","lithuania":"lt","luxembourg":"lu","macao":"mo","madagascar":"mg","malawi":"mw","malaysia":"my","maldives":"mv","mali":"ml","malta":"mt","marshall islands":"mh","martinique":"mq","mauritania":"mr","mauritius":"mu","mayotte":"yt","mexico":"mx","micronesia federated states of":"fm","moldova republic of":"md","monaco":"mc","mongolia":"mn","montserrat":"ms","morocco":"ma","mozambique":"mz","myanmar":"mm","namibia":"na","nauru":"nr","nepal":"np","netherlands":"nl","the netherlands":"nl","netherlands kingdom of the":"nl","new caledonia":"nc","new zealand":"nz","nicaragua":"ni","niger":"ne","nigeria":"ng","niue":"nu","norfolk island":"nf","the republic of north macedonia":"mk","north macedonia":"mk","northern mariana islands":"mp","norway":"no","oman":"om","pakistan":"pk","palau":"pw","state of palestine":"ps","palestine":"ps","panama":"pa","papua new guinea":"pg","paraguay":"py","peru":"pe","philippines":"ph","pitcairn":"pn","pitcairn islands":"pn","poland":"pl","portugal":"pt","puerto rico":"pr","qatar":"qa","reunion":"re","romania":"ro","russian federation":"ru","russia":"ru","rwanda":"rw","saint helena":"sh","saint kitts and nevis":"kn","saint lucia":"lc","saint pierre and miquelon":"pm","saint vincent and the grenadines":"vc","samoa":"ws","san marino":"sm","sao tome and principe":"st","saudi arabia":"sa","senegal":"sn","seychelles":"sc","sierra leone":"sl","singapore":"sg","slovakia":"sk","slovenia":"si","solomon islands":"sb","somalia":"so","south africa":"za","south georgia and the south sandwich islands":"gs","spain":"es","sri lanka":"lk","sudan":"sd","suriname":"sr","svalbard and jan mayen":"sj","eswatini":"sz","sweden":"se","switzerland":"ch","syrian arab republic":"sy","taiwan province of china":"tw","taiwan":"tw","tajikistan":"tj","united republic of tanzania":"tz","tanzania":"tz","thailand":"th","timor leste":"tl","togo":"tg","tokelau":"tk","tonga":"to","trinidad and tobago":"tt","tunisia":"tn","turkiye":"tr","turkey":"tr","turkmenistan":"tm","turks and caicos islands":"tc","tuvalu":"tv","uganda":"ug","ukraine":"ua","united arab emirates":"ae","uae":"ae","united kingdom":"gb","uk":"gb","great britain":"gb","united states of america":"us","united states":"us","usa":"us","u s a":"us","us":"us","u s":"us","united states minor outlying islands":"um","uruguay":"uy","uzbekistan":"uz","vanuatu":"vu","venezuela":"ve","vietnam":"vn","virgin islands british":"vg","virgin islands u s":"vi","wallis and futuna":"wf","western sahara":"eh","yemen":"ye","zambia":"zm","zimbabwe":"zw","aland islands":"ax","bonaire sint eustatius and saba":"bq","curacao":"cw","guernsey":"gg","isle of man":"im","jersey":"je","montenegro":"me","saint barthelemy":"bl","saint martin french part":"mf","serbia":"rs","sint maarten dutch part":"sx","south sudan":"ss","kosovo":"xk","syria":"sy","laos":"la","moldova":"md","macau":"mo","england":"gb","swaziland":"sz","burma":"mm","brunei":"bn","dr congo":"cd","holland":"nl","macedonia":"mk","east timor":"tl","vatican":"va","vatican city":"va","falkland islands":"fk","micronesia":"fm","sint maarten":"sx","st martin":"mf","the bahamas":"bs"};

const normalizeCountry = text => String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

const KNOWN_COUNTRY_CODES = new Set(Object.values(COUNTRY_CODES));

function countryCode(country) {
  const text = String(country ?? '').trim();
  if (!text) return null;
  const code = /^[A-Za-z]{2}$/.test(text) ? text.toLowerCase() : COUNTRY_CODES[normalizeCountry(text)];
  return code && KNOWN_COUNTRY_CODES.has(code) ? code : null;
}

// The flag image of a country, or null when the country is unknown.
function countryFlag(country) {
  const code = countryCode(country);
  if (!code) return null;
  const flag = document.createElement('img');
  flag.className = 'flag';
  flag.src = `/flags/${code}.svg`;
  flag.alt = '';
  flag.width = 20;
  flag.height = 15;
  flag.loading = 'lazy';
  flag.decoding = 'async';
  return flag;
}

// A flag followed by the text (the flag stays out of the text, so sorting, filtering and exports use the text only).
function withCountryFlag(country, text) {
  const flag = countryFlag(country);
  if (!flag || !text) return text;
  const cell = document.createElement('span');
  cell.className = 'country-cell';
  cell.append(flag, document.createTextNode(text));
  return cell;
}

// Every IP address shown on a page (a table cell, a summary, a list) gets the flag of its country in front of it, with
// the country name on hover. The countries come from the login tracker's geo records, asked in batches and kept for the
// page; an IP without a record gets no flag. The flag carries no text, so sorting, filtering and exports are unchanged.
const IP_COUNTRY_BATCH = 200;
const IPV4_TEXT = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6_TEXT = /^[0-9a-f:]+$/i;
const ipCountries = new Map();
const ipWaiting = new Map();
let ipLookupTimer = null;

const isIpText = text => IPV4_TEXT.test(text) || (IPV6_TEXT.test(text) && (text.includes('::') || text.split(':').length > 3));

function addIpFlag(textNode, country) {
  const flag = countryFlag(country);
  if (!flag || !textNode.isConnected) return;
  flag.classList.add('ip-flag');
  flag.title = country;
  textNode.before(flag);
}

function flagIps(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue.trim();
    const parent = node.parentElement;
    if (!isIpText(text) || !parent || parent.closest('svg, option, select, textarea, script, style, title')) continue;
    if (node.previousSibling?.classList?.contains('ip-flag')) continue;
    if (ipCountries.has(text)) {
      const country = ipCountries.get(text);
      if (country) addIpFlag(node, country);
      continue;
    }
    if (!ipWaiting.has(text)) ipWaiting.set(text, []);
    ipWaiting.get(text).push(node);
  }
  if (ipWaiting.size && !ipLookupTimer) ipLookupTimer = setTimeout(lookupIpCountries, 60);
}

async function lookupIpCountries() {
  ipLookupTimer = null;
  const waiting = new Map(ipWaiting);
  ipWaiting.clear();
  const ips = [...waiting.keys()];
  for (const ip of ips) ipCountries.set(ip, null);
  for (let start = 0; start < ips.length; start += IP_COUNTRY_BATCH) {
    try {
      const found = await apiGet('ip-geo/get-countries', { ips: ips.slice(start, start + IP_COUNTRY_BATCH) }, { background: true });
      for (const { ip, country } of found ?? []) ipCountries.set(ip, country);
    } catch {
      continue;
    }
  }
  for (const [ip, nodes] of waiting) {
    const country = ipCountries.get(ip);
    if (country) nodes.forEach(node => addIpFlag(node, country));
  }
}

if (typeof apiGet === 'function') {
  new MutationObserver(records => {
    for (const record of records)
      for (const node of record.addedNodes)
        if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) flagIps(node.nodeType === Node.TEXT_NODE ? node.parentNode : node);
  }).observe(document.body, { childList: true, subtree: true });
  flagIps(document.body);
}
