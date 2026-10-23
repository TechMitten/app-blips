// Share links for a published site (PublishDialog). Each service's own
// "share" page, prefilled; nothing is sent until the person posts it there.
// No service scripts: plain links that open in the browser (the desktop app
// hands http(s) and mailto: links to the system, electron/main.js). The logos
// are inline SVGs in components/ShareIcons.jsx.
export function shareLinks(url, name) {
  const title = (name || '').trim() || 'my site';
  const text = `Check out ${title}`;
  const e = encodeURIComponent;
  return [
    { id: 'email', label: 'Email', href: `mailto:?subject=${e(text)}&body=${e(`${text}: ${url}`)}` },
    { id: 'x', label: 'X', href: `https://x.com/intent/post?text=${e(text)}&url=${e(url)}` },
    { id: 'facebook', label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${e(url)}` },
    { id: 'linkedin', label: 'LinkedIn', href: `https://www.linkedin.com/sharing/share-offsite/?url=${e(url)}` },
    { id: 'reddit', label: 'Reddit', href: `https://www.reddit.com/submit?url=${e(url)}&title=${e(title)}` },
    { id: 'bluesky', label: 'Bluesky', href: `https://bsky.app/intent/compose?text=${e(`${text} ${url}`)}` },
    { id: 'whatsapp', label: 'WhatsApp', href: `https://wa.me/?text=${e(`${text} ${url}`)}` },
  ];
}
