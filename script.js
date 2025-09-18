// Configuration
const API_ENDPOINT_BASE = "https://rscripts.net/api/v2/scripts";
let currentPage = 1;
let maxPages = null;
let autoRefresh = true;
let pollIntervalSeconds = 3600;
let pollTimer = null;
let newestTimestamp = null;
let allScripts = [];
let filteredScripts = [];
let searchQuery = "";

// DOM Elements
const grid = document.getElementById("scriptsGrid");
const statusPage = document.getElementById("currentPage");
const statusMax = document.getElementById("maxPages");
const newCountBadge = document.getElementById("newCountBadge");
const searchInput = document.getElementById("searchInput");
const clearSearchBtn = document.getElementById("clearSearch");
const noResultsDiv = document.getElementById("noResults");

// API Functions
async function fetchScripts(page = 1) {
    const url = new URL(API_ENDPOINT_BASE);
    url.searchParams.set("page", page);
    url.searchParams.set("orderBy", "date");
    url.searchParams.set("sort", "desc");

    try {
        const resp = await fetch(url.toString());
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        
        const data = await resp.json();
        
        if (!data || !data.scripts) {
            console.error("Unexpected API response format", data);
            return { scripts: [], info: {} };
        }

        return data;
    } catch (err) {
        console.error("API fetch error:", err);
        return { scripts: [], info: {} };
    }
}

// Render Functions
function renderScriptCard(script, prepend = false) {
    const card = document.createElement("article");
    card.className = "card";
    card.style.animationDelay = prepend ? "0s" : `${Math.random() * 0.3}s`;
    
    const hasUser = script.user && script.user.username;
    const author = hasUser ? script.user.username : (script.creator || "Unknown");
    const avatar = hasUser && script.user.image ? 
        script.user.image : 
        `https://ui-avatars.com/api/?name=${encodeURIComponent(author)}&background=7c3aed&color=ffffff&size=80`;
    
    const thumbnail = script.image || "https://via.placeholder.com/300x200/0a0e1a/7c3aed?text=No+Image";
    const description = script.description ? 
        (script.description.length > 120 ? script.description.slice(0, 120) + "..." : script.description) : 
        "No description available";

    card.innerHTML = `
        <div class="card-header">
            <img class="thumbnail" src="${escapeAttr(thumbnail)}" alt="${escapeAttr(script.title)}" loading="lazy">
            <div class="card-content">
                <h3>${escapeHtml(script.title || "Untitled Script")}</h3>
                <div class="meta">
                    <span>${formatDate(script.createdAt || script.date)}</span>
                    <span>•</span>
                    <span>ID: ${escapeHtml(script._id || "N/A")}</span>
                </div>
            </div>
        </div>

        <div class="creator">
            <img class="avatar" src="${escapeAttr(avatar)}" alt="${escapeAttr(author)}" loading="lazy">
            <div class="creator-info">
                <div class="creator-name">${escapeHtml(author)}</div>
                <div class="creator-desc">${escapeHtml(description)}</div>
            </div>
        </div>

        <div class="card-actions">
            <button class="btn small" data-action="showCode">Show Code</button>
            <a class="btn small" href="${escapeAttr(script.rawScript || "#")}" target="_blank" rel="noopener noreferrer">
                Raw File
            </a>
            <span class="language-tag">${escapeHtml(script.language || "")}</span>
        </div>

        <pre class="code" data-rawurl="${escapeAttr(script.rawScript || "")}">Loading code...</pre>
    `;

    // Attach event listeners
    attachCardEvents(card);

    if (prepend) {
        grid.prepend(card);
    } else {
        grid.appendChild(card);
    }

    return card;
}

function attachCardEvents(card) {
    const showCodeBtn = card.querySelector('[data-action="showCode"]');
    const codeBlock = card.querySelector('.code');
    
    showCodeBtn.addEventListener("click", async (e) => {
        const button = e.currentTarget;
        const isVisible = codeBlock.style.display !== "none";
        
        if (isVisible) {
            codeBlock.style.display = "none";
            button.textContent = "Show Code";
        } else {
            codeBlock.style.display = "block";
            button.textContent = "Hide Code";
            
            // Load code if not already loaded
            if (codeBlock.textContent.trim() === "Loading code...") {
                const rawUrl = codeBlock.getAttribute('data-rawurl');
                
                if (rawUrl) {
                    try {
                        button.textContent = "Loading...";
                        const response = await fetch(rawUrl);
                        
                        if (response.ok) {
                            const code = await response.text();
                            codeBlock.textContent = code.slice(0, 15000); // Limit code length
                        } else {
                            codeBlock.textContent = `// Failed to load code (HTTP ${response.status})`;
                        }
                    } catch (error) {
                        codeBlock.textContent = `// Error loading code: ${error.message}`;
                    }
                    button.textContent = "Hide Code";
                } else {
                    codeBlock.textContent = "// No raw script URL available";
                }
            }
        }
    });
}

// Page Loading Functions
async function loadPage(page = 1, showLoading = true) {
    if (showLoading) {
        setLoadingState(true);
    }

    try {
        const data = await fetchScripts(page);
        
        // Clear grid and update page info
        grid.innerHTML = "";
        allScripts = data.scripts || [];
        
        // Apply current search filter
        applySearchFilter();
        
        currentPage = data.info?.currentPage || page;
        maxPages = data.info?.maxPages || null;
        
        updatePageStatus();
        
        // Update newest timestamp for polling
        if (data.scripts && data.scripts.length > 0) {
            const first = data.scripts[0];
            newestTimestamp = first.createdAt || first.date || newestTimestamp;
        }
        
    } catch (error) {
        console.error("Error loading page:", error);
        showError("Failed to load scripts. Please try again.");
    } finally {
        setLoadingState(false);
    }
}

async function pollForNewScripts() {
    if (!autoRefresh) return;

    try {
        const data = await fetchScripts(1);
        
        if (!data.scripts?.length) return;

        const newItems = [];
        
        for (const script of data.scripts) {
            const timestamp = script.createdAt || script.date;
            
            if (!newestTimestamp) {
                newestTimestamp = timestamp;
                break;
            }
            
            if (timestamp && timestamp > newestTimestamp) {
                newItems.push(script);
            } else {
                break; // Scripts are ordered by date desc
            }
        }

        if (newItems.length > 0) {
            // Add new items to the beginning of allScripts
            allScripts = [...newItems.reverse(), ...allScripts];
            
            // Update newest timestamp
            newestTimestamp = data.scripts[0].createdAt || data.scripts[0].date || newestTimestamp;
            
            // Re-apply search filter and render
            applySearchFilter();
            
            // Show notification
            showNewCount(newItems.length);
            
            // Auto-hide notification after 5 seconds
            setTimeout(() => showNewCount(0), 5000);
        }
        
    } catch (error) {
        console.error("Polling failed:", error);
    }
}

// Search Functions
function applySearchFilter() {
    if (!searchQuery.trim()) {
        filteredScripts = [...allScripts];
    } else {
        const query = searchQuery.toLowerCase();
        filteredScripts = allScripts.filter(script => 
            (script.title || "").toLowerCase().includes(query) ||
            (script.description || "").toLowerCase().includes(query) ||
            (script.creator || "").toLowerCase().includes(query) ||
            (script.user?.username || "").toLowerCase().includes(query)
        );
    }
    
    renderFilteredScripts();
}

function renderFilteredScripts() {
    grid.innerHTML = "";
    
    if (filteredScripts.length === 0) {
        noResultsDiv.style.display = "block";
    } else {
        noResultsDiv.style.display = "none";
        filteredScripts.forEach((script, index) => {
            const card = renderScriptCard(script);
            card.style.animationDelay = `${index * 0.1}s`;
        });
    }
}

// UI Helper Functions
function setLoadingState(loading) {
    const refreshBtn = document.getElementById("refreshBtn");
    const spinner = refreshBtn.querySelector(".loading-spinner");
    const text = refreshBtn.querySelector(".btn-text");
    
    if (loading) {
        refreshBtn.classList.add("loading");
        refreshBtn.disabled = true;
        spinner.style.display = "inline-block";
        text.style.display = "none";
    } else {
        refreshBtn.classList.remove("loading");
        refreshBtn.disabled = false;
        spinner.style.display = "none";
        text.style.display = "inline";
    }
}

function showNewCount(count) {
    if (count > 0) {
        newCountBadge.style.display = "inline-block";
        newCountBadge.textContent = `${count} new`;
        
        // Animate badge
        newCountBadge.style.animation = "none";
        setTimeout(() => {
            newCountBadge.style.animation = "pulse 2s infinite";
        }, 10);
    } else {
        newCountBadge.style.display = "none";
    }
}

function updatePageStatus() {
    statusPage.textContent = currentPage;
    statusMax.textContent = maxPages || "?";
    
    // Update pagination buttons
    const prevBtn = document.getElementById("prevPage");
    const nextBtn = document.getElementById("nextPage");
    
    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = maxPages && currentPage >= maxPages;
}

function showError(message) {
    // Create and show error notification
    const errorDiv = document.createElement("div");
    errorDiv.className = "error-notification";
    errorDiv.textContent = message;
    errorDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: var(--error);
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        z-index: 1000;
        animation: slideIn 0.3s ease;
    `;
    
    document.body.appendChild(errorDiv);
    
    setTimeout(() => {
        errorDiv.remove();
    }, 5000);
}

// Utility Functions
function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/[&<>"']/g, match => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[match]);
}

function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
    if (!dateStr) return "Unknown date";
    
    try {
        const date = new Date(dateStr);
        if (isNaN(date)) return dateStr;
        
        const now = new Date();
        const diffTime = now - date;
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays === 0) {
            const diffHours = Math.floor(diffTime / (1000 * 60 * 60));
            if (diffHours === 0) {
                const diffMinutes = Math.floor(diffTime / (1000 * 60));
                return diffMinutes < 1 ? "Just now" : `${diffMinutes}m ago`;
            }
            return `${diffHours}h ago`;
        } else if (diffDays === 1) {
            return "Yesterday";
        } else if (diffDays < 7) {
            return `${diffDays}d ago`;
        } else {
            return date.toLocaleDateString();
        }
    } catch (error) {
        return dateStr;
    }
}

function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    if (!autoRefresh) return;
    
    pollTimer = setInterval(pollForNewScripts, pollIntervalSeconds * 1000);
}

// Event Listeners
document.addEventListener("DOMContentLoaded", () => {
    // Search functionality
    searchInput.addEventListener("input", (e) => {
        searchQuery = e.target.value;
        clearSearchBtn.style.display = searchQuery ? "inline-block" : "none";
        applySearchFilter();
    });

    clearSearchBtn.addEventListener("click", () => {
        searchQuery = "";
        searchInput.value = "";
        clearSearchBtn.style.display = "none";
        applySearchFilter();
    });

    // Control buttons
    document.getElementById("refreshBtn").addEventListener("click", () => {
        loadPage(currentPage);
    });

    document.getElementById("toggleAutorefresh").addEventListener("click", (e) => {
        autoRefresh = !autoRefresh;
        e.target.textContent = `Auto-refresh: ${autoRefresh ? "ON" : "OFF"}`;
        
        if (autoRefresh) {
            startPolling();
        } else {
            clearInterval(pollTimer);
        }
    });

    document.getElementById("intervalSelect").addEventListener("change", (e) => {
        pollIntervalSeconds = Number(e.target.value);
        startPolling();
    });

    // Pagination
    document.getElementById("prevPage").addEventListener("click", () => {
        if (currentPage > 1) {
            currentPage--;
            loadPage(currentPage);
        }
    });

    document.getElementById("nextPage").addEventListener("click", () => {
        if (!maxPages || currentPage < maxPages) {
            currentPage++;
            loadPage(currentPage);
        }
    });

    // New count badge click
    newCountBadge.addEventListener("click", () => {
        showNewCount(0);
        window.scrollTo({ top: 0, behavior: "smooth" });
    });

    // Set current year in footer
    document.getElementById("currentYear").textContent = new Date().getFullYear();

    // Initialize
    loadPage(1).then(() => {
        startPolling();
        
        // Initial poll after delay to catch any new items
        setTimeout(pollForNewScripts, 3000);
    });
});

// Add smooth scroll behavior for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth'
            });
        }
    });
});