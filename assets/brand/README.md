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
- `site/icons/app-icon-512-fullbleed.png` — the `purpose: maskable` variant

The extension's toolbar icons (`public/icon-16/48/128.png`) are the blue tile
mark, which is separate artwork — not rendered from this master.

`assets/` is not deployed: the Vercel project's root directory is `site/`.
