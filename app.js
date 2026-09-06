// ==========================================================================
// OldBook4U — app.js
// Wires the website to Appwrite (Auth + Database + Storage).
//
// >>> FILL THESE IN before deploying — get them from your Appwrite Console <<<
// Console → your project → Settings gives you PROJECT_ID and ENDPOINT.
// Console → Databases gives you DATABASE_ID and the BOOKS_COLLECTION_ID.
// Console → Storage gives you the BUCKET_ID.
// ==========================================================================
import {
  Client, Account, Databases, Storage,
  ID, Query, Permission, Role
} from "https://cdn.jsdelivr.net/npm/appwrite@16.0.2/+esm";

const CONFIG = {
  endpoint: "https://fra.cloud.appwrite.io/v1",   // Frankfurt region — matches your project
  projectId: "69ae8e160036ee2e48ea",
  databaseId: "6a9acd3b003a9624fdc4",
  booksCollectionId: "data", // confirmed via `appwrite databases list-collections`
  bucketId: "6a9acc86000c8e9f031c",
};

const client = new Client()
  .setEndpoint(CONFIG.endpoint)
  .setProject(CONFIG.projectId);

const account = new Account(client);
const databases = new Databases(client);
const storage = new Storage(client);

// --------------------------------------------------------------------------
// Required Appwrite setup (do this once in the Appwrite Console):
//
// Database "YOUR_DATABASE_ID" → Collection "books" with attributes:
//   title         (string, required)
//   price         (integer, required)
//   category      (string, required)
//   condition     (string, required)
//   notes         (string, optional)
//   locationText  (string, required)
//   sellerName    (string, required)
//   sellerPhone   (string, required)
//   sellerId      (string, required)   -> set automatically from logged-in user
//   imageId       (string, required)   -> file ID from Storage
//   imageUrl      (string, required)   -> public preview URL
//   status        (string, required)   -> "live" or "sold"
//
// Collection permissions:
//   Read:   Any (so anyone can browse without logging in)
//   Create: Users (only logged-in users can list a book)
// Document-level permissions are set per-document in code below, so only
// the creator can update/delete their own listing.
//
// Storage bucket "book-images":
//   Permissions: Create -> Users, Read -> Any
// --------------------------------------------------------------------------

let currentUser = null;
let currentLocation = null;
let allBooks = [];       // cached results of the last public fetch
let activeBook = null;   // book currently open in detail view

// ============================== TOAST ====================================
function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ============================== NAV =======================================
const Nav = {
  go(view){
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + view).classList.add('active');
    document.getElementById('mobileMenu').classList.remove('active');
    Auth.closeAccountMenu();
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });

    if (view === 'home' || view === 'browse') Books.loadPublic();
    if (view === 'mylistings') Books.loadMine();
  },
  toggleMobileMenu(){
    document.getElementById('mobileMenu').classList.toggle('active');
  }
};
window.Nav = Nav;

// ============================== LOCATION ==================================
const Geo = {
  request(){
    const status = document.getElementById('locationStatus');
    const detail = document.getElementById('locationDetail');
    const button = document.getElementById('locationBtn');
    if (!navigator.geolocation){
      status.textContent = 'Location is unavailable';
      detail.textContent = 'Your browser does not support location access.';
      return;
    }

    button.disabled = true;
    button.textContent = 'Finding you…';
    navigator.geolocation.getCurrentPosition(
      position => {
        currentLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        const coordinateCount = allBooks.filter(book => Number.isFinite(Number(book.locationLat ?? book.latitude)) && Number.isFinite(Number(book.locationLng ?? book.longitude))).length;
        document.getElementById('locationPrompt').classList.add('is-ready');
        status.textContent = coordinateCount ? 'Showing books near you' : 'Location is ready';
        detail.textContent = coordinateCount ? 'Nearest listings are being placed first.' : 'Nearby results will improve as more sellers share their location.';
        button.textContent = 'Location on';
        button.disabled = false;
        Books.sortNearby();
        const grid = document.getElementById('booksGrid');
        if (grid) Books.renderGrid(allBooks, grid, document.getElementById('booksEmpty'), true);
      },
      error => {
        button.disabled = false;
        button.textContent = 'Try again';
        status.textContent = error.code === error.PERMISSION_DENIED ? 'Location is off' : 'Could not find your location';
        detail.textContent = 'Allow access to put nearby books first.';
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  },
  distance(book){
    const latitude = Number(book.locationLat ?? book.latitude);
    const longitude = Number(book.locationLng ?? book.longitude);
    if (!currentLocation || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return Infinity;
    const toRadians = value => value * Math.PI / 180;
    const earthRadiusKm = 6371;
    const deltaLat = toRadians(latitude - currentLocation.latitude);
    const deltaLng = toRadians(longitude - currentLocation.longitude);
    const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(toRadians(currentLocation.latitude)) * Math.cos(toRadians(latitude)) * Math.sin(deltaLng / 2) ** 2;
    return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  },
  label(book){
    const distance = Geo.distance(book);
    if (!Number.isFinite(distance)) return book.locationText || 'Nearby area';
    return distance < 1 ? `${Math.round(distance * 1000)} m away` : `${distance.toFixed(1)} km away`;
  }
};
window.Geo = Geo;

// ============================== AUTH =======================================
const Auth = {
  async init(){
    try{
      currentUser = await account.get();
      Auth.reflectLoggedIn();
    }catch(e){
      currentUser = null;
      Auth.reflectLoggedOut();
    }
  },
  reflectLoggedIn(){
    const accountMenu = document.getElementById('accountMenu');
    const accountLabel = document.getElementById('accountLabel');
    const accountAvatar = document.getElementById('accountAvatar');
    const accountHeading = document.getElementById('accountHeading');
    const displayName = currentUser.name?.trim() || 'Account';
    accountMenu.style.display = 'block';
    accountLabel.textContent = displayName.split(' ')[0];
    accountAvatar.textContent = displayName.charAt(0).toUpperCase();
    accountHeading.textContent = displayName;
    document.getElementById('loginBtn').style.display = 'none';
    document.getElementById('mobileAuthBtn').textContent = 'My account';
    document.getElementById('mobileAuthBtn').onclick = () => Nav.go('mylistings');
    document.getElementById('mobileLogoutBtn').style.display = 'block';
    const publishBtn = document.getElementById('sellSubmitBtn');
    if (publishBtn) publishBtn.textContent = 'Publish listing';
    const sellLoginHint = document.getElementById('sellLoginHint');
    if (sellLoginHint) sellLoginHint.style.display = 'none';
  },
  reflectLoggedOut(){
    document.getElementById('accountMenu').style.display = 'none';
    document.getElementById('loginBtn').style.display = 'inline-flex';
    document.getElementById('mobileAuthBtn').textContent = 'Log in';
    document.getElementById('mobileAuthBtn').onclick = () => Auth.openModal();
    document.getElementById('mobileLogoutBtn').style.display = 'none';
    const publishBtn = document.getElementById('sellSubmitBtn');
    if (publishBtn) publishBtn.textContent = 'Log in to publish';
    const sellLoginHint = document.getElementById('sellLoginHint');
    if (sellLoginHint) sellLoginHint.style.display = 'block';
  },
  toggleAccountMenu(){
    const menu = document.getElementById('accountMenu');
    const isOpen = menu.classList.toggle('open');
    document.getElementById('authBtn').setAttribute('aria-expanded', String(isOpen));
  },
  closeAccountMenu(){
    const menu = document.getElementById('accountMenu');
    if (!menu) return;
    menu.classList.remove('open');
    document.getElementById('authBtn').setAttribute('aria-expanded', 'false');
  },
  goToListings(){
    Auth.closeAccountMenu();
    Nav.go('mylistings');
  },
  goToSell(){
    Auth.closeAccountMenu();
    Nav.go('sell');
  },
  openModal(){
    document.getElementById('authModal').classList.add('active');
  },
  closeModal(){
    document.getElementById('authModal').classList.remove('active');
  },
  switchTab(tab){
    document.querySelectorAll('.modal-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.getElementById('loginForm').style.display = tab === 'login' ? 'block' : 'none';
    document.getElementById('signupForm').style.display = tab === 'signup' ? 'block' : 'none';
  },
  async login(e){
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const errEl = document.getElementById('loginError');
    errEl.textContent = '';
    try{
      await account.createEmailPasswordSession(email, password);
      currentUser = await account.get();
      Auth.reflectLoggedIn();
      Auth.closeModal();
      toast('Welcome back!');
    }catch(err){
      errEl.textContent = err.message || 'Could not log in.';
    }
    return false;
  },
  async signup(e){
    e.preventDefault();
    const name = document.getElementById('signupName').value;
    const email = document.getElementById('signupEmail').value;
    const password = document.getElementById('signupPassword').value;
    const errEl = document.getElementById('signupError');
    errEl.textContent = '';
    try{
      await account.create(ID.unique(), email, password, name);
      await account.createEmailPasswordSession(email, password);
      currentUser = await account.get();
      Auth.reflectLoggedIn();
      Auth.closeModal();
      toast('Account created — welcome to OldBook4U!');
    }catch(err){
      errEl.textContent = err.message || 'Could not create account.';
    }
    return false;
  },
  async logout(){
    try{
      await account.deleteSession('current');
    }catch(err){
      // ignore logout errors if the session is already gone
    }
    currentUser = null;
    Auth.reflectLoggedOut();
    Auth.closeAccountMenu();
    Auth.closeModal();
    toast('Logged out.');
    Nav.go('home');
  },
  async sendRecovery(){
    const email = document.getElementById('loginEmail').value.trim();
    const errEl = document.getElementById('loginError');
    errEl.textContent = '';

    if (!email){
      errEl.textContent = 'Enter your email first, then tap Forgot password.';
      return;
    }

    try{
      await account.createRecovery(email, window.location.href.split('?')[0]);
      toast('Password reset email sent. Check your inbox.');
    }catch(err){
      errEl.textContent = err.message || 'Could not start password reset.';
    }
  },
  loginWithGoogle(){
    // Redirects to Google, then back to this same page on success/failure.
    // Requires: Auth > OAuth2 Providers > Google enabled in the Appwrite
    // Console, with your Google Client ID/Secret entered there.
    account.createOAuth2Session(
      'google',
      window.location.href,                         // success redirect
      window.location.href.split('?')[0] + '?authFailed=1'  // failure redirect
    );
  }
};
window.Auth = Auth;

// ============================== BOOKS =======================================
const Books = {

  // ---- fetch + render public feed ----
  async loadPublic(){
    const grid = document.getElementById('booksGrid');
    const empty = document.getElementById('booksEmpty');
    const featuredGrid = document.getElementById('homeFeaturedGrid');
    const featuredEmpty = document.getElementById('homeFeaturedEmpty');
    if (!grid && !featuredGrid) return;
    if (grid) grid.innerHTML = '<p style="color:var(--muted);">Loading books…</p>';
    if (featuredGrid) featuredGrid.innerHTML = '<p style="color:var(--muted);">Loading books…</p>';

    try{
      const queries = [ Query.equal('status', 'live'), Query.orderDesc('$createdAt'), Query.limit(60) ];
      const res = await databases.listDocuments(CONFIG.databaseId, CONFIG.booksCollectionId, queries);
      allBooks = res.documents;
      Books.sortNearby();
      if (grid && empty){
        Books.renderGrid(allBooks, grid, empty, true);
        document.getElementById('resultsCount').textContent = res.total + ' book' + (res.total === 1 ? '' : 's');
      }
      if (featuredGrid && featuredEmpty) Books.renderGrid(allBooks.slice(0, 4), featuredGrid, featuredEmpty, true);
    }catch(err){
      const error = document.createElement('p');
      error.style.color = 'var(--brick)';
      error.textContent = `Couldn't load listings. Check your Appwrite config in app.js. (${err.message || 'Unknown error'})`;
      if (grid) grid.replaceChildren(error);
      if (featuredGrid) featuredGrid.replaceChildren(error.cloneNode(true));
    }
  },

  renderGrid(books, container, emptyEl, clickable){
    container.innerHTML = '';
    if (!books.length){
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';
    books.forEach(book => {
      const card = document.createElement('div');
      card.className = 'book-card';
      card.innerHTML = `
        <div class="spine" style="background:${Books.spineColor(book.category)}"></div>
        <div class="book-cover">
          <button class="fav" onclick="event.stopPropagation()">♡</button>
        </div>
        <div class="book-info">
          <div class="book-price">₹${book.price}</div>
          <div class="book-title">${Books.escape(book.title)}</div>
          <div class="book-meta">📍 ${Books.escape(Geo.label(book))}</div>
        </div>
      `;
      const cover = card.querySelector('.book-cover');
      const safeImageUrl = Books.safeImageUrl(book.imageUrl);
      if (safeImageUrl) cover.style.backgroundImage = `url("${safeImageUrl}")`;
      if (clickable) card.onclick = () => Books.openDetail(book);
      container.appendChild(card);
    });
  },

  spineColor(category){
    const map = { School:'var(--gold)', College:'var(--brick)', Entrance:'var(--sage)', Fiction:'var(--gold)', 'Non-Fiction':'var(--brick)', Other:'var(--sage)' };
    return map[category] || 'var(--gold)';
  },

  escape(str){
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  },

  safeImageUrl(value){
    try{
      const url = new URL(value);
      return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
    }catch(err){
      return '';
    }
  },

  sortNearby(){
    if (!currentLocation) return;
    allBooks.sort((first, second) => Geo.distance(first) - Geo.distance(second));
  },

  // ---- search + filters ----
  applySearch(){
    const q1 = document.getElementById('navSearchInput').value.trim();
    const q2 = document.getElementById('heroSearchInput').value.trim();
    const q = (q2 || q1).toLowerCase();
    Nav.go('home');
    setTimeout(() => {
      const filtered = q ? allBooks.filter(b => b.title.toLowerCase().includes(q) || b.category.toLowerCase().includes(q)) : allBooks;
      document.getElementById('resultsHeading').textContent = q ? `Results for “${q}”` : 'All books nearby';
      Books.renderGrid(filtered, document.getElementById('booksGrid'), document.getElementById('booksEmpty'), true);
      document.getElementById('resultsCount').textContent = filtered.length + ' book' + (filtered.length === 1 ? '' : 's');
    }, 50);
  },

  applyFilters(){
    const cat = document.getElementById('filterCategory').value;
    const cond = document.getElementById('filterCondition').value;
    const maxPrice = parseFloat(document.getElementById('filterMaxPrice').value);
    const sort = document.getElementById('filterSort').value;

    let filtered = allBooks.filter(b => {
      if (cat && b.category !== cat) return false;
      if (cond && b.condition !== cond) return false;
      if (!isNaN(maxPrice) && b.price > maxPrice) return false;
      return true;
    });

    if (sort === 'nearby') filtered.sort((a,b) => Geo.distance(a) - Geo.distance(b));
    if (sort === 'price_low') filtered.sort((a,b) => a.price - b.price);
    if (sort === 'price_high') filtered.sort((a,b) => b.price - a.price);

    Books.renderGrid(filtered, document.getElementById('booksGrid'), document.getElementById('booksEmpty'), true);
    document.getElementById('resultsCount').textContent = filtered.length + ' book' + (filtered.length === 1 ? '' : 's');
    document.getElementById('filterMenu').classList.remove('open');
    document.getElementById('filterToggle').setAttribute('aria-expanded', 'false');
  },

  resetFilters(){
    document.getElementById('filterCategory').value = '';
    document.getElementById('filterCondition').value = '';
    document.getElementById('filterMaxPrice').value = '';
    document.getElementById('filterSort').value = 'newest';
    document.getElementById('resultsHeading').textContent = 'All books nearby';
    Books.renderGrid(allBooks, document.getElementById('booksGrid'), document.getElementById('booksEmpty'), true);
    document.getElementById('resultsCount').textContent = allBooks.length + ' books';
    document.getElementById('filterMenu').classList.remove('open');
    document.getElementById('filterToggle').setAttribute('aria-expanded', 'false');
  },

  filterByCategory(cat){
    Nav.go('browse');
    document.getElementById('filterCategory').value = cat;
    document.getElementById('resultsHeading').textContent = cat + ' books';
    Books.applyFilters();
    document.querySelector('.browse-results').scrollIntoView({ behavior:'smooth' });
  },

  toggleFilters(){
    const menu = document.getElementById('filterMenu');
    const toggle = document.getElementById('filterToggle');
    const isOpen = menu.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(isOpen));
  },

  // ---- detail view ----
  openDetail(book){
    activeBook = book;
    const safeImageUrl = Books.safeImageUrl(book.imageUrl);
    document.getElementById('detailImage').style.backgroundImage = safeImageUrl ? `url("${safeImageUrl}")` : '';
    document.getElementById('detailCategory').textContent = book.category;
    document.getElementById('detailTitle').textContent = book.title;
    document.getElementById('detailPrice').textContent = '₹' + book.price;
    document.getElementById('detailCondition').textContent = book.condition;
    document.getElementById('detailDistance').textContent = '📍 ' + Geo.label(book);
    document.getElementById('detailNotes').textContent = book.notes || '';
    document.getElementById('sellerAvatar').textContent = (book.sellerName || '?').charAt(0).toUpperCase();
    document.getElementById('sellerName').textContent = book.sellerName;
    document.getElementById('sellerJoined').textContent = 'Listed on OldBook4U';

    const phone = (book.sellerPhone || '').replace(/\D/g, '');
    document.getElementById('callBtn').href = 'tel:+91' + phone;
    document.getElementById('whatsappBtn').href =
      `https://wa.me/91${phone}?text=${encodeURIComponent('Hi! Is "' + book.title + '" still available on OldBook4U?')}`;

    Nav.go('detail');
  },

  // ---- create listing ----
  async submitListing(e){
    e.preventDefault();
    if (!currentUser){
      toast('Please log in first to list a book.');
      Auth.switchTab('login');
      Auth.openModal();
      return false;
    }

    const btn = document.getElementById('sellSubmitBtn');
    const file = document.getElementById('photoInput').files[0];
    if (!file){ toast('Please add a photo of the book.'); return false; }
    if (!file.type.startsWith('image/')){ toast('Please choose an image file.'); return false; }
    if (file.size > 5 * 1024 * 1024){ toast('Image must be smaller than 5 MB.'); return false; }

    btn.disabled = true;
    btn.textContent = 'Publishing…';

    try{
      // 1. upload image
      const uploaded = await storage.createFile(CONFIG.bucketId, ID.unique(), file);
      const imageUrl = storage.getFilePreview(CONFIG.bucketId, uploaded.$id).toString();

      // 2. create the document — only this user can edit/delete it later
      const data = {
        title: document.getElementById('fTitle').value.trim().slice(0, 200),
        price: parseInt(document.getElementById('fPrice').value, 10),
        category: document.getElementById('fCategory').value,
        condition: document.getElementById('fCondition').value,
        locationText: document.getElementById('fLocation').value.trim().slice(0, 150),
        sellerName: document.getElementById('fName').value.trim().slice(0, 100),
        sellerPhone: document.getElementById('fPhone').value.trim().slice(0, 20),
        notes: document.getElementById('fNotes').value.trim().slice(0, 1000),
        sellerId: currentUser.$id,
        imageId: uploaded.$id,
        imageUrl: imageUrl,
        status: 'live',
      };
      if (currentLocation){
        data.locationLat = currentLocation.latitude;
        data.locationLng = currentLocation.longitude;
      }

      const permissions = [
        Permission.read(Role.any()),
        Permission.update(Role.user(currentUser.$id)),
        Permission.delete(Role.user(currentUser.$id)),
      ];
      try{
        await databases.createDocument(CONFIG.databaseId, CONFIG.booksCollectionId, ID.unique(), data, permissions);
      }catch(err){
        if (!currentLocation || !/attribute|unknown|invalid/i.test(err.message || '')) throw err;
        delete data.locationLat;
        delete data.locationLng;
        await databases.createDocument(CONFIG.databaseId, CONFIG.booksCollectionId, ID.unique(), data, permissions);
        toast('Listing published. Add location columns in Appwrite to enable nearby sorting.');
      }

      toast('Listing published!');
      document.getElementById('sellForm').reset();
      const uploadBox = document.getElementById('uploadBox');
      const uploadText = document.getElementById('uploadText');
      const uploadIcon = uploadBox.querySelector('.icon');
      const uploadPreview = uploadBox.querySelector('.upload-preview');
      uploadBox.classList.remove('has-image');
      uploadBox.style.backgroundImage = '';
      uploadBox.style.backgroundSize = '';
      uploadBox.style.backgroundPosition = '';
      if (uploadText) {
        uploadText.style.display = 'inline';
        uploadText.textContent = 'Click to upload a cover photo';
      }
      if (uploadIcon) uploadIcon.style.display = 'block';
      if (uploadPreview) uploadPreview.remove();
      Nav.go('mylistings');
    }catch(err){
      toast('Could not publish: ' + err.message);
    }finally{
      btn.disabled = false;
      btn.textContent = 'Publish listing';
    }
    return false;
  },
  handlePublishClick(){
    if (!currentUser){
      const sellLoginHint = document.getElementById('sellLoginHint');
      if (sellLoginHint) {
        sellLoginHint.textContent = 'Log in first to publish a listing.';
        sellLoginHint.style.display = 'block';
        sellLoginHint.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      toast('Please log in first to publish a listing.');
      Auth.switchTab('login');
      Auth.openModal();
      return;
    }

    const form = document.getElementById('sellForm');
    if (!form){
      toast('Sell form is not available right now.');
      return;
    }

    if (!form.requestSubmit){
      form.submit();
      return;
    }

    form.requestSubmit();
  },

  // ---- seller's own listings ----
  async loadMine(){
    const grid = document.getElementById('myListingsGrid');
    const empty = document.getElementById('myListingsEmpty');

    if (!currentUser){
      grid.innerHTML = '';
      document.getElementById('myListingsEmptyTitle').textContent = 'Log in to see your listings';
      document.getElementById('myListingsEmptyText').textContent = 'Once logged in, anything you list will show up here.';
      empty.style.display = 'block';
      return;
    }

    grid.innerHTML = '<p style="color:var(--muted);">Loading…</p>';
    try{
      const res = await databases.listDocuments(CONFIG.databaseId, CONFIG.booksCollectionId, [
        Query.equal('sellerId', currentUser.$id),
        Query.orderDesc('$createdAt'),
      ]);

      grid.innerHTML = '';
      if (!res.documents.length){
        document.getElementById('myListingsEmptyTitle').textContent = 'Nothing listed yet';
        document.getElementById('myListingsEmptyText').textContent = 'Once you list a book, you can mark it sold or delete it from here.';
        empty.style.display = 'block';
        return;
      }
      empty.style.display = 'none';

      res.documents.forEach(book => {
        const card = document.createElement('div');
        card.className = 'book-card mylisting-card';
        card.innerHTML = `
          <div class="book-cover${book.status === 'sold' ? ' sold-cover' : ''}">
            ${book.status === 'sold' ? '<div class="badge-sold">SOLD</div>' : ''}
          </div>
          <div class="book-info">
            <div class="book-price">₹${book.price}</div>
            <div class="book-title">${Books.escape(book.title)}</div>
            <span class="status-tag ${book.status === 'sold' ? 'sold' : 'live'}">${book.status === 'sold' ? 'Sold' : 'Live'}</span>
          </div>
          <div class="lactions">
            ${book.status !== 'sold' ? `<button class="laction sold-btn">Mark as sold</button>` : ''}
            <button class="laction del-btn">Delete</button>
          </div>
        `;
        const cover = card.querySelector('.book-cover');
        const safeImageUrl = Books.safeImageUrl(book.imageUrl);
        if (safeImageUrl) cover.style.backgroundImage = `url("${safeImageUrl}")`;
        const soldBtn = card.querySelector('.sold-btn');
        if (soldBtn) soldBtn.onclick = () => Books.markSold(book.$id);
        card.querySelector('.del-btn').onclick = () => Books.deleteListing(book.$id);
        grid.appendChild(card);
      });
    }catch(err){
      const error = document.createElement('p');
      error.style.color = 'var(--brick)';
      error.textContent = `Couldn't load your listings. (${err.message || 'Unknown error'})`;
      grid.replaceChildren(error);
    }
  },

  async markSold(bookId){
    try{
      await databases.updateDocument(CONFIG.databaseId, CONFIG.booksCollectionId, bookId, { status: 'sold' });
      toast('Marked as sold.');
      Books.loadMine();
    }catch(err){
      toast('Could not update: ' + err.message);
    }
  },

  async deleteListing(bookId){
    if (!confirm('Delete this listing? This can\'t be undone.')) return;
    try{
      await databases.deleteDocument(CONFIG.databaseId, CONFIG.booksCollectionId, bookId);
      toast('Listing deleted.');
      Books.loadMine();
    }catch(err){
      toast('Could not delete: ' + err.message);
    }
  }
};
window.Books = Books;

// ============================== INIT =======================================
document.getElementById('year').textContent = new Date().getFullYear();

const snowLayer = document.getElementById('heroSnow');
if (snowLayer && !window.matchMedia('(prefers-reduced-motion: reduce)').matches){
  for (let index = 0; index < 34; index += 1){
    const flake = document.createElement('span');
    flake.className = 'snowflake';
    flake.style.left = `${Math.random() * 100}%`;
    flake.style.setProperty('--snow-size', `${2 + Math.random() * 5}px`);
    flake.style.setProperty('--snow-opacity', `${0.35 + Math.random() * 0.55}`);
    flake.style.setProperty('--snow-duration', `${7 + Math.random() * 9}s`);
    flake.style.setProperty('--snow-delay', `${Math.random() * -14}s`);
    snowLayer.appendChild(flake);
  }
}

document.querySelectorAll('.cat-card').forEach(card => {
  card.addEventListener('click', () => Books.filterByCategory(card.dataset.cat));
});

document.addEventListener('click', (event) => {
  const accountMenu = document.getElementById('accountMenu');
  if (accountMenu && !accountMenu.contains(event.target)) Auth.closeAccountMenu();
});

document.getElementById('photoInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  const box = document.getElementById('uploadBox');
  const text = document.getElementById('uploadText');
  const icon = box.querySelector('.icon');
  let preview = box.querySelector('.upload-preview');
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    box.classList.add('has-image');
    box.style.backgroundImage = `url('${ev.target.result}')`;
    box.style.backgroundSize = 'cover';
    box.style.backgroundPosition = 'center';
    if (icon) icon.style.display = 'none';
    if (text) text.style.display = 'none';
    if (!preview){
      preview = document.createElement('img');
      preview.className = 'upload-preview';
      preview.alt = 'Preview';
      box.appendChild(preview);
    }
    preview.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});

['navSearchInput','heroSearchInput'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') Books.applySearch();
  });
});

if (window.location.search.includes('authFailed=1')){
  toast('Google login was cancelled or failed. Please try again.');
  history.replaceState({}, '', window.location.pathname);
}

Auth.init();
Books.loadPublic();

if (!sessionStorage.getItem('oldbook4u_location_asked')){
  sessionStorage.setItem('oldbook4u_location_asked', '1');
  window.setTimeout(() => Geo.request(), 900);
}
