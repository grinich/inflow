export interface LinkedInCookies {
  liAt: string;
  jsessionId: string;
}

export async function getLinkedInCookies(): Promise<LinkedInCookies | null> {
  const [liAtCookie, jsessionCookie] = await Promise.all([
    chrome.cookies.get({ url: 'https://www.linkedin.com', name: 'li_at' }),
    chrome.cookies.get({ url: 'https://www.linkedin.com', name: 'JSESSIONID' }),
  ]);

  if (!liAtCookie?.value || !jsessionCookie?.value) {
    return null;
  }

  return {
    liAt: liAtCookie.value,
    jsessionId: jsessionCookie.value,
  };
}
