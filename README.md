# OldBook4U — Setup & Deployment Guide

A responsive, desktop-and-mobile-friendly website for buying/selling used books
locally. Built with plain HTML/CSS/JS + the Appwrite Web SDK — no build step,
no framework required.

Files:
- `index.html` — the entry/splash page. Shows the logo and a short loading
  animation, then takes the visitor into `app.html`. This is the page your
  domain's root (`oldbook4u.com`) should load first.
- `app.html` — the actual single-page app. Every screen (Home, Book Detail,
  Sell form, My Listings) lives in this one file and is switched with JS —
  no page reloads once you're inside.
- `style.css` — all styling (responsive: 1 column on phone → multi-column on desktop)
- `app.js` — all functionality (Auth incl. Google login, Database, Storage calls to Appwrite)

---

## 1. Create your Appwrite project

1. Go to Appwrite Cloud (or your self-hosted instance) → **Create Project**
2. Copy your **Project ID** and **API Endpoint** (Settings tab)

## 2. Set up Authentication

- Console → **Auth** → Settings → enable **Email/Password**

## 3. Set up the Database

- Console → **Databases** → **Create Database** → copy its **Database ID**
- Inside it, **Create Collection** named `books` → copy its **Collection ID**
- Add these attributes to the `books` collection:

| Attribute      | Type    | Required | Notes                          |
|----------------|---------|----------|---------------------------------|
| title          | String  | Yes      | size 200                        |
| price          | Integer | Yes      |                                  |
| category       | String  | Yes      | size 50                         |
| condition      | String  | Yes      | size 50                         |
| notes          | String  | No       | size 1000                       |
| locationText   | String  | Yes      | size 150                        |
| sellerName     | String  | Yes      | size 100                        |
| sellerPhone    | String  | Yes      | size 20                         |
| sellerId       | String  | Yes      | size 50 (set automatically from logged-in user) |
| imageId        | String  | Yes      | size 100                        |
| imageUrl       | String  | Yes      | size 500                        |
| status         | String  | Yes      | size 20 — value is `live` or `sold` |

- **Collection permissions** (Settings tab of the collection):
  - Read: **Any** (so anyone can browse without an account)
  - Create: **Users** (only logged-in users can list a book)
  - Update / Delete: leave at document level — the code sets these per-document
    on creation so only the owner can edit or delete their own listing.

## 4. Set up Storage

- Console → **Storage** → **Create Bucket** named `book-images` → copy its **Bucket ID**
- Bucket permissions: Read → **Any**, Create → **Users**

## 5. Enable Google login (optional but recommended, free)

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → create a
   free project (no billing required)
2. **APIs & Services → OAuth consent screen** → User type **External** → fill
   in app name, support email, developer email → save
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   → Application type **Web application**
4. In Appwrite Console → **Auth → Settings → OAuth2 Providers → Google**,
   toggle it on — it will show you the exact **Redirect URI** to use
5. Paste that Redirect URI into the Google Cloud OAuth client's
   **Authorized redirect URIs** field, save, and copy the **Client ID** and
   **Client Secret** it gives you
6. Paste the Client ID and Client Secret back into the Appwrite Google
   provider settings → Save

The "Continue with Google" button is already wired up in `app.html`/`app.js`
— once the provider is enabled in Appwrite, it works with no further code
changes.

## 6. Add your platform (important — Appwrite blocks unknown domains)

- Console → your project → **Settings → Platforms → Add Platform → Web App**
- Add `oldbook4u.com` and also `localhost` (for local testing)
- If you're testing locally by opening the file directly (`file://...`),
  Google login won't work — OAuth requires a real `http://localhost` or live
  domain. Use a local server (e.g. `npx serve`) for local testing instead.

## 7. Fill in your config

Open `app.js` and edit the top of the file:

```js
const CONFIG = {
  endpoint: "https://cloud.appwrite.io/v1",
  projectId: "YOUR_PROJECT_ID",
  databaseId: "YOUR_DATABASE_ID",
  booksCollectionId: "books",
  bucketId: "book-images",
};
```

These IDs are safe to be public — Appwrite's security model relies on the
permissions you set above, not on hiding these values.

## 8. Push to GitHub

```bash
git init
git add .
git commit -m "Initial OldBook4U site"
git branch -M main
git remote add origin https://github.com/yourusername/oldbook4u.git
git push -u origin main
```

## 9. Deploy with Appwrite Sites

1. Console → **Sites** → **Create Site** → connect your GitHub repo
2. Framework: **Other / Static** (no build command needed — it's plain HTML)
3. Output directory: `/` (root — `index.html` sits at the top level, and
   loads `app.html` from the same folder)
4. Deploy — Appwrite auto-builds on every push to `main`

## 10. Point your Hostinger domain to Appwrite

1. In Appwrite Sites → your site → **Domains** → **Add Domain** → enter `oldbook4u.com`
2. Appwrite shows you a CNAME (or A record) target
3. In Hostinger: **hPanel → Domains → DNS / Name Servers → DNS Zone Editor**
4. Add the record Appwrite gave you (usually a CNAME on `www` and/or an A
   record on `@` — Appwrite's screen tells you exactly which)
5. Wait for DNS propagation (often under an hour, can take up to 24h)
6. SSL certificate is auto-issued by Appwrite once DNS resolves correctly

## 11. Test the full flow

1. Visit your live site root — you should see the splash page, then land in
   the app automatically
2. **Sign up** for an account, or try **Continue with Google** if you set it up
3. Click **+ Sell a book** → fill the form → upload a photo → **Publish**
4. Check **My Listings** → try **Mark as sold** and **Delete**
5. Open the listing from Home → confirm **Call** and **WhatsApp** buttons work
   (they use `tel:` and `wa.me` links — no extra API needed, totally free)

---

## Notes on what's already handled in the code

- **Fully responsive**: single column on phone, sidebar + multi-column grid on
  tablet/desktop, sticky nav and filters — this is a real website layout, not
  a phone-app mockup.
- **No refer/earn system** — removed per your requirements.
- **Direct contact only** — buyers call or WhatsApp sellers straight from the
  listing, no in-app chat gating.
- **Seller controls** — Mark as Sold and Delete are on every one of the
  seller's own listings under "My Listings," enforced both in the UI and by
  Appwrite's document permissions (so no one else can sneak an API call to
  edit someone else's listing).
- **Search + filters** — category, condition, max price, and sort, all
  client-side over the fetched results (fine at this scale; can move to
  server-side Appwrite queries later if the catalog gets large).

## Ideas for later (not built yet, flagging so you can plan)

- Image compression before upload (large phone photos will eat your free
  storage quota fast — a simple canvas-resize before `storage.createFile`
  would help)
- Pagination / "load more" once listings exceed ~60
- Email verification on signup
- A proper "distance from me" using browser geolocation instead of free-text
  location (would need lat/lng fields + Haversine sorting)
