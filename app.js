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
  endpoint: "https://fra.cloud.appwrite.io/v1",   // change if self-hosting Appwrite
  projectId: "69ae8e160036ee2e48ea",
  databaseId: "6a9acd3b003a9624fdc4",
  booksCollectionId: "books",
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
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });

    if (view === 'home') Books.loadPublic();
    if (view === 'mylistings') Books.loadMine();
  },
  toggleMobileMenu(){
    document.getElementById('mobileMenu').classList.toggle('active');
  }
};
window.Nav = Nav;

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
    document.getElementById('authBtn').textContent = currentUser.name?.split(' ')[0] || 'Account';
    document.getElementById('authBtn').onclick = () => Nav.go('mylistings');
    document.getElementById('mobileAuthBtn').textContent = 'My account';
    document.getElementById('mobileAuthBtn').onclick = () => Nav.go('mylistings');
  },
  reflectLoggedOut(){
    document.getElementById('authBtn').textContent = 'Log in';
    document.getElementById('authBtn').onclick = () => Auth.openModal();
    document.getElementById('mobileAuthBtn').textContent = 'Log in';
    document.getElementById('mobileAuthBtn').onclick = () => Auth.openModal();
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
    await account.deleteSession('current');
    currentUser = null;
    Auth.reflectLoggedOut();
    toast('Logged out.');
    Nav.go('home');
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
    grid.innerHTML = '<p style="color:var(--muted);">Loading books…</p>';

    try{
      const queries = [ Query.equal('status', 'live'), Query.orderDesc('$createdAt'), Query.limit(60) ];
      const res = await databases.listDocuments(CONFIG.databaseId, CONFIG.booksCollectionId, queries);
      allBooks = res.documents;
      Books.renderGrid(allBooks, grid, empty, true);
      document.getElementById('resultsCount').textContent = res.total + ' book' + (res.total === 1 ? '' : 's');
    }catch(err){
      grid.innerHTML = `<p style="color:var(--brick);">Couldn't load listings. Check your Appwrite config in app.js. (${err.message})</p>`;
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
        <div class="book-cover" style="background-image:url('${book.imageUrl}')">
          <button class="fav" onclick="event.stopPropagation()">♡</button>
        </div>
        <div class="book-info">
          <div class="book-price">₹${book.price}</div>
          <div class="book-title">${Books.escape(book.title)}</div>
          <div class="book-meta">📍 ${Books.escape(book.locationText)}</div>
        </div>
      `;
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

    if (sort === 'price_low') filtered.sort((a,b) => a.price - b.price);
    if (sort === 'price_high') filtered.sort((a,b) => b.price - a.price);

    Books.renderGrid(filtered, document.getElementById('booksGrid'), document.getElementById('booksEmpty'), true);
    document.getElementById('resultsCount').textContent = filtered.length + ' book' + (filtered.length === 1 ? '' : 's');
  },

  resetFilters(){
    document.getElementById('filterCategory').value = '';
    document.getElementById('filterCondition').value = '';
    document.getElementById('filterMaxPrice').value = '';
    document.getElementById('filterSort').value = 'newest';
    document.getElementById('resultsHeading').textContent = 'All books nearby';
    Books.renderGrid(allBooks, document.getElementById('booksGrid'), document.getElementById('booksEmpty'), true);
    document.getElementById('resultsCount').textContent = allBooks.length + ' books';
  },

  filterByCategory(cat){
    document.getElementById('filterCategory').value = cat;
    document.getElementById('resultsHeading').textContent = cat + ' books';
    Books.applyFilters();
    document.querySelector('.browse-layout').scrollIntoView({ behavior:'smooth' });
  },

  // ---- detail view ----
  openDetail(book){
    activeBook = book;
    document.getElementById('detailImage').style.backgroundImage = `url('${book.imageUrl}')`;
    document.getElementById('detailCategory').textContent = book.category;
    document.getElementById('detailTitle').textContent = book.title;
    document.getElementById('detailPrice').textContent = '₹' + book.price;
    document.getElementById('detailCondition').textContent = book.condition;
    document.getElementById('detailDistance').textContent = '📍 ' + book.locationText;
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
      Auth.openModal();
      return false;
    }

    const btn = document.getElementById('sellSubmitBtn');
    const file = document.getElementById('photoInput').files[0];
    if (!file){ toast('Please add a photo of the book.'); return false; }

    btn.disabled = true;
    btn.textContent = 'Publishing…';

    try{
      // 1. upload image
      const uploaded = await storage.createFile(CONFIG.bucketId, ID.unique(), file);
      const imageUrl = storage.getFilePreview(CONFIG.bucketId, uploaded.$id).toString();

      // 2. create the document — only this user can edit/delete it later
      const data = {
        title: document.getElementById('fTitle').value,
        price: parseInt(document.getElementById('fPrice').value, 10),
        category: document.getElementById('fCategory').value,
        condition: document.getElementById('fCondition').value,
        locationText: document.getElementById('fLocation').value,
        sellerName: document.getElementById('fName').value,
        sellerPhone: document.getElementById('fPhone').value,
        notes: document.getElementById('fNotes').value,
        sellerId: currentUser.$id,
        imageId: uploaded.$id,
        imageUrl: imageUrl,
        status: 'live',
      };

      await databases.createDocument(
        CONFIG.databaseId,
        CONFIG.booksCollectionId,
        ID.unique(),
        data,
        [
          Permission.read(Role.any()),
          Permission.update(Role.user(currentUser.$id)),
          Permission.delete(Role.user(currentUser.$id)),
        ]
      );

      toast('Listing published!');
      document.getElementById('sellForm').reset();
      document.getElementById('uploadBox').classList.remove('has-image');
      document.getElementById('uploadText').textContent = 'Click to upload a cover photo';
      Nav.go('mylistings');
    }catch(err){
      toast('Could not publish: ' + err.message);
    }finally{
      btn.disabled = false;
      btn.textContent = 'Publish listing';
    }
    return false;
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
          <div class="book-cover" style="background-image:url('${book.imageUrl}'); ${book.status === 'sold' ? 'opacity:.55' : ''}">
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
        const soldBtn = card.querySelector('.sold-btn');
        if (soldBtn) soldBtn.onclick = () => Books.markSold(book.$id);
        card.querySelector('.del-btn').onclick = () => Books.deleteListing(book.$id);
        grid.appendChild(card);
      });
    }catch(err){
      grid.innerHTML = `<p style="color:var(--brick);">Couldn't load your listings. (${err.message})</p>`;
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

document.querySelectorAll('.cat-card').forEach(card => {
  card.addEventListener('click', () => Books.filterByCategory(card.dataset.cat));
});

document.getElementById('photoInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  const box = document.getElementById('uploadBox');
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    box.classList.add('has-image');
    box.innerHTML = `<img src="${ev.target.result}" alt="Preview"><input type="file" id="photoInput" accept="image/*" hidden required>`;
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
