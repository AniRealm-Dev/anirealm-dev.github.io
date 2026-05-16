const JIKAN_BASE = 'https://api.jikan.moe/v4';
let currentPage = 1;
let currentMode = 'top/anime';
let isLoading = false;
let hasNextPage = true;
let searchTimeout;
let currentGenre = null;
let searchQuery = '';
let currentFetchedItems = []; 

// Firebase Production Configurations
const firebaseConfig = {
    apiKey: "AIzaSyBLxWcX7Ks70HiOUVerl112q87JcljFEmo", // Note: Secure this endpoint inside Google Cloud Console via HTTP restrictions
    authDomain: "anirealm-402d6.firebaseapp.com",
    projectId: "anirealm-402d6",
    storageBucket: "anirealm-402d6.firebasestorage.app",
    messagingSenderId: "288023042255",
    appId: "1:288023042255:web:c2147069ee032752c33fba",
    measurementId: "G-HHV5J980R1"
};

// Initialize Firebase Production Instances
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
firebase.analytics();

let currentUser = null;
let cachedCloudList = []; 
let isLoginMode = true; 

const titles = {
    'top/anime': 'Global Rated Anime',
    'top/manga': 'Top Rated Manga',
    'top/manga?type=novel': 'Premium Light Novels',
    'seasons/now': 'Trending Now',
    'mylist': 'My Collection'
};

window.onload = () => {
    document.body.classList.add('no-scroll');
    setupSearch();
    
    auth.onAuthStateChanged(user => {
        const authNavBtn = document.getElementById('authNavBtn');
        if (user) {
            currentUser = user;
            if (authNavBtn) authNavBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i>';
            authNavBtn.title = "Logout";
            authNavBtn.onclick = handleLogout;
            syncUserCollection();
        } else {
            currentUser = null;
            cachedCloudList = [];
            if (authNavBtn) authNavBtn.innerHTML = '<i class="fas fa-user-circle"></i>';
            authNavBtn.title = "Login";
            authNavBtn.onclick = openAuthModal;
            if (currentMode === 'mylist') setMode('top/anime', 'topAnime');
        }
    });

    loadData();
    
    const splash = document.getElementById('splash-screen');
    setTimeout(() => {
        if (splash) {
            splash.classList.add('splash-hidden');
            setTimeout(() => { 
                splash.style.display = 'none'; 
                document.body.classList.remove('no-scroll');
            }, 1000);
        } else {
            document.body.classList.remove('no-scroll');
        }
    }, 2800);
};

function getMyList() { 
    if (currentUser) return cachedCloudList;
    return JSON.parse(localStorage.getItem('aniRealmList')) || []; 
}

async function saveMyList(newList) {
    if (currentUser) {
        cachedCloudList = newList;
        try {
            await db.collection('users').doc(currentUser.uid).set({ collection: newList });
        } catch (err) {
            console.error("Firestore sync error:", err);
        }
    } else {
        localStorage.setItem('aniRealmList', JSON.stringify(newList));
    }
}

async function syncUserCollection() {
    if (!currentUser) return;
    try {
        const doc = await db.collection('users').doc(currentUser.uid).get();
        if (doc.exists) {
            cachedCloudList = doc.data().collection || [];
        } else {
            const localList = JSON.parse(localStorage.getItem('aniRealmList')) || [];
            if (localList.length > 0) {
                cachedCloudList = localList;
                await db.collection('users').doc(currentUser.uid).set({ collection: localList });
            }
        }
        if (currentMode === 'mylist') displayCards(cachedCloudList);
    } catch (err) {
        console.error("Collection engine pull failure:", err);
    }
}

function openAuthModal() {
    document.getElementById('authModal').style.display = "block";
}

function closeAuthModal() {
    document.getElementById('authModal').style.display = "none";
}

function toggleAuthMode(e) {
    e.preventDefault();
    isLoginMode = !isLoginMode;
    document.getElementById('authTitle').innerText = isLoginMode ? "Sign In" : "Register";
    document.getElementById('authSubmitBtn').innerText = isLoginMode ? "Sign In" : "Register";
    document.getElementById('authSwitchText').innerHTML = isLoginMode 
        ? `Don't have an account? <a href="#" onclick="toggleAuthMode(event)" style="color: var(--primary); text-decoration: none; font-weight: 600;">Register here</a>`
        : `Already have an account? <a href="#" onclick="toggleAuthMode(event)" style="color: var(--primary); text-decoration: none; font-weight: 600;">Sign in here</a>`;
}

async function handleAuthSubmit(e) {
    e.preventDefault();
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    
    try {
        if (isLoginMode) {
            await auth.signInWithEmailAndPassword(email, password);
            showToast("Logged in successfully!");
        } else {
            await auth.createUserWithEmailAndPassword(email, password);
            showToast("Account registered!");
        }
        closeAuthModal();
    } catch (err) {
        alert(err.message);
    }
}

function handleLogout() {
    if (confirm("Log out of your account?")) {
        auth.signOut();
        showToast("Logged out smoothly");
    }
}

function showToast(message) {
    const host = document.getElementById('notificationHost');
    if (!host) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<i class="fas fa-check-circle"></i> ${message}`;
    host.appendChild(toast);
    setTimeout(() => { 
        toast.style.opacity = '0'; 
        setTimeout(() => toast.remove(), 400); 
    }, 2500);
}

function showSkeletons() {
    const grid = document.getElementById('resultsGrid');
    if (!grid) return;
    grid.innerHTML = '';
    for (let i = 0; i < 12; i++) {
        const skel = document.createElement('div');
        skel.className = 'skeleton';
        grid.appendChild(skel);
    }
}

const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function loadData(append = false) {
    if (isLoading || (!hasNextPage && append)) return;
    isLoading = true;

    if (!append) {
        showSkeletons();
        currentFetchedItems = [];
        currentPage = 1;
        hasNextPage = true;
    }

    try {
        let url;
        let baseType = currentMode.includes('manga') ? 'manga' : 'anime';

        if (searchQuery) {
            url = `${JIKAN_BASE}/${baseType}?q=${encodeURIComponent(searchQuery)}&page=${currentPage}`;
        } else if (currentGenre && currentMode !== 'mylist') {
            url = `${JIKAN_BASE}/${baseType}?genres=${currentGenre}&order_by=score&sort=desc&page=${currentPage}`;
        } else {
            url = `${JIKAN_BASE}/${currentMode}${currentMode.includes('?') ? '&' : '?'}page=${currentPage}`;
        }
        
        if (append) await delay(350);

        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP Error Status: ${res.status}`);
        
        const data = await res.json();
        const incomingData = data.data || [];
        
        hasNextPage = data.pagination?.has_next_page ?? false;
        
        if (!append) {
            const grid = document.getElementById('resultsGrid');
            if (grid) grid.innerHTML = '';
            currentFetchedItems = incomingData;
        } else {
            currentFetchedItems = [...currentFetchedItems, ...incomingData];
        }
        
        displayCards(incomingData, append);
        currentPage++;
    } catch (e) { 
        console.error("API Fetch Error:", e); 
    } finally { 
        isLoading = false; 
    }
}

function displayCards(list, append = false) {
    const grid = document.getElementById('resultsGrid');
    if (!grid) return;
    
    const myIds = getMyList().map(i => i.mal_id);
    const globalStartIndex = append ? currentFetchedItems.length - list.length : 0;

    if (currentMode === 'mylist' && !append) {
        grid.innerHTML = '';
    }

    if (currentMode === 'mylist' && list.length === 0) {
        grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:40px; color:#666;">Your collection is empty! Log in or click the + button on elements to build your dashboard.</div>`;
        return;
    }

    list.forEach((item, index) => {
        const id = item.mal_id;
        const title = item.title_english || item.title || 'Unknown Title';
        const img = item.images?.jpg?.large_image_url || item.img || '';
        const isSaved = myIds.includes(id);
        const internalCacheIndex = globalStartIndex + index;

        const card = document.createElement('div');
        card.className = 'card show';
        card.style.animationDelay = `${index * 0.05}s`;

        let iconClass = currentMode === 'mylist' ? 'fa-trash' : 'fa-plus';
        let savedClass = (isSaved && currentMode !== 'mylist') ? 'saved' : '';

        card.innerHTML = `
            <button class="action-btn ${savedClass}" onclick="handleAction(event, ${internalCacheIndex}, ${id})" aria-label="Collect item">
                <i class="fas ${iconClass}"></i>
            </button>
            <img src="${img}" onerror="this.onerror=null; this.src='https://placehold.co/220x320/121212/ffffff?text=No+Image';" loading="lazy" alt="${title}">
            <div class="card-overlay">
                <h4>${title}</h4>
                <div style="font-size:0.75rem; color:var(--primary); font-weight:800; margin-top:4px;">★ ${item.score || 'N/A'}</div>
            </div>
        `;
        
        card.onclick = (e) => { 
            if (!e.target.closest('.action-btn')) openModal(item); 
        };
        grid.appendChild(card);
    });
}

function handleAction(event, cacheIndex, fallbackId) {
    event.stopPropagation();
    let list = getMyList();
    const btn = event.currentTarget;
    
    // Fixed: Ensure lookup accuracy during active lists deletions
    let item = currentMode === 'mylist' 
        ? list.find(i => i.mal_id === fallbackId) 
        : currentFetchedItems[cacheIndex];

    if (!item) return;

    if (currentMode === 'mylist') {
        list = list.filter(i => i.mal_id !== fallbackId);
        const cardNode = btn.closest('.card');
        if (cardNode) cardNode.remove();
        showToast("Removed from Collection");
        saveMyList(list);
        
        // If the collection is now completely empty, trigger empty message state display
        if (list.length === 0) {
            displayCards([]);
        }
    } else if (!list.some(i => i.mal_id === item.mal_id)) {
        list.push(item); 
        btn.classList.add('saved');
        showToast("Added to Collection!");
        saveMyList(list);
    }
}

function setMode(mode, btnId) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    currentMode = mode;
    currentGenre = null;
    searchQuery = '';
    
    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.value = '';

    document.getElementById('sectionTitle').innerText = titles[mode] || 'AniRealm View';
    document.getElementById('clearAllBtn').style.display = (mode === 'mylist') ? 'flex' : 'none';
    document.getElementById('genreContainer').style.display = (mode === 'mylist') ? 'none' : 'flex';
    
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const targetedBtn = document.getElementById(btnId);
    if (targetedBtn) targetedBtn.classList.add('active');
    
    document.querySelectorAll('.genre-tag').forEach(t => t.classList.remove('active'));
    
    if (mode === 'mylist') {
        document.getElementById('resultsGrid').innerHTML = '';
        currentFetchedItems = getMyList();
        hasNextPage = false;
        displayCards(currentFetchedItems);
    } else { 
        loadData(); 
    }
}

function filterByGenre(genreId, btn) {
    searchQuery = '';
    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.value = '';

    currentGenre = genreId;
    document.querySelectorAll('.genre-tag').forEach(t => t.classList.remove('active'));
    if (btn) btn.classList.add('active');
    loadData();
}

function openModal(item) {
    const modal = document.getElementById('infoModal');
    const body = document.getElementById('modalBody');
    if (!modal || !body) return;

    const type = (item.type || '').toLowerCase();
    const imgUrl = item.images?.jpg?.large_image_url || item.img || '';
    
    let redirectUrl = 'https://anikototv.to/home'; 
    let btnText = "WATCH NOW";
    let mediaNoun = "anime"; 
    let actionWord = "watching";

    if (type.includes('novel')) { 
        redirectUrl = 'https://ranobes.top/'; 
        btnText = "READ NOVEL"; 
        mediaNoun = "novels";
        actionWord = "reading";
    } else if (type.includes('manga') || type.includes('manhwa')) { 
        redirectUrl = 'https://mangafire.to/home'; 
        btnText = "READ MANGA"; 
        mediaNoun = "manga";
        actionWord = "reading";
    } else if (type.includes('movie') || type.includes('special')) {
        mediaNoun = "movies";
        actionWord = "watching";
    }

    const titleText = item.title_english || item.title || 'Unknown Title';
    const cleanSynopsis = (item.synopsis || 'No description found.').replace(/'/g, "&apos;");

    body.innerHTML = `
        <img src="${imgUrl}" class="modal-img" alt="${titleText}">
        <div class="modal-info">
            <h2 style="font-size: 1.8rem;">${titleText}</h2>
            <div style="color:var(--primary); font-weight:800; margin: 10px 0;">★ ${item.score || 'N/A'} | ${item.type || 'Media'}</div>
            <p style="line-height: 1.6; color: #aaa; margin-bottom: 20px; max-height:200px; overflow-y:auto;">${cleanSynopsis}</p>
            
            <div class="brave-alert">
                <i class="fab fa-brave brave-icon"></i>
                <span>Annoyed by pop-ups? Try <a href="https://brave.com/" target="_blank" class="brave-link">Brave Browser</a> to block ads while ${actionWord} your favorite ${mediaNoun}!</span>
            </div>

            <button onclick="window.open('${redirectUrl}', '_blank')">${btnText}</button>
        </div>
    `;
    modal.style.display = "block";
}

function closeModal() { 
    const modal = document.getElementById('infoModal');
    if (modal) modal.style.display = "none"; 
}

function clearFullList() {
    if (confirm("Wipe entire collection?")) {
        saveMyList([]);
        document.getElementById('resultsGrid').innerHTML = '';
        currentFetchedItems = [];
        showToast("Collection cleared");
        displayCards([]);
    }
}

async function getRandom() {
    showSkeletons();
    try {
        const type = currentMode.includes('manga') ? 'manga' : 'anime';
        const res = await fetch(`${JIKAN_BASE}/random/${type}`);
        const data = await res.json();
        
        document.getElementById('resultsGrid').innerHTML = '';
        currentFetchedItems = data.data ? [data.data] : [];
        hasNextPage = false;
        displayCards(currentFetchedItems);
    } catch (e) { 
        console.error(e); 
    }
}

function setupSearch() {
    const searchInput = document.getElementById('searchInput');
    if (!searchInput) return;

    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchQuery = e.target.value.trim();

        // Fixed: If searching inside "My Collection", filter locally without making API requests
        if (currentMode === 'mylist') {
            const localFilter = cachedCloudList.filter(item => {
                const title = (item.title_english || item.title || '').toLowerCase();
                return title.includes(searchQuery.toLowerCase());
            });
            displayCards(localFilter);
            return;
        }

        if (!searchQuery) { 
            loadData(); 
            return; 
        }

        searchTimeout = setTimeout(() => {
            currentGenre = null;
            document.querySelectorAll('.genre-tag').forEach(t => t.classList.remove('active'));
            loadData();
        }, 600);
    });
}

// Fixed scroll window evaluation threshold to protect API rate caps
window.onscroll = () => {
    if (currentMode === 'mylist' || !hasNextPage || isLoading) return;
    if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 400) {
        loadData(true);
    }
};