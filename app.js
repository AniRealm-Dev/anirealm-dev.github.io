const JIKAN_BASE = 'https://api.jikan.moe/v4';
let currentPage = 1;
let currentMode = 'top/anime';
let isLoading = false;
let hasNextPage = true;
let searchTimeout;
let currentGenre = null;
let searchQuery = '';
let currentFetchedItems = []; 

// Initialize Firebase Production Instance (Namespaced Structure)
const firebaseConfig = {
    apiKey: "AIzaSyBLXwCX7Ks70HiOUVerl112q87JclfjEmo", 
    authDomain: "anirealm-402d6.firebaseapp.com",
    projectId: "anirealm-402d6",
    storageBucket: "anirealm-402d6.firebasestorage.app",
    messagingSenderId: "288023042255",
    appId: "1:288023042255:web:c2147069ee032752c33fba",
    measurementId: "G-HHV5J980R1"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db = firebase.firestore();

try {
    firebase.analytics();
} catch (analyticsError) {
    console.warn("Analytics initialization skipped:", analyticsError.message);
}

let currentUser = null;
let cachedCloudList = []; 
let isLoginMode = true; 

let deleteTimeout = null;
let pendingDeletedItem = null;

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
            if (authNavBtn) authNavBtn.innerHTML = '<i class="fas fa-user-circle"></i>';
            authNavBtn.title = "View Profile";
            authNavBtn.onclick = openProfileDashboard; 
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
            await db.collection('users').doc(currentUser.uid).update({ collection: newList });
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
            cachedCloudList = localList;
            await db.collection('users').doc(currentUser.uid).set({ 
                username: currentUser.email.split('@')[0],
                collection: localList 
            }, { merge: true });
        }
        if (currentMode === 'mylist') displayCards(cachedCloudList);
    } catch (err) {
        console.error("Collection engine pull failure:", err);
    }
}

function openAuthModal() {
    isLoginMode = false; 
    toggleAuthMode({ preventDefault: () => {} });
    document.getElementById('authModal').style.display = "block";
}

function closeAuthModal() {
    document.getElementById('authModal').style.display = "none";
}

function toggleAuthMode(e) {
    e.preventDefault();
    isLoginMode = !isLoginMode;
    
    const title = document.getElementById('authTitle');
    const submitBtn = document.getElementById('authSubmitBtn');
    const switchText = document.getElementById('authSwitchText');
    const usernameWrapper = document.getElementById('usernameFieldWrapper');
    const forgotPasswordLink = document.getElementById('forgotPasswordLink');
    const emailInput = document.getElementById('authEmail');

    title.innerText = isLoginMode ? "Sign In" : "Register";
    submitBtn.innerText = isLoginMode ? "Sign In" : "Register";
    
    if (isLoginMode) {
        usernameWrapper.style.display = "none";
        if (forgotPasswordLink) forgotPasswordLink.style.display = "block";
        if (emailInput) emailInput.placeholder = "Email or Username";
    } else {
        usernameWrapper.style.display = "block";
        if (forgotPasswordLink) forgotPasswordLink.style.display = "none";
        if (emailInput) emailInput.placeholder = "Email Address";
    }

    switchText.innerHTML = isLoginMode 
        ? `Don't have an account? <a href="#" onclick="toggleAuthMode(event)" style="color: var(--primary); text-decoration: none; font-weight: 600;">Register here</a>`
        : `Already have an account? <a href="#" onclick="toggleAuthMode(event)" style="color: var(--primary); text-decoration: none; font-weight: 600;">Sign in here</a>`;
}

async function handleAuthSubmit(e) {
    e.preventDefault();
    let loginInput = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    
    try {
        if (isLoginMode) {
            let email = loginInput;
            
            if (!loginInput.includes('@')) {
                const usernameSnapshot = await db.collection('usernames').doc(loginInput.toLowerCase()).get();
                if (!usernameSnapshot.exists) {
                    throw new Error("Username profile not found. Please type your full email address or register.");
                }
                email = usernameSnapshot.data().email;
            }

            await auth.signInWithEmailAndPassword(email, password);
            showToast("Logged in successfully!");
        } else {
            const username = document.getElementById('authUsername').value.trim();
            
            if (!username || username.includes('@')) {
                throw new Error("Please type a valid system username profile containing no '@' characters.");
            }

            const usernameRef = db.collection('usernames').doc(username.toLowerCase());
            const usernameDoc = await usernameRef.get();
            if (usernameDoc.exists) {
                throw new Error("This username identity has already been taken by another user!");
            }

            const userCredential = await auth.createUserWithEmailAndPassword(loginInput, password);
            const user = userCredential.user;

            await usernameRef.set({ email: loginInput.toLowerCase(), uid: user.uid });

            await db.collection('users').doc(user.uid).set({
                username: username,
                collection: []
            });

            showToast("Account registered!");
        }
        closeAuthModal();
    } catch (err) {
        alert(err.message);
    }
}

async function handleForgotPassword(e) {
    e.preventDefault();
    const loginInput = document.getElementById('authEmail').value.trim();
    if (!loginInput || !loginInput.includes('@')) {
        alert("Please enter your complete registered email address in the field above to dispatch a reset link.");
        return;
    }
    try {
        await auth.sendPasswordResetEmail(loginInput);
        alert("A password reset email loop has been dispatched successfully! Check your inbox.");
    } catch (err) {
        alert(err.message);
    }
}

async function openProfileDashboard() {
    if (!currentUser) return;
    
    try {
        const userDoc = await db.collection('users').doc(currentUser.uid).get();
        const userData = userDoc.data() || {};
        
        const username = userData.username || currentUser.email.split('@')[0];
        const collection = userData.collection || [];
        const collectionCount = collection.length;

        const animeCount = collection.filter(i => !(i.type || '').toLowerCase().includes('manga') && !(i.type || '').toLowerCase().includes('novel')).length;
        const mangaCount = collectionCount - animeCount;

        const modal = document.getElementById('infoModal');
        const body = document.getElementById('modalBody');
        const container = document.getElementById('modalContainerWindow');
        
        if (!modal || !body) return;

        body.className = ""; 
        body.style.display = "block";

        if (container) {
            container.style.maxWidth = "720px";
            container.style.background = "#0b0b0c";
        }

        body.innerHTML = `
            <div class="profile-dashboard-wrapper">
                <div style="height: 140px; background: linear-gradient(135deg, var(--primary) 0%, #1e1135 100%); position: relative;">
                    <div style="position: absolute; bottom: -25px; left: 30px; display: flex; align-items: flex-end; gap: 20px;">
                        <div style="margin-bottom: 10px;">
                            <h2 style="font-size: 1.6rem; font-weight: 800; margin: 0; line-height: 1.2;">${username}</h2>
                            <p style="color: rgba(255,255,255,0.6); font-size: 0.85rem; margin: 2px 0 0 0;"><i class="fas fa-envelope" style="font-size:0.75rem;"></i> ${currentUser.email}</p>
                        </div>
                    </div>
                </div>

                <div class="profile-grid-container">
                    <div>
                        <h3 style="font-size: 1rem; text-transform: uppercase; letter-spacing: 1px; color: #555; margin: 20px 0 15px 0; font-weight: 800;">Collection Overview</h3>
                        <div class="profile-stats-grid">
                            <div style="background: #121214; padding: 15px; border-radius: 12px; border: 1px solid #1c1c1f; text-align: center;">
                                <div style="font-size: 1.8rem; font-weight: 800; color: var(--primary);">${collectionCount}</div>
                                <div style="font-size: 0.75rem; color: #777; font-weight: 600; margin-top: 4px;">Total Items</div>
                            </div>
                            <div style="background: #121214; padding: 15px; border-radius: 12px; border: 1px solid #1c1c1f; text-align: center;">
                                <div style="font-size: 1.8rem; font-weight: 800; color: #2ecc71;">${animeCount}</div>
                                <div style="font-size: 0.75rem; color: #777; font-weight: 600; margin-top: 4px;">Anime Entries</div>
                            </div>
                            <div style="background: #121214; padding: 15px; border-radius: 12px; border: 1px solid #1c1c1f; text-align: center;">
                                <div style="font-size: 1.8rem; font-weight: 800; color: #3498db;">${mangaCount}</div>
                                <div style="font-size: 0.75rem; color: #777; font-weight: 600; margin-top: 4px;">Manga/Books</div>
                            </div>
                        </div>

                        <div style="background: #121214; border-radius: 12px; border: 1px solid #1c1c1f; padding: 20px; margin-top: 20px;">
                            <h4 style="margin: 0 0 10px 0; font-size: 0.95rem; font-weight: bold; color: #aaa;">System Statistics</h4>
                            <div style="font-size: 0.85rem; color: #666; display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #1c1c1f;">
                                <span>Account Status</span>
                                <span style="color: #2ecc71; font-weight: 600;">Verified Active</span>
                            </div>
                            <div style="font-size: 0.85rem; color: #666; display: flex; justify-content: space-between; padding: 8px 0;">
                                <span>Database Environment</span>
                                <span style="color: var(--primary); font-weight: 600;">Cloud Production</span>
                            </div>
                        </div>
                    </div>

                    <div style="display: flex; flex-direction: column; justify-content: space-between; min-height: 180px; margin-top: 20px;">
                        <div>
                            <h3 style="font-size: 1rem; text-transform: uppercase; letter-spacing: 1px; color: #555; margin: 0 0 15px 0; font-weight: 800;">Account Settings</h3>
                            <p style="font-size: 0.85rem; color: #555; margin: 0 0 20px 0; line-height: 1.5;">Manage session properties, data sync states, or logout of your device tracking nodes safely.</p>
                        </div>
                        
                        <button onclick="handleLogout()" style="background: #e74c3c; color: white; border: none; padding: 14px; width: 100%; border-radius: 10px; font-weight: 600; cursor: pointer; transition: background 0.2s; display: flex; align-items: center; justify-content: center; gap: 10px; box-shadow: 0 4px 12px rgba(231, 76, 60, 0.2);">
                            <i class="fas fa-sign-out-alt"></i> Sign Out Account
                        </button>
                    </div>
                </div>
            </div>
        `;
        modal.style.display = "block";
    } catch (err) {
        console.error("Failed to compile dashboard view:", err);
    }
}

function handleLogout() {
    if (confirm("Log out of your account?")) {
        if (deleteTimeout) {
            clearTimeout(deleteTimeout);
            deleteTimeout = null;
            pendingDeletedItem = null;
        }
        auth.signOut();
        closeModal();
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

function showUndoToast(message) {
    const host = document.getElementById('notificationHost');
    if (!host) return;
    
    document.querySelectorAll('.toast').forEach(t => t.remove());

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.style.background = '#1f1f1f';
    toast.style.border = '1px solid #333';
    toast.style.display = 'flex';
    toast.style.alignItems = 'center';
    toast.style.justifyContent = 'space-between';
    toast.style.minWidth = '280px';
    
    toast.innerHTML = `
        <span><i class="fas fa-trash-alt" style="color: #e74c3c; margin-right: 8px;"></i> ${message}</span>
        <button onclick="triggerUndoAction()" style="background: var(--primary); color: #fff; border: none; padding: 6px 12px; margin-left: 15px; border-radius: 4px; font-weight: 700; cursor: pointer; font-size: 0.75rem; font-family: inherit;">UNDO</button>
    `;
    host.appendChild(toast);
    
    setTimeout(() => { 
        toast.style.opacity = '0'; 
        setTimeout(() => toast.remove(), 400); 
    }, 4000);
}

function triggerUndoAction() {
    if (!pendingDeletedItem) return;
    
    clearTimeout(deleteTimeout);
    deleteTimeout = null;

    let list = getMyList();
    list.push(pendingDeletedItem);
    cachedCloudList = list;
    pendingDeletedItem = null;

    displayCards(list);
    if (!currentUser) {
        localStorage.setItem('aniRealmList', JSON.stringify(list));
    }
    
    document.querySelectorAll('.toast').forEach(t => t.remove());
    showToast("Restored successfully!");
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
    
    if (currentMode === 'mylist') {
        if (deleteTimeout) {
            clearTimeout(deleteTimeout);
            deleteTimeout = null;
        }

        pendingDeletedItem = list.find(i => i.mal_id === fallbackId);
        if (!pendingDeletedItem) return;

        list = list.filter(i => i.mal_id !== fallbackId);
        cachedCloudList = list;
        
        const cardNode = btn.closest('.card');
        if (cardNode) cardNode.remove();
        if (list.length === 0) displayCards([]);

        showUndoToast("Removed from Collection");

        deleteTimeout = setTimeout(async () => {
            if (pendingDeletedItem) {
                if (currentUser) {
                    try {
                        await db.collection('users').doc(currentUser.uid).set({ collection: list }, { merge: true });
                    } catch (err) {
                        console.error("Firestore delayed removal error:", err);
                    }
                } else {
                    localStorage.setItem('aniRealmList', JSON.stringify(list));
                }
                pendingDeletedItem = null;
                deleteTimeout = null;
            }
        }, 4000);

    } else {
        const item = currentFetchedItems[cacheIndex];
        if (!item) return;

        if (!list.some(i => i.mal_id === item.mal_id)) {
            list.push(item); 
            btn.classList.add('saved');
            showToast("Added to Collection!");
            saveMyList(list);
        }
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
    const container = document.getElementById('modalContainerWindow');
    
    if (!modal || !body) return;

    body.className = "modal-flex"; 
    body.style.display = "flex";

    if (container) {
        container.style.maxWidth = "var(--modal-max-width, 900px)";
        container.style.background = "#0f0f0f";
    }

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

window.onscroll = () => {
    if (currentMode === 'mylist' || !hasNextPage || isLoading) return;
    if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 400) {
        loadData(true);
    }
};