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

## the film's cast, and its score

The welcome-screen film presses eight real people — every cell after the four-layer build is a figure — and
plays a bed under them. All eight are anonymous adults from colour sources, all licence-clean, all credited on
screen under the film as well as here:

| cell | plate | source | author | licence |
| --- | --- | --- | --- | --- |
| 4 | the rapper, in the neon | Commons, `File:Cynic-s.a-daveyton-rapper-red-jacket-graffiti-wall-hip-hop.jpg` | Cynic - S.A | CC0 |
| 5 | the boxer, in the neon | Commons, "All-Marine boxer back for National Golden Gloves" | US Marine Corps | public domain |
| 6 | the biker, leaving | Commons, "Chrisitan Motorcyclists Association Rider on Lone Mt Rd" | Noah Wulf | CC BY-SA 3.0 |
| 7 | a runner on the beach | Commons, `File:Lifeguard (24710330115).jpg` | kargaltsev | CC BY 2.0 |
| 8 | the guitarist, mid-song | Commons, `File:Musicians performing on stage during a lively concert in the evening, captivating the audience with powerful music and energy.jpg` | Shixart1985 | CC BY 2.0 |
| 9 | a skater, weightless | Commons, `File:2008-08-22 Skateboarder floating in the air.jpg` | Ildar Sagdejev (Specious) | CC BY-SA 4.0 |
| 10 | a sentinel at dusk | Commons, `File:Lifeguards.jpg` | Sasha Kargaltsev | CC BY 2.0 |
| 11 | the busker, on the corner | Commons, `File:2026-06-09 Street musician in Novi Sad.jpg` | Alexkom000 | CC BY 4.0 |
| — | the bed (`public/audio/noir-bed.mp3`) | "Latin Industries" — Kevin MacLeod, incompetech.com (trimmed to 28s, faded and levelled with ffmpeg). Free for any use with attribution. | Kevin MacLeod | CC BY 4.0 |

**The sprite's own licence.** `public/film/plate-film.jpg` is a derivative work of all of the above at once,
so it is offered under the most restrictive of them: **CC BY-SA 4.0**. The repository's other files are not
affected — a derivative carries its own licence, a collection does not carry it to its members.

**Three classes of photograph were ruled out** while casting, and they are the three that always come up:
named celebrities (personality rights do not travel with a Commons licence, so "a famous rapper" or a
film-star likeness was never an option no matter how good the fit), greyscale sources (a black-and-white
photograph cannot take a golden or neon grade — it reads as a cold outlier beside the rest, which is exactly
what happened to the first portrait candidate), and any photograph of a minor.

As with every other plate here: what the repository ships is the *render*. The source photographs are not in
the repository — `tools/make-film.mjs` stages them under `public/film-src/` (gitignored) only while it runs,
and the sprite carries only the plates the press made of them.
