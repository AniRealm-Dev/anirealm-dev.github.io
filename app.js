const JIKAN_BASE = 'https://api.jikan.moe/v4';
let currentPage = 1;
let currentMode = 'top/anime';
let isLoading = false;
let searchTimeout;
let currentGenre = null;
let currentFetchedItems = []; // Safe runtime cache to prevent HTML data-string injection crashes

const titles = {
    'top/anime': 'Global Rated Anime',
    'top/manga': 'Top Rated Manga',
    'top/manga?type=novel': 'Premium Light Novels',
    'seasons/now': 'Trending Now',
    'mylist': 'My Collection'
};

window.onload = () => {
    loadData();
    // Splash Screen Timer
    const splash = document.getElementById('splash-screen');
    setTimeout(() => {
        if (splash) {
            splash.classList.add('splash-hidden');
            setTimeout(() => { splash.style.display = 'none'; }, 1000);
        }
    }, 2800);
};

// Data Management
function getMyList() { 
    return JSON.parse(localStorage.getItem('aniRealmList')) || []; 
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
    for(let i=0; i<12; i++) {
        const skel = document.createElement('div');
        skel.className = 'skeleton';
        grid.appendChild(skel);
    }
}

// Helper delay to avoid Jikan 429 rate limit errors
const delay = (ms) => new Promise(res => setTimeout(res, ms));

// Main Fetcher
async function loadData(append = false) {
    if (isLoading) return;
    isLoading = true;
    if (!append) {
        showSkeletons();
        currentFetchedItems = []; // Reset local cache for fresh loads
    }

    try {
        let url;
        if (currentGenre && currentMode !== 'mylist') {
            let baseType = currentMode.includes('manga') ? 'manga' : 'anime';
            url = `${JIKAN_BASE}/${baseType}?genres=${currentGenre}&order_by=score&sort=desc&page=${currentPage}`;
        } else {
            url = `${JIKAN_BASE}/${currentMode}${currentMode.includes('?') ? '&' : '?'}page=${currentPage}`;
        }
        
        // Add artificial throttle safety buffer for infinite scroll
        if (append) await delay(300);

        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP Error Status: ${res.status}`);
        
        const data = await res.json();
        const incomingData = data.data || [];
        
        if (!append) {
            document.getElementById('resultsGrid').innerHTML = '';
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

    list.forEach((item, index) => {
        const id = item.mal_id;
        const title = item.title_english || item.title;
        const img = item.images?.jpg?.large_image_url || item.img || '';
        const isSaved = myIds.includes(id);
        
        // Match actual index position relative to global runtime cache array
        const internalCacheIndex = globalStartIndex + index;

        const card = document.createElement('div');
        card.className = 'card show';
        card.style.animationDelay = `${index * 0.05}s`;

        let iconClass = currentMode === 'mylist' ? 'fa-trash' : 'fa-plus';
        let savedClass = (isSaved && currentMode !== 'mylist') ? 'saved' : '';

        // Clean & Bug-free implementation using explicit index references instead of inline stringified JSON object injections
        card.innerHTML = `
            <button class="action-btn ${savedClass}" onclick="handleAction(event, ${internalCacheIndex}, ${id})">
                <i class="fas ${iconClass}"></i>
            </button>
            <img src="${img}" loading="lazy" alt="${title}">
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

// User Actions
function handleAction(event, cacheIndex, fallbackId) {
    event.stopPropagation();
    let list = getMyList();
    const btn = event.currentTarget;
    
    // Fallback security if pulling elements directly from the 'My Collection' view
    let item = currentMode === 'mylist' 
        ? list.find(i => i.mal_id === fallbackId) 
        : currentFetchedItems[cacheIndex];

    if (!item) return;

    if (currentMode === 'mylist') {
        list = list.filter(i => i.mal_id !== item.mal_id);
        const cardNode = btn.closest('.card');
        if (cardNode) cardNode.remove();
        showToast("Removed from Collection");
    } else if (!list.some(i => i.mal_id === item.mal_id)) {
        list.push(item); 
        btn.classList.add('saved');
        showToast("Added to Collection!");
    }
    localStorage.setItem('aniRealmList', JSON.stringify(list));
}

function setMode(mode, btnId) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    currentMode = mode;
    currentPage = 1;
    currentGenre = null;
    
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
        displayCards(currentFetchedItems);
    } else { 
        loadData(); 
    }
}

function filterByGenre(genreId, btn) {
    currentGenre = genreId;
    currentPage = 1;
    document.querySelectorAll('.genre-tag').forEach(t => t.classList.remove('active'));
    if (btn) btn.classList.add('active');
    loadData();
}

// Modal Logic
function openModal(item) {
    const modal = document.getElementById('infoModal');
    const body = document.getElementById('modalBody');
    if (!modal || !body) return;

    const type = (item.type || '').toLowerCase();
    const imgUrl = item.images?.jpg?.large_image_url || item.img || '';
    
    let redirectUrl = 'https://anikototv.to/home'; 
    let btnText = "WATCH NOW";
    let mediaNoun = "anime"; 
    let actionWord = "watching"; // Default for anime

    // Logic to switch verbs based on content type
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
    if(confirm("Wipe entire collection?")) {
        localStorage.setItem('aniRealmList', '[]');
        document.getElementById('resultsGrid').innerHTML = '';
        currentFetchedItems = [];
        showToast("Collection cleared");
    }
}

// Utilities
async function getRandom() {
    showSkeletons();
    try {
        const type = currentMode.includes('manga') ? 'manga' : 'anime';
        const res = await fetch(`${JIKAN_BASE}/random/${type}`);
        const data = await res.json();
        
        document.getElementById('resultsGrid').innerHTML = '';
        currentFetchedItems = data.data ? [data.data] : [];
        displayCards(currentFetchedItems);
    } catch (e) { 
        console.error(e); 
    }
}

// Search Handler
document.getElementById('searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();
    if (!query) { 
        currentPage = 1; 
        loadData(); 
        return; 
    }
    searchTimeout = setTimeout(async () => {
        showSkeletons();
        try {
            let typeSearch = (currentMode.includes('manga')) ? 'manga' : 'anime';
            const res = await fetch(`${JIKAN_BASE}/${typeSearch}?q=${query}`);
            const data = await res.json();
            
            document.getElementById('resultsGrid').innerHTML = '';
            currentFetchedItems = data.data || [];
            displayCards(currentFetchedItems);
        } catch(err) {
            console.error("Search failed:", err);
        }
    }, 600);
});

// Infinite Scroll
window.onscroll = () => {
    if (currentMode === 'mylist') return;
    if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 1000) {
        if (!isLoading) loadData(true);
    }
};