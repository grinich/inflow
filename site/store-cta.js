/**
 * Point the install buttons at the right store for the browser you're in.
 *
 * inflow ships to both the Chrome Web Store and Edge Add-ons. The pages are
 * written for Chrome (the majority) and this rewrites them in place on Edge —
 * so an Edge visitor is never sent to a store that will tell them to install
 * Chrome, and never shown a Chrome logo on a button that installs an Edge
 * add-on.
 *
 * Testing: `?browser=edge` forces the Edge treatment (and `?browser=chrome`
 * forces it off) on any page. The choice is remembered for the tab's session,
 * so clicking through to /changelog or /app keeps it without re-adding the
 * parameter.
 *
 * Runs before paint on every page, so there is no flash of "Add to Chrome".
 */
(function () {
  var CHROME_HOST = 'chromewebstore.google.com';
  var EDGE_URL =
    'https://microsoftedge.microsoft.com/addons/detail/inflow-%E2%80%94-a-better-inbox-f/ojhcjmmdiekppielgogbdheogapbipnk';
  var OVERRIDE_KEY = 'inflow-browser';

  /** 'edge' | 'chrome' | null — a test override, sticky for the session. */
  function override() {
    var forced = null;
    try {
      forced = new URLSearchParams(location.search).get('browser');
    } catch (_) {}
    try {
      if (forced === 'edge' || forced === 'chrome') {
        sessionStorage.setItem(OVERRIDE_KEY, forced);
        return forced;
      }
      return sessionStorage.getItem(OVERRIDE_KEY);
    } catch (_) {
      // Private mode or blocked storage: honour the parameter for this page.
      return forced === 'edge' || forced === 'chrome' ? forced : null;
    }
  }

  function isEdge() {
    var forced = override();
    if (forced) return forced === 'edge';
    try {
      var brands = navigator.userAgentData && navigator.userAgentData.brands;
      if (brands && brands.length) {
        for (var i = 0; i < brands.length; i++) {
          if (brands[i].brand === 'Microsoft Edge') return true;
        }
        // Chromium reports its brands; a real Chrome must not match the UA
        // sniff below just because some other product embeds "Edg".
        return false;
      }
    } catch (_) {}
    return / Edg\//.test(navigator.userAgent);
  }

  // Copy written for Chrome, and what it becomes on Edge. Longest first, so
  // "View in Chrome Store" isn't half-rewritten by the "Chrome Store" rule.
  var PHRASES = [
    ['View in Chrome Store', 'View in Edge Add-ons'],
    ['Installed for Chrome', 'Installed for Edge'],
    ['Chrome Web Store', 'Edge Add-ons'],
    ['Add to Chrome', 'Add to Edge'],
  ];

  function retarget() {
    var links = document.querySelectorAll('a[href*="' + CHROME_HOST + '"]');
    for (var i = 0; i < links.length; i++) {
      links[i].setAttribute('href', EDGE_URL);
      // Showing Google's Chrome mark on a button that installs from Edge
      // Add-ons would be plainly wrong, so swap it for the Edge one. Both
      // sprites ship on every page; the viewBox differs between them.
      var use = links[i].querySelector('use[href="#chrome-mark"]');
      if (use) {
        use.setAttribute('href', '#edge-mark');
        var svg = use.closest('svg');
        if (svg) svg.setAttribute('viewBox', '0 0 24 24');
      }
    }

    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) {
      var text = node.nodeValue;
      if (text.indexOf('Chrome') === -1) continue;
      for (var p = 0; p < PHRASES.length; p++) {
        text = text.split(PHRASES[p][0]).join(PHRASES[p][1]);
      }
      if (text !== node.nodeValue) node.nodeValue = text;
    }
  }

  if (!isEdge()) return;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', retarget);
  } else {
    retarget();
  }
})();
