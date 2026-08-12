# lopezbaeza.com — how to run this site

A plain static website. No Wix, no WordPress, no monthly fee. The only thing you
pay for is the domain name.

---

## What this site is

An **index**, not an archive. Eight pages:

```
index · urbanism · architecture · design · publications · events · press · about
```

It presents who you are and what you've worked on, and sends people to wherever
each project is properly documented. It doesn't reproduce project pages.

**Destination priority** — for every project link, the site prefers, in order:

1. SPIN Unit's repository (`spinunit.org/web/r/…`) — 29 projects
2. ResearchGate, journal DOIs, institutional repositories — ad-free
3. Client or partner sites — Grasbrook, MOVE21, COCO Studio, `oprid.dip-caceres.es`
4. Wix — only where nothing else documents the work

That last tier is **18 links**, down from 28. Wix's free plan shows ads, so
anything with an ad-free equivalent was repointed. For example, *Social Cohesion*
now goes to the University of Alicante's RUA repository rather than the Wix page,
and *Hidden Image of Alicante* goes to the ResearchGate workshop report.

The 18 remaining Wix destinations are mostly early architecture and design work
plus the two password-protected Port City pages.

---

## Step 0 — Look at it first

Double-click `index.html`. Works offline apart from seven images.

## Step 1 — Take the last images off Wix

Only **7 images** remain hosted on Wix — your portrait and six research
diagrams. Run `localize-images.py` once (instructions inside the file) and they
download locally. Then the site is fully self-contained.

Do this while the Wix site is still live.

## Step 2 — Buy the domain

**Cloudflare Registrar** (dash.cloudflare.com → Domain Registration) sells at
wholesale cost with no renewal markup and free WHOIS privacy. Worth checking:
`lopezbaeza.com`, `lopez-baeza.com`, `jesuslopezbaeza.com`. A `.com` is safest
for an academic profile people type from memory.

## Step 3 — Put it online

**Cloudflare Pages — direct upload.** dash.cloudflare.com → Workers & Pages →
Create → Pages → Upload assets. Drag this whole folder on. Deploy. You get
`lopezbaeza.pages.dev` instantly; add your custom domain on the same screen and
DNS plus HTTPS configure themselves.

To update later: same screen, new deployment, drag the folder again.

*Alternatives:* Netlify Drop (app.netlify.com/drop) or GitHub Pages.

## Step 4 — One thing only you can fill in

**Google Scholar** — `content.py` has a `REPLACE_ME` placeholder. Send me the URL
or paste it in yourself.

There's no contact email, as you asked. People reach you via LinkedIn.

---

## Editing later

Everything generates from three files in `build/`:

| File | Contents |
|---|---|
| `content.py` | Bio, affiliations, the three project lists, social links |
| `publications.py` | Publications, events, press |
| `style.css` | All the design |

Edit, run `python3 build.py` inside `build/`, redeploy. You can also edit the
HTML in `site/` directly, but a rebuild overwrites it.

---

## What changed from Wix

- **Structure.** Projects and Research used to dump into one long `/archive`
  page. Now seven real, separately linkable pages.
- **Urbanism: 34 → 48 projects**, using the rebuilt SPIN Unit repository.
- **4 new publications** from ResearchGate, including three 2026 articles.
- **No dead links.** See `LINK-AUDIT.md`.
- **Lorem ipsum gone.** Six Wix architecture pages still had placeholder Latin.
- **Social links** trimmed to LinkedIn, ResearchGate, Google Scholar, ORCID,
  Instagram. Facebook, Pinterest, Flickr and the email address removed.
- **CARTO embeds removed** — the account has lapsed; awaiting your HTML dashboards.
- **A credential leak closed.** The MB3 toolkit linked to a bare IP with a live
  username and password in the URL. Now `oprid.dip-caceres.es`.
