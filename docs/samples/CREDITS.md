# The samples, and where they came from

Every image in this directory is either a photograph in the **public domain** or a render the product made
from one. Nothing here is a photograph of a private individual, and nothing here was taken from a stock
library whose licence would follow the repository around.

| file | what it is | source |
| --- | --- | --- |
| `lovell-photo.jpg` | the input photograph | NASA — official portrait of astronaut Jim Lovell, 1964. Public domain (NASA material is not protected by copyright, `Template:PD-USGov` on Wikimedia Commons). |
| `lovell-plate.png` | the press's frame, fine finish | made by this repository from the photo above. |
| `lovell-billboard.png` | the city's billboard surface | made by this repository from the same arrangement. |
| `kerwin-photo.jpg` | the input photograph | NASA — official portrait of astronaut Joseph Kerwin. Public domain, same terms. |
| `kerwin-plate.png` | the press's frame, *as it is* finish | made by this repository from the photo above. |
| `hamilton-poster.png` | a finished plate | the product's own output from a photograph of Lewis Hamilton supplied to it by the author. The underlying photograph is **not** public domain and is not included here — only the render, as an example of what the paint does with a real press photograph and its lettering. |
| `frame-outline.png` | a screenshot of the arrangement | the site itself: the dashed box is the person's own box in the frame, with the corners that size it. |

The two NASA portraits are the reason the gallery changed: the earlier samples were pressed from the demo
fixtures that ship with the repo, and a fixture looks like a fixture. A photograph press should be shown
pressing photographs.

If you are looking for safe material for your own samples, NASA's image library and Wikimedia Commons'
public-domain categories are the shortest path: no model release, no licence to carry, no attribution
required (credited here anyway, because it is right).

## the gallery (`docs/gallery/`)

The five images in the gallery were supplied by the repository's author, from photographs he chose, and are
published here as examples of what the press does rather than as licensed stock. Two notes, because a public
repository should be straight about this:

- the subjects are **public figures** (and in one case a group of private individuals, photographed with the
  author) — the source photographs are third-party material and remain the property of their owners; what
  this repository claims is the *render*, which it made;
- if you are looking for material you can safely reuse for your own samples, the NASA and Wikimedia
  public-domain route described above is still the shortest path — it is what this folder's other files are.

## the film's figures, and its score

The welcome-screen film presses two real people and plays a bed under them. Both are licence-clean, and both
are credited on screen under the film as well as here:

| what | source | licence |
| --- | --- | --- |
| the rapper plate (film cell 12) | Wikimedia Commons, `File:Cynic-s.a-daveyton-rapper-red-jacket-graffiti-wall-hip-hop.jpg` — "Cynic - S.A" | CC0 |
| the guitarist plate (film cell 13) | Wikimedia Commons, `File:Musicians performing on stage during a lively concert in the evening, captivating the audience with powerful music and energy.jpg` — Shixart1985 | CC BY 2.0 |
| the bed (`public/audio/noir-bed.mp3`) | "Interloper" — Kevin MacLeod, incompetech.com. Trimmed to 26 seconds, faded and levelled with ffmpeg. | CC BY 4.0 |

As with every other plate here: what the repository ships is the *render*. The source photographs are not in
the repository — `tools/make-film.mjs` stages them under `public/film-src/` (gitignored) only while it runs,
and the sprite carries only the plates the press made of them.
