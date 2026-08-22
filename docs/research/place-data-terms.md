# What may we durably store from Google Places? — and is OSM a viable alternative?

Research for issue #5. **Not legal advice.** This is a reading of the published terms as of
2026-08-22, with decisive clauses quoted verbatim so they can be checked. Where the terms are
genuinely ambiguous I say so rather than picking an answer.

**Confidence key:** **High** = quoted verbatim from a primary Google/OSMF source.
**Medium** = follows directly from a quoted clause but requires one inferential step.
**Low** = my reading; needs a human decision or a question to Google.

Document versions read (Google publishes a "Last modified" date on each):

| Document | Last modified |
| --- | --- |
| Google Maps Platform Terms of Service (non-EEA) | 23 June 2026 |
| Google Maps Platform **EEA** Terms of Service | 23 June 2026 |
| Google Maps Platform Service Specific Terms (non-EEA) | 10 June 2026 |
| Google Maps Platform **EEA** Service Specific Terms | 10 June 2026 |
| Places API EEA Permitted Uses | 4 June 2025 |
| Places API pricing / usage & billing | 19 August 2026 |

---

## 0. Headline: we are in the EEA, and that changes the answer

This is the single most important finding, and it is not what the issue assumed.

Google operates **two** parallel sets of Maps Platform terms. Which set applies is decided by the
**billing account address**, not by where the app runs or who uses it. From the non-EEA Service
Specific Terms (confidence: **High**):

> These Service Specific Terms apply to Customers who do not have a billing account address in the
> European Economic Area. If your billing account address is within the European Economic Area,
> please see the (EEA) Service Specific Terms.

A Dutch billing address means the **EEA** terms govern. Under the EEA terms, Places API content is
subject to a restriction that has no equivalent in the non-EEA terms — EEA Service Specific Terms
§15.1 (confidence: **High**):

> **15.1 No Use With any Map.** Other than latitude, longitude, and place_id, Customer must not use
> Google Maps Content from the Places API **With any Map**.

with "With any Map" defined in §B of the same document (confidence: **High**):

> In this Section (B) (Service Terms), "With any Map" means to (1) display Google Maps Content on,
> next to, or in a manner that is visually associated with any map, **including a Google Map**; or
> (2) link Google Maps Content to any map or link any map to Google Maps Content, unless the
> specific map being linked to is the source of the applicable Google Maps Content.

Google's own EEA FAQ states the consequence in plain language (confidence: **High**):

> If you want to show Places-related content with a map, you should now use the new Places UI Kit,
> which works with any map (including third-party maps). **The Google Maps Content from the Places
> API (New and Legacy) may no longer be displayed with any map, including a Google Map.**

Effective date for this: **8 July 2025**, per the same FAQ. Pre-existing integrations were
grandfathered ("unmodified state", with three ToS clauses waived) — but this repository has **no**
Places integration today, so a place book built now is a **new** integration and gets no waiver
(confidence: **Medium** — rests on the FAQ's definition of "integration" as "the use of Google Maps
Platform Services within a Customer Application, via a dedicated project, to fulfil a distinct
end-user purpose or workflow").

Second EEA-only restriction, §15.2 (confidence: **High**):

> **15.2 Permitted Use.** Other than latitude, longitude, and place_id, Customer may only use the
> Google Maps Content from the Places API as permitted by the Places API EEA Permitted Uses.

Good news: the place-book use case is **explicitly on that permitted-uses list**. Two of the nine
enumerated uses fit almost word for word (confidence: **High**):

> (3) enable Customers to visualize and manage Places content related to a sales team's customers or
> opportunities;
> (4) enable users to associate tasks, notes, or reminders with specific named places within a
> productivity, chat, personal organization, or note-taking functionality;

And a carve-out that matters, §15.3 (confidence: **High**):

> **15.3 Places UI Kit.** The restrictions in Sections 15.1 (...No Use With any Map) and 15.2
> (...Permitted Use) do not apply to the Places UI Kit.

So: the *purpose* is sanctioned. The *mechanism* is constrained — under the EEA terms, Google names
and addresses may only reach the screen next to our OSM map through the **Places UI Kit** widget,
not by us fetching JSON from Places API and rendering it ourselves.

> **Caveat worth stating plainly.** If the billing account address is **not** in the EEA, §15.1/§15.2
> do not apply — but the non-EEA ToS §3.2.3(e) *No Use With Non-Google Maps* does, and it forbids
> displaying Places content on a non-Google map just as firmly for our specific case (we render an
> OpenStreetMap iframe). Either way, the conclusion for *this* app is the same. The EEA route is
> actually the more permissive one, because Places UI Kit is expressly allowed with any map.

---

## 1. What a self-hosted single-user application may durably persist

"Self-hosted" and "single user" change **nothing** in the terms. Neither document has a hobbyist,
internal-use, or low-volume exemption. Every obligation below applies to a one-user Docker Compose
deployment exactly as it applies to a commercial product (confidence: **High** — established by
absence; I searched both ToS documents and both Service Specific Terms and found no such carve-out).

### 1.1 The baseline prohibition

Non-EEA ToS §3.2.3, EEA ToS §3.3.2 (confidence: **High**):

> **(a) No Scraping.** Customer will not export, extract, or otherwise scrape Google Maps Content for
> use outside the Services. For example, Customer will not: (i) pre-fetch, index, store, reshare, or
> rehost Google Maps Content outside of the Services; (ii) bulk download Google Maps Content; or
> (iii) **copy and save business names, addresses, or user reviews**.
>
> **(b) No Caching.** Customer will not cache Google Maps Content except as expressly permitted under
> the Maps Service Specific Terms.

Note the shape of this: the default is **no storage at all**, and the Service Specific Terms then
grant narrow, enumerated exceptions. Anything not on the exception list may not be persisted.

### 1.2 The exceptions that exist for Places

**Place IDs — indefinitely.** General Service Terms §3, identical in both the EEA and non-EEA
Service Specific Terms (confidence: **High**):

> **3. Google ID Caching.** Customer may cache the Google ID values from the Services that return
> such field and allow caching, in accordance with its Documentation. For example, Customer may cache
> (a) **place_id from Places API**, Directions API, Geolocation API and Routes API, (b) pano_ID, from
> Street View Static API, and (c) video_ID from Aerial View API.

The Places API policy page is more explicit still (confidence: **High**):

> Note that the place ID, used to uniquely identify a place, is **exempt from the caching
> restrictions**. **You can therefore store place ID values indefinitely.**

And the Place IDs guide (confidence: **High**):

> Place IDs are exempt from the caching restrictions stated in Section 3.2.3(b) of the Google Maps
> Platform Terms of Service. You can therefore store place ID values for later use.
>
> Because Place IDs may change due to updates on the Google Maps database, Google recommends
> refreshing place IDs if they are **more than 12 months old**. You can refresh Place IDs **at no
> charge** by making a Place Details request, specifying only the `place_id` field in the `fields`
> parameter.

**Verdict on the working assumption: CONFIRMED.** `place_id` may be retained indefinitely, and
Google documents a free refresh path plus the failure mode (`NOT_FOUND` = obsolete ID, e.g. business
closed or moved; `INVALID_REQUEST` = malformed ID).

**Latitude/longitude — 30 days, and only lat/lng.** EEA Service Specific Terms §15.4 / non-EEA §14.3
(confidence: **High**):

> **Caching.** Customer may temporarily cache latitude and longitude values from the Places API for
> up to 30 consecutive calendar days, after which Customer must delete the cached latitude and
> longitude values.

**Names and addresses — no caching permission at all.** This is the correction the issue asked for.
The commonly-cited "~30 days for Places data" figure is **wrong as stated**. The 30-day allowance is
scoped precisely to `latitude` and `longitude`. There is **no** clause anywhere in either Service
Specific Terms document permitting the caching of `displayName`, `formattedAddress`,
`addressComponents`, `types`, opening hours, phone numbers, or reviews from the Places API — for 30
days or for any period. And ToS §3.2.3(a)(iii) names the case directly: *"copy and save business
names, addresses, or user reviews"* is given as an example of prohibited scraping.

**Confidence: High** on the clause reading. **Medium** on the practical conclusion, for one reason
worth flagging as real ambiguity: a strict reading makes even an in-memory response object a "copy",
which cannot be the intent — the API is useless if you may not hold its response long enough to
render it. Google has never published a bright line between "rendering a response" and "caching
it". Practice in the developer community treats request-scoped, non-persisted use as fine, but that
is convention, not a quoted permission. I am not resolving this; I am flagging it. What *is*
unambiguous is that writing names or addresses to disk, SQLite, or Postgres for later reuse has no
permission behind it.

### 1.3 Two further restrictions that bear on this design

**Point-in-polygon is prohibited.** ToS §3.2.3(c) *No Creating Content From Google Maps Content*,
example (iv) (confidence: **High**):

> use latitude/longitude values from the Places API as an input for point-in-polygon analysis

If the place book ever grows a geofence ("is the car inside Client X's site?"), that test must run
against the car's **own** GPS coordinate, never against a coordinate obtained from Places.

**A published Terms of Use and Privacy Policy are formally required.** Places API policy page
(confidence: **High**):

> Applications using the Places API must provide publicly accessible Terms of Use and a Privacy
> Policy that incorporate Google's Terms of Service and Privacy Policy, respectively.

ToS §3.2.2(a)(i) sets out what those must say. This is awkward-to-absurd for a single-user
self-hosted app with no public URL, and Google offers no exemption. **Confidence: High** that the
requirement is stated; **Low** on what compliance looks like for an app with an audience of one. In
practice: ship a static `/terms` and `/privacy` page in the app carrying the required notices.

**Attribution.** Because we would not be displaying Places content on a Google map, the policy page
requires (confidence: **High**):

> When displaying Places API data without a Google Map, you must include the Google logo, adhering to
> the provided style guidelines and attribution requirements.

Under the EEA route this is handled for us — the Places UI Kit renders Google's own attribution, and
EEA Service Specific Terms §16.1 forbids removing, altering, or obscuring it.

---

## 2. Is the intended design sanctioned?

The intended shape, from the issue: *store Jeroen's own observed coordinate + Jeroen's own chosen
label + the `place_id`; re-fetch display details from Google on demand.*

| Element stored | Is it Google Maps Content? | Permitted? | Confidence |
| --- | --- | --- | --- |
| Car's own GPS coordinate (from Porsche Connect) | No — our own observation | Yes, indefinitely. Not Google's data, so no Google clause reaches it. | High |
| Jeroen's own label ("Client X") | No — user-authored | Yes, indefinitely. | High |
| `place_id` | Yes, but expressly exempted | Yes, indefinitely. Refresh at >12 months, free. | High |
| Google `displayName` / `formattedAddress` | Yes | **No.** No caching permission exists; §3.2.3(a)(iii) names it as prohibited scraping. | High |
| Places-returned lat/lng | Yes | Only for ≤30 consecutive calendar days, then must be deleted. | High |
| Re-fetch details on demand for display | — | Yes — this is the documented pattern. | High |

**Verdict: the intended design is compliant, and it is the pattern Google itself documents** — with
one EEA-specific amendment.

The store-`place_id`-and-refetch pattern is about as explicitly sanctioned as Google gets. It is not
stated as a single sentence of permission, but it is constructed from four published pieces: (1)
place IDs are exempt from caching restrictions and may be stored indefinitely; (2) other content may
not be stored; (3) Google publishes a guide section titled *"Save place IDs for later use"*; (4)
Google provides a **free, unlimited** SKU (`Place Details Essentials (IDs Only)`) whose only purpose
is refreshing stored IDs. You do not build free infrastructure for a pattern you intend to forbid.
**Confidence: High.**

The EEA amendment: the on-demand re-fetch **must not** be "call Places API, read `displayName` out
of the JSON, and draw it next to the OSM map". Under §15.1 that is displaying Places content With a
Map. Instead, hand the stored `place_id` to a **Places UI Kit** `<gmp-place-details>` element, which
renders Google's content itself and is exempted by §15.3. We never touch the strings, so there is
nothing to cache and no attribution to assemble.

Design consequence: **our own label is the primary display name in list views, on markers, and in
search results.** Google's name appears only inside a UI Kit widget, on demand — a detail panel.
That is a real product constraint, not a formality. Confidence: **Medium** (the clause is
unambiguous; whether a given layout counts as "visually associated with" the map is a judgement
call, and Google publishes no test for it).

---

## 3. Text Search / Autocomplete vs Nearby Search — same terms, different economics

**Terms: identical.** All three are the same Service — "Places API (Legacy and New)" is a single
numbered section in both Service Specific Terms documents (§14 non-EEA, §15 EEA), and the Places API
policy page states it "lists requirements that are specific to all applications developed with the
Places API (New), **including the Autocomplete (New) service that is part of that API**". The Text
Search and Autocomplete reference docs both link to that one policy page. There is **no** separate
caching rule, permitted-use list, or attribution rule for Text Search or Autocomplete.
**Confidence: High.**

So the fuzzy company-name search carries no extra legal risk over Nearby Search. What differs is
**billing tiers and field availability**, and here the difference is large and in our favour.

Autocomplete has one operational quirk (not a term, a billing mechanic): a **session token** ties one
or more Autocomplete requests to the subsequent Place Details request. Reusing a token invalidates
the session and the requests are billed as if untokenised; abandoning a session (no Details call)
also bills the Autocomplete requests individually. **Confidence: High.**

---

## 4. Cost at this volume: effectively zero

Google Maps Platform bills per SKU with a **monthly free cap per SKU** (Essentials 10,000; Pro
5,000; Enterprise 1,000). Billing is by *field mask* — you are charged at the **highest** SKU tier
any requested field belongs to. Current published prices (first paid tier, per 1,000 events):

| SKU | Free/month | First paid tier | Relevance here |
| --- | --- | --- | --- |
| Place Details Essentials (**IDs Only**) | **Unlimited — free** | — | 12-month `place_id` refresh |
| Text Search Essentials (**IDs Only**) | **Unlimited — free** | — | Fuzzy company-name search returning only IDs |
| Autocomplete Session Usage | **Unlimited — free** | — | Session bundling |
| Autocomplete Requests | 10,000 | $2.83 | Type-ahead |
| Place Details Essentials | 10,000 | $5.00 | `location`, `formattedAddress`, `addressComponents`, `types`, `viewport` |
| Place Details Pro | 5,000 | $17.00 | `displayName`, `businessStatus`, `primaryType` |
| **Nearby Search Pro** | 5,000 | $32.00 | "businesses within 500 m" — **cheapest tier available; there is no Nearby Search Essentials** |
| Text Search Pro | 5,000 | $32.00 | Text search returning names/addresses |
| Places UI Kit Query | 10,000 | $1.00 | UI Kit content fetch |
| Places UI Kit — Autocomplete per Session | 10,000 | $10.00 | UI Kit autocomplete |
| Places UI Kit Pro | 5,000 | $5.00 | UI Kit rich detail |

**Two useful facts fall out of this table.** First, the two SKUs the place-book design leans on
hardest — refreshing a stored ID, and searching by name for an ID — are **free and uncapped**.
Second, `displayName` is a **Pro** field on Place Details ($17/1,000 after 5,000 free), which is
another reason to prefer the UI Kit route: `Places UI Kit Query` is $1/1,000 with 10,000 free.

**Realistic monthly bill for one driver: $0.00.** A single user discovering, say, 20 new places a
month with a handful of lookups each, plus occasional detail views, is two to three orders of
magnitude below every free cap. To exhaust the *smallest* relevant cap you would need 5,000 Nearby
Search calls in a month — roughly 160 a day, every day. **Confidence: High** on the prices (read
from Google's published pricing list, 19 Aug 2026); **High** on the conclusion.

Caveats: billing must be enabled on the project and an API key present regardless of cost, tiers
aggregate across all projects on the billing account, and prices are USD and change. Set a budget
alert anyway — a runaway loop in a self-hosted app is the actual financial risk here, not
steady-state usage.

---

## 5. The OpenStreetMap alternative

### 5.1 Licence: ODbL obligations for a private single-user app

The ODbL's obligations hinge on the defined term **"Publicly"** (confidence: **High**):

> "Publicly" – means to Persons other than You or under Your control by either more than 50%
> ownership or by the power to direct their activities (such as contracting with an independent
> consultant).

And §4.3 (confidence: **High**):

> Creating and Using a Produced Work does not require the notice in Section 4.2. However, **if you
> Publicly Use a Produced Work**, You must include a notice associated with the Produced Work
> reasonably calculated to make any Person that uses, views, accesses, interacts with, or is
> otherwise exposed to the Produced Work aware that Content was obtained from the Database (...) and
> that it is available under this License.

The OSMF Attribution Guideline says the same thing more bluntly (confidence: **High**):

> Note that attribution is only necessary when a Produced Work is used Publicly (as defined by the
> ODbL). **This guideline does not concern internal uses.**

A self-hosted app with exactly one user — its operator — is not Publicly Using anything. So the ODbL
**attribution obligation is not triggered**, and neither is share-alike. **Confidence: Medium** —
the clause reading is High, but "single user today" is a fact about deployment, not a property of the
code. The moment a second person gets a login, or the instance is exposed publicly, attribution
becomes mandatory. Build it in now; it costs one line.

**Share-alike on the place book itself.** The OSMF Geocoding Guideline is directly on point
(confidence: **High**):

> **Geocoding Results may be stored (either permanently or temporarily) together with the external
> data used for querying.**
>
> Since individual Geocoding Results are insubstantial extracts, they may be stored and used together
> with other proprietary or third party data **without having a share-alike impact on such other
> data**, provided the Geocoding Results have not been aggregated to create a new database that
> contains the whole or a substantial part of the OSM database.

The worked example in the same guideline is almost exactly our use case:

> **Geocoding store locations.** (...) The Geocoded Results added to the store location database are
> not subject to the share-alike requirements, and the store location database records themselves
> need not include attribution to OpenStreetMap because the Geocoding Results used are an
> insubstantial extract or contain no OSM data.

**This is the sharpest contrast in the whole report.** Where Google forbids persisting a business
name at all, OSM's own governing body says in writing that you may store geocoding results
*permanently*, alongside your own data, with no licence infection. A place book that caches "this
coordinate is Kramp Groep, Varsseveld" forever is squarely permitted on OSM data and squarely
prohibited on Google data. The one boundary: don't systematically harvest a whole region, which
would make the store a Derivative Database and trigger share-alike under ODbL §4.4(b).
**Confidence: High.**

### 5.2 The public endpoints' usage policies — and a problem with our current code

**Nominatim** (`nominatim.openstreetmap.org`), OSMF Operations Working Group policy
(confidence: **High**):

> - No heavy uses (an absolute maximum of **1 request per second**).
> - Provide a valid HTTP Referer or User-Agent identifying the application (**stock User-Agents as
>   set by http libraries will not do**).
> - Clearly display attribution as suitable for your medium.

Unacceptable uses, verbatim:

> **Auto-complete search** This is not yet supported by Nominatim and you must not implement such a
> service on the client side using the API.
>
> **Systematic queries** This includes reverse queries in a grid, searching for complete lists of
> postcodes, towns etc. and **downloading all POIs in an area**.
>
> **Reselling of geocoding results** Applications and services whose primary function is related to
> geocoding must run their own service. This includes but is not limited to **package/vehicle
> tracking applications** and API resellers.

Three consequences, in descending order of comfort:

1. **Type-ahead search against public Nominatim is flatly forbidden.** The fuzzy company-name search
   must be submit-on-enter, or run against our own instance. **Confidence: High.**
2. **Our existing code is on thin ice.** `src/components/tabs/MyCarTab.jsx:118` reverse-geocodes the
   car's position against public Nominatim on every location change, with no `User-Agent` and no
   caching. The policy also warns: *"periodic requests from apps are considered bulk geocoding and as
   such are strongly discouraged"*. From a browser the Referer requirement is satisfied
   automatically, and single-user volume is genuinely tiny — but the pattern is the one the policy
   names. **Confidence: Medium.**
3. **"Vehicle tracking applications" is named explicitly** in the reselling clause. Read narrowly,
   the clause is conditioned on *"whose primary function is related to geocoding"* — and a car
   dashboard's primary function is not geocoding. Read broadly, this app *is* a vehicle tracking
   application making geocoding calls. **I am not resolving this. It is genuine ambiguity in a
   policy that also says it "may change without notice".** **Confidence: Low.** This alone is a
   sufficient reason to self-host Nominatim if OSM becomes load-bearing.

**Overpass** (`overpass-api.de`, FOSSGIS-operated), from the OSM wiki instance table
(confidence: **High**):

> You can safely assume that you don't disturb other users when you do **less than 10,000 queries per
> day and download less than 1 GB data per day**. Be sure to check that your app or website adds
> User-Agent or Referer headers to requests that uniquely identify your app. If you receive an HTTP
> error code **429**, pause for 30 seconds before making a new request.

Overpass is markedly more permissive than Nominatim: 10,000 queries/day dwarfs our need, and
"businesses within 500 m of a point" is an ordinary `around:` query, not a prohibited bulk download.
**But 429s are real and immediate** — while researching this document I was rate-limited twice
running four sequential `around:500` queries, and needed ~20–45 s spacing to get clean responses.
Any implementation needs retry-with-backoff on 429 from day one. **Confidence: High** (measured, not
inferred).

### 5.3 Self-hosting inside Docker Compose: yes for Overpass, yes-but for Nominatim

The Netherlands Geofabrik extract is **1.3 GB** (`netherlands-latest.osm.pbf`, checked 2026-08-22),
which puts country-scoped self-hosting in a completely different league from planet-scale.

**Overpass — straightforward.** `wiktorn/Overpass-API` ships a `docker-compose.yml` template and an
`init` mode that builds the database directly from a Geofabrik `.osm.pbf` URL
(`OVERPASS_MODE=init`, `OVERPASS_PLANET_URL=…/netherlands-latest.osm.pbf`), with `OVERPASS_SPACE` to
cap RAM and a diff URL for updates. NL-only, this is a normal Compose service.
**Confidence: High** on the mechanism; **Medium** on resource sizing (I read the documented knobs; I
did not run the import).

**Nominatim — feasible but the heavier of the two.** Official docs (confidence: **High**):

> A minimum of 2GB of RAM is required or installation will fail. For a full planet import 128GB of
> RAM or more are strongly recommended (...) Fast disks are essential. Using NVME disks is
> recommended.

Those numbers are planet-scale; a single-country extract is far smaller, and `mediagis/nominatim-docker`
exists specifically to do `PBF_URL=…` imports. Expect a one-off import measured in hours and disk in
the tens of GB for NL, plus a Postgres instance in the stack. **Confidence: Low** on precise NL
figures — Nominatim publishes hardware guidance for planet imports, not per-country, and I did not
benchmark it. Verify before committing.

Self-hosting also dissolves every policy concern in §5.2 at once: the Nominatim policy's opening line
is *"This is an Acceptable Use Policy for the server running at nominatim.openstreetmap.org and does
not apply to nominatim services run by yourself"*. Autocomplete, periodic reverse-geocoding, and the
vehicle-tracking ambiguity all stop being questions. **Confidence: High.**

### 5.4 POI coverage for Dutch business parks — the honest answer

The Netherlands is the best-case country for OSM *addresses* and *buildings*, because of the BAG
import (Basisregistratie Adressen en Gebouwen — the Dutch national address and building register,
openly licensed and systematically imported into OSM by the Dutch community). If the place book only
needed "what is the street address at this coordinate", OSM would beat most commercial data.

**But the place book needs a company name, and that is precisely what BAG does not contain.** BAG
holds buildings, addresses, and construction years. Company names live in the KvK (Chamber of
Commerce) register, which has not been imported and is not openly licensed for this. So Dutch OSM
business names on a *bedrijventerrein* depend entirely on a hobbyist having walked or surveyed that
industrial estate — and B2B offices and warehouses are among the least-surveyed feature classes,
far behind cafés, shops, and restaurants.

I measured this rather than assuming it. Overpass, 500 m radius (matching the intended query),
2026-08-22:

| Business park (500 m around point) | `building` | `office=*` | `office=*` **with a name** | all named businesses found |
| --- | --- | --- | --- | --- |
| Spaanse Polder, Rotterdam (51.9445, 4.4930) | **527** | **0** | **0** | 0 |
| Bedrijvenpark Medel, Tiel (51.9060, 5.4520) | 79 | 4 | 3 | 6 |
| Bedrijvengebied Lage Weide, Utrecht (52.1120, 5.0700) | 75 | 1 | 1 | 5 |
| Ekkersrijt, Son en Breugel (51.5250, 5.4550) | 44 | 0 | 0 | 0 |
| Business park Schiphol-Rijk (52.2870, 4.7570) | n/a (429) | 3 | 3 | 9 of 234 features |

Read the first row again: **527 mapped buildings in Rotterdam's Spaanse Polder — one of the largest
industrial estates in the Netherlands — and not one `office` tag, named or otherwise.** Ekkersrijt,
44 buildings, zero. The best result in the sample, Medel, yields three named companies (Nedcargo
Logistics, Van Tilburg-Bastianen DAF, PostNL Crossdock Tiel) across 79 buildings. At Schiphol-Rijk,
9 of 234 matched features carried a name, and several of those were truck-parking bays and a fuel
station rather than businesses.

The pattern is stark and consistent: buildings are mapped, business names are not. Reverse-geocoding
makes it worse, because Nominatim returns the *nearest feature*, whatever that is. Two live probes:

| Query point | Nominatim `zoom=18` reverse result |
| --- | --- |
| Bedrijvenpark Medel, Tiel | `highway / cycleway` — "Grotebrugse Grintweg-Oost" |
| Lage Weide, Utrecht | `leisure / sports_centre` — "MC Utrecht Circuit" |

Neither is a business. A user parking at a client on a business park and asking "who is here?" would
get a cycle path.

Google's advantage here is structural, not incidental: business coverage comes from **Google Business
Profile**, where companies register themselves. Every firm that wants to be findable has an incentive
to create and maintain its own entry — including the B2B office on an industrial estate that no
volunteer mapper will ever visit. The published literature on POI quality is consistent that Google
leads on business completeness while OSM leads on breadth of tagging and openness.

**Confidence: High** that OSM POI coverage on Dutch business parks is inadequate for the place book's
core question (measured directly, above). **Medium** on the Google comparison — I did not run
matching Google queries, because that needs a billed API key this repo does not have. **This is the
single most important gap in this report and the one worth closing empirically** before committing
to a provider: take five real client coordinates and run the same 500 m query against both, with a
trial key.

---

## 6. Recommendation: hybrid, with OSM as the durable store and Google as the discovery lens

Neither provider wins outright, and the reason is a neat inversion:

- **Google has the data we need and forbids us from keeping it.**
- **OSM lets us keep whatever we find and often has nothing to find.**

So use each for what its terms and its data actually permit.

**Layer 1 — our own store (no provider terms apply).** Car's own GPS coordinate, Jeroen's own label,
`place_id`, timestamps. Persisted forever, no licence attaches, no caching clause reaches it. This is
the place book, and it is deliberately made of data we own. It keeps working if either provider is
swapped out or goes away.

**Layer 2 — discovery: Google Places, EEA-compliant.**
- Nearby Search Pro for "businesses within 500 m" when a new place is first visited (5,000
  free/month).
- Text Search **Essentials (IDs Only)** for fuzzy company-name search — free and uncapped, and it
  returns exactly the one field we are allowed to keep.
- Persist **only** the chosen `place_id`. Refresh at >12 months via the free IDs-Only SKU.
- Display Google's name/address **only** through a Places UI Kit `<gmp-place-details>` element, on
  demand, in a detail panel — never extracted into our own markup or store.

**Layer 3 — Nominatim reverse-geocoding for the street address**, as today. This is where OSM is
genuinely strong (BAG), the geocoding guideline expressly permits storing the result permanently, and
it gives the place book a durable human-readable string that Google's terms would never let us keep.
Self-host if this becomes load-bearing, or at minimum add a `User-Agent`, cache aggressively, and
skip re-queries for coordinates we have already resolved.

**Overpass as fallback, not primary.** Keep it as the graceful-degradation path when Google is
unconfigured or over budget, and as the answer if the Google dependency is ever unacceptable. Be
explicit in the UI that fewer results means thinner data, not fewer businesses.

### What the terms rule out of the intended design

| Intended element | Status |
| --- | --- |
| Store own coordinate + own label + `place_id`, refetch on demand | **Allowed.** This is Google's documented pattern. |
| Retain `place_id` indefinitely | **Allowed**, expressly. Refresh at 12 months (free). |
| Cache Google names/addresses for ~30 days | **Ruled out.** The 30-day permission covers **lat/lng only**. Names and addresses have no caching permission at any duration; §3.2.3(a)(iii) names saving them as prohibited scraping. |
| Render Google `displayName`/`formattedAddress` ourselves next to our OSM map | **Ruled out** under EEA §15.1 (and under non-EEA §3.2.3(e), for a different reason). Use Places UI Kit. |
| Cache Places lat/lng long-term as the canonical marker position | **Ruled out** beyond 30 days — but a non-issue, because the canonical position should be the car's **own** GPS reading anyway. |
| Point-in-polygon / geofencing on Places coordinates | **Ruled out** by §3.2.3(c)(iv). Use own coordinates. |
| Nominatim-backed type-ahead against the public endpoint | **Ruled out** by the Nominatim usage policy. Submit-on-enter, or self-host. |
| Storing OSM-derived names/addresses durably | **Allowed** — expressly, by the OSMF Geocoding Guideline. |

---

## 7. What I could not establish

| Open question | Why it is open | How to close it |
| --- | --- | --- |
| Google's actual POI coverage on Dutch business parks | Needs a billed API key; not available in this repo | Trial key, five real client coordinates, same 500 m query both providers |
| Where "holding a response to render it" ends and "caching" begins | Google publishes no bright line; the strictest reading of §3.2.3(a) would make the API unusable | Ask Google Maps Platform support in writing, if the risk needs to be closed |
| Whether a specific layout is "visually associated with" the map under EEA §15.1 | The clause is clear; its application to a detail panel beside a map is a judgement call with no published test | Design around it — UI Kit for all Google-sourced display |
| Whether the Nominatim policy's "vehicle tracking applications" clause reaches this app | Clause is conditioned on "primary function is related to geocoding", but names vehicle tracking explicitly | Self-host Nominatim; the policy then does not apply at all |
| Nominatim NL-only import: RAM, disk, wall-clock | Nominatim publishes planet-scale figures only; I did not benchmark | Time a `mediagis/nominatim-docker` import of `netherlands-latest.osm.pbf` |
| Overpass NL-only steady-state RAM/disk | Documented knobs read, import not run | Run `OVERPASS_MODE=init` against the NL extract |
| Whether the billing account will in fact be EEA-addressed | Determines which ToS governs; assumed EEA (NL) | Confirm at project setup — it changes §1's analysis |

---

## 8. Sources

Google — terms:
- Google Maps Platform Terms of Service — https://cloud.google.com/maps-platform/terms
- Google Maps Platform EEA Terms of Service — https://cloud.google.com/terms/maps-platform/eea
- Google Maps Platform Service Specific Terms — https://cloud.google.com/maps-platform/terms/maps-service-terms
- Google Maps Platform EEA Service Specific Terms — https://cloud.google.com/terms/maps-platform/eea/maps-service-terms
- Places API EEA Permitted Uses — https://cloud.google.com/terms/maps-platform/eea-places-api-permitted-uses
- EEA FAQ — https://developers.google.com/maps/comms/eea/faq

Google — documentation:
- Policies and attributions for Places API — https://developers.google.com/maps/documentation/places/web-service/policies
- Place IDs (save / refresh / manage) — https://developers.google.com/maps/documentation/places/web-service/place-id
- Places API Usage and Billing — https://developers.google.com/maps/documentation/places/web-service/usage-and-billing
- Places API data fields and SKUs — https://developers.google.com/maps/documentation/places/web-service/data-fields
- Google Maps Platform pricing list — https://developers.google.com/maps/billing-and-pricing/pricing
- Places UI Kit (Maps JavaScript API) — https://developers.google.com/maps/documentation/javascript/places-ui-kit/overview
- Place Details Element — https://developers.google.com/maps/documentation/javascript/places-ui-kit/place-details

OpenStreetMap:
- ODbL 1.0 full text — https://opendatacommons.org/licenses/odbl/1-0/
- OSM Copyright and License — https://www.openstreetmap.org/copyright
- OSMF Attribution Guideline — https://osmfoundation.org/wiki/Licence/Attribution_Guidelines
- OSMF Geocoding Guideline — https://osmfoundation.org/wiki/Licence/Community_Guidelines/Geocoding_-_Guideline
- Nominatim Usage Policy — https://operations.osmfoundation.org/policies/nominatim/
- OSM Tile Usage Policy — https://operations.osmfoundation.org/policies/tiles/
- Overpass API (instances and usage policies) — https://wiki.openstreetmap.org/wiki/Overpass_API
- Nominatim installation / hardware — https://nominatim.org/release-docs/latest/admin/Installation/
- mediagis/nominatim-docker — https://github.com/mediagis/nominatim-docker
- wiktorn/Overpass-API (Docker) — https://github.com/wiktorn/Overpass-API
- Geofabrik Netherlands extract — https://download.geofabrik.de/europe/netherlands.html
- BAG import (Dutch addresses/buildings) — https://wiki.openstreetmap.org/wiki/BAGimport

Background literature (POI quality, OSM vs commercial):
- Data Quality of Points of Interest in Selected Mapping and Social Media Platforms — https://www.researchgate.net/publication/321707415_Data_Quality_of_Points_of_Interest_in_Selected_Mapping_and_Social_Media_Platforms
- Point-of-Interest (POI) Data Validation Methods: An Urban Case Study — https://www.mdpi.com/2220-9964/10/11/735
- Using OpenStreetMap point-of-interest data to model urban change — https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0212606
