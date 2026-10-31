# Marketing images

`npm run assets` builds the site, serves it locally and captures every image with headless Chrome (Node 22+, Google Chrome installed): `site/img/*.png` and `site/og.png` for the website and README, `dist/store/*.png` for the Chrome Web Store and the GitHub social preview. Each composition in `compose/` shows the real review page, running in the site's demo, and the extension's own overlay (comment bubble, pins) and crop on the demo app; `npm run assets <name>` captures only the outputs whose path contains `<name>`.
