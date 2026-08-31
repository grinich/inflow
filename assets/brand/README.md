# Brand source artwork

The masters the shipped icons are rendered from. Kept here because everything
in the repo downstream of them is 512px or smaller, so without these there is
no way back to full size.

| File | What it is |
| --- | --- |
| `messaging-envelope-icon-master.png` | 1254×1254 master |
| `messaging-envelope-icon-1024.png` | 1024×1024 render |
| `messaging-envelope-icon.icns` | macOS icon bundle |

Downstream renders (do not edit by hand — re-render from the master):

- `site/icons/app-icon-512.png`, `-192.png` — PWA icons in `site/app.webmanifest`
- `site/icons/app-icon-512-fullbleed.png` — a maskable variant, NOT currently
  declared in the manifest. It bleeds the tile to all four edges, and a
  maskable icon is defined as croppable: the platform keeps only a centred
  safe zone. Chrome built the macOS app bundle from it and cropped it to
  Apple's squircle, which cut the tile's rounded corners off and zoomed what
  was left — the envelope came out at 79.5% of the visible tile against the
  master's 66%, which reads as an icon cropped too tight. Declaring only the
  `any` icons lets Chrome inset the whole tile instead.

  To bring it back, it has to be re-authored to the spec: the brand gradient
  filling the canvas, and the envelope small enough to survive an 80% crop
  (~55% of the canvas, not the 66% it is now).

- `public/icon-16.png`, `-48.png`, `-128.png` — the extension's toolbar,
  notification and Chrome Web Store icons: the master resized, keeping its
  framing.

  These used to be cropped to the tile's bounds first, which threw away the
  master's ~4% margin and left the extension the only place the icon bled to
  the edge — noticeably tighter than the artwork, and than the store listing
  beside it. macOS is unaffected either way: Chrome insets the icon itself
  when it builds the installed app's bundle (~8.6% margins, near Apple's grid).

`assets/` is not deployed: the Vercel project's root directory is `site/`.
