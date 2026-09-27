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
| `hamilton-poster.png` | a finished plate | the product's own output from a photograph of Lewis Hamilton supplied to it by the author. The underlying photograph is **not** public domain and is not claimed here — this file is only the render, as an example of what the paint does with a real press photograph and its lettering. (The same photograph is shipped as the gallery's *before* half: `public/plates/lewis-hamilton-source.jpg`.) |
| `frame-outline.png` | a screenshot of the arrangement | the site itself: the dashed box is the person's own box in the frame, with the corners that size it. |

The two NASA portraits are the reason the gallery changed: the earlier samples were pressed from the demo
fixtures that ship with the repo, and a fixture looks like a fixture. A photograph press should be shown
pressing photographs.

If you are looking for safe material for your own samples, NASA's image library and Wikimedia Commons'
public-domain categories are the shortest path: no model release, no licence to carry, no attribution
required (credited here anyway, because it is right).

## the gallery (`public/plates/`)

The gallery's frames were supplied by the repository's author, from photographs he chose, and are published
here as examples of what the press does rather than as licensed stock. They are also the site's own contact
sheet, so they live with the app's assets rather than in `docs/`.

**The source photographs that are in the repository** — the *before* half of a before/after pair, included at
the author's direction:

| file | what it is | what is claimed |
| --- | --- | --- |
| `lewis-hamilton-source.jpg` | the photograph behind `hamilton-at-the-pool.jpg` (downscaled from 3840×2160) | nothing. A third-party press photograph of a public figure; it remains its owner's, and is included as an input/output example only — the printer's own output can be verified against it, which is the point of shipping it. |
| `john_wick.png` | the photograph behind `the-marina-at-golden-hour.jpg` | the same: a third-party film still of a public figure, included as the *before* half of the pair the README shows. Nothing beyond that example is claimed for it. |
| `goa_group.jpg` | the photograph behind `the-group-at-the-beach.jpg` (downscaled from 2560×1440) | the same, and a note worth making: the four people in it are **private individuals, photographed with the author**, and this file is here because he asked for the before/after pair to be shown. It is not a licence grant, not stock, and not reusable — if you want material you can safely reuse, the NASA and Wikimedia public-domain route described above is the shortest path. |
| `one-photograph-original.jpg` | the photograph behind `one-photograph-pressed.jpg` | the same: the performer's photograph, supplied by the author, published as the *before* half of the pair the README shows. |

One note, because a public repository should be straight about this: the subjects are **public figures** and, in
one case, **private individuals photographed with the author** — the source photographs are third-party material
and remain the property of their owners; what this repository claims is the *render*, which it made.

## the score, and the film that is no longer here

**There is no score.** An earlier welcome card played one bed — Kevin MacLeod's "Latin Industries"
(incompetech.com), CC BY 4.0, trimmed and levelled with ffmpeg — and it was removed with the rest of the
sound: the entry is a card and a title now, silent, and `public/audio/` is gone with it.

An earlier welcome-screen film pressed eight real people from Commons and public-domain sources, and shipped
them as one sprite under the most restrictive of their licences (CC BY-SA 4.0). **That film, its sprite and
its tool were removed from the build**, so those frames are no longer in the repository and the cast is no
longer credited here; the sourcing rule it established still holds, and it is written down because it cost
three rounds of casting to learn:

**Three classes of photograph were ruled out** while casting, and they are the three that always come up:
named celebrities (personality rights do not travel with a Commons licence, so "a famous rapper" or a
film-star likeness was never an option no matter how good the fit), greyscale sources (a black-and-white
photograph cannot take a golden or neon grade — it reads as a cold outlier beside the rest, which is exactly
what happened to the first portrait candidate), and any photograph of a minor.

As with every other plate here: what the repository ships is mostly the *render*. Where a source photograph is
shipped too, it is named in the table above and nothing beyond an example is claimed for it.

