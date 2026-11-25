        /* =====================================================================
           1. AI OVERVIEW CONST (Q: "" A: "" pairs for specific search topics)
           ===================================================================== */
        const AI_OVERVIEWS = [
            {
                Q: "grapegreen",
                A: "GrapeGreen Search is a custom local-first search engine with fuzzy matching that scans your indexed JSON files, video links, and image embeds with built-in AI Overviews."
            },
            {
                Q: "poop",
                A: "Poop (feces) is the solid or semisolid remains of food that was not digested in the small intestine, broken down by bacteria in the large intestine."
            },
            {
                Q: "memes",
                A: "Memes are humorous images, videos, or pieces of text that are copied and spread rapidly by internet users, often with slight variations."
            }
        ];

        /* =====================================================================
           2. FUZZY SEARCH ENGINE CORE (Levenshtein + Token Similarity)
           ===================================================================== */
        function levenshteinDistance(a, b) {
            const m = a.length;
            const n = b.length;
            if (m === 0) return n;
            if (n === 0) return m;

            const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
            for (let i = 0; i <= m; i++) dp[i][0] = i;
            for (let j = 0; j <= n; j++) dp[0][j] = j;

            for (let i = 1; i <= m; i++) {
                for (let j = 1; j <= n; j++) {
                    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                    dp[i][j] = Math.min(
                        dp[i - 1][j] + 1,       // deletion
                        dp[i][j - 1] + 1,       // insertion
                        dp[i - 1][j - 1] + cost // substitution
                    );
                }
            }
            return dp[m][n];
        }

        // Returns a similarity score from 0.0 (no match) to 1.0 (exact match)
        function computeFuzzyScore(query, targetText) {
            const q = String(query || '').toLowerCase().trim();
            const t = String(targetText || '').toLowerCase().trim();
            if (!q || !t) return 0;

            // 1. Exact match
            if (q === t) return 1.0;

            // 2. Direct substring match
            if (t.includes(q)) {
                return 0.88 + (0.1 * (q.length / t.length));
            }

            // 3. Word-by-word fuzzy comparison (handles typos like "pooop", "grapgren", "meems")
            const queryWords = q.split(/\s+/);
            const targetWords = t.split(/[^a-z0-9]+/).filter(Boolean);

            let totalBestWordScore = 0;

            for (const qWord of queryWords) {
                let bestForThisWord = 0;

                // Compare against full target string
                const fullDist = levenshteinDistance(qWord, t);
                const fullSim = 1 - fullDist / Math.max(qWord.length, t.length);
                if (fullSim > bestForThisWord) bestForThisWord = fullSim;

                // Compare against every individual word in the target
                for (const tWord of targetWords) {
                    if (tWord.startsWith(qWord) || qWord.startsWith(tWord)) {
                        const prefixSim = 0.82 * (Math.min(qWord.length, tWord.length) / Math.max(qWord.length, tWord.length));
                        if (prefixSim > bestForThisWord) bestForThisWord = prefixSim;
                    }
                    const dist = levenshteinDistance(qWord, tWord);
                    const sim = 1 - dist / Math.max(qWord.length, tWord.length);
                    if (sim > bestForThisWord) bestForThisWord = sim;
                }

                totalBestWordScore += bestForThisWord;
            }

            return totalBestWordScore / queryWords.length;
        }

        const FUZZY_THRESHOLD = 0.52; // Minimum similarity (0 to 1) to count as a closest result

        /* =====================================================================
           3. VIDEOS & IMAGES READERS (Name + URL for Videos; URL Iframe for Images)
           Reads from videos/videos.json (or videos/manifest.json) and
           images/images.json (or images/manifest.json) + directory listings.
           ===================================================================== */
        async function fetchVideos(query) {
            let rawItems = [];

            // Try reading videos/videos.json or videos/manifest.json
            for (const file of ['videos/videos.json', 'videos/manifest.json']) {
                try {
                    const res = await fetch(file);
                    if (res.ok) {
                        const data = await res.json();
                        if (Array.isArray(data)) {
                            rawItems = data.map(entry => {
                                if (typeof entry === 'string') {
                                    // Convert plain filename/URL to { name, url }
                                    const isUrl = /^https?:\/\//i.test(entry);
                                    return {
                                        name: entry.split('/').pop(),
                                        url: isUrl ? entry : `videos/${entry}`
                                    };
                                }
                                return {
                                    name: entry.name || entry.title || entry.url || 'Untitled Video',
                                    url: entry.url || '#'
                                };
                            });
                            break;
                        }
                    }
                } catch (e) { /* try next */ }
            }

            // Fallback: scan videos/ directory listing if no JSON was found
            if (rawItems.length === 0) {
                try {
                    const dirRes = await fetch('videos/');
                    if (dirRes.ok) {
                        const html = await dirRes.text();
                        const doc = new DOMParser().parseFromString(html, 'text/html');
                        const exts = ['.mp4', '.webm', '.ogg', '.mov'];
                        Array.from(doc.querySelectorAll('a')).forEach(a => {
                            const href = decodeURIComponent(a.getAttribute('href') || '');
                            const fname = href.split('/').pop();
                            if (exts.some(ext => fname.toLowerCase().endsWith(ext))) {
                                rawItems.push({ name: fname, url: `videos/${fname}` });
                            }
                        });
                    }
                } catch (e) { /* ignore */ }
            }

            // Score & sort with fuzzy search
            return rawItems
                .map(vid => {
                    const score = Math.max(
                        computeFuzzyScore(query, vid.name),
                        computeFuzzyScore(query, vid.url) * 0.8
                    );
                    return { ...vid, score };
                })
                .filter(vid => vid.score >= FUZZY_THRESHOLD)
                .sort((a, b) => b.score - a.score);
        }

        async function fetchImages(query) {
            let rawItems = [];

            // Try reading images/images.json or images/manifest.json
            for (const file of ['images/images.json', 'images/manifest.json']) {
                try {
                    const res = await fetch(file);
                    if (res.ok) {
                        const data = await res.json();
                        if (Array.isArray(data)) {
                            rawItems = data.map(entry => {
                                if (typeof entry === 'string') {
                                    const isUrl = /^https?:\/\//i.test(entry);
                                    return {
                                        name: entry.split('/').pop(),
                                        url: isUrl ? entry : `images/${entry}`
                                    };
                                }
                                return {
                                    name: entry.name || entry.title || entry.url || 'Image Embed',
                                    url: entry.url || ''
                                };
                            });
                            break;
                        }
                    }
                } catch (e) { /* try next */ }
            }

            // Fallback: scan images/ directory listing if no JSON was found
            if (rawItems.length === 0) {
                try {
                    const dirRes = await fetch('images/');
                    if (dirRes.ok) {
                        const html = await dirRes.text();
                        const doc = new DOMParser().parseFromString(html, 'text/html');
                        const exts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
                        Array.from(doc.querySelectorAll('a')).forEach(a => {
                            const href = decodeURIComponent(a.getAttribute('href') || '');
                            const fname = href.split('/').pop();
                            if (exts.some(ext => fname.toLowerCase().endsWith(ext))) {
                                rawItems.push({ name: fname, url: `images/${fname}` });
                            }
                        });
                    }
                } catch (e) { /* ignore */ }
            }

            // Score & sort with fuzzy search
            return rawItems
                .map(img => {
                    const score = Math.max(
                        computeFuzzyScore(query, img.name),
                        computeFuzzyScore(query, img.url) * 0.8
                    );
                    return { ...img, score };
                })
                .filter(img => img.score >= FUZZY_THRESHOLD && img.url)
                .sort((a, b) => b.score - a.score);
        }

        /* =====================================================================
           4. INDEXED JSON READER WITH FUZZY FALLBACK
           Checks exact indexed/{query}.json first, plus any files listed in
           indexed/manifest.json (or directory listing) so typos still match!
           ===================================================================== */
        async function fetchIndexedSites(query) {
            const candidateFiles = new Set();
            const safeName = query.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '_');
            if (safeName) candidateFiles.add(`indexed/${safeName}.json`);

            // Check if indexed/manifest.json exists so we can fuzzy-search across ALL JSON files
            try {
                const manifestRes = await fetch('indexed/manifest.json');
                if (manifestRes.ok) {
                    const list = await manifestRes.json();
                    if (Array.isArray(list)) {
                        list.forEach(f => {
                            const clean = f.endsWith('.json') ? f : `${f}.json`;
                            candidateFiles.add(clean.startsWith('indexed/') ? clean : `indexed/${clean}`);
                        });
                    }
                }
            } catch (e) { /* ignore if no manifest */ }

            // Also check directory listing of indexed/ if available on local server
            try {
                const dirRes = await fetch('indexed/');
                if (dirRes.ok) {
                    const html = await dirRes.text();
                    const doc = new DOMParser().parseFromString(html, 'text/html');
                    Array.from(doc.querySelectorAll('a')).forEach(a => {
                        const href = decodeURIComponent(a.getAttribute('href') || '');
                        const fname = href.split('/').pop();
                        if (fname.toLowerCase().endsWith('.json') && fname.toLowerCase() !== 'manifest.json') {
                            candidateFiles.add(`indexed/${fname}`);
                        }
                    });
                }
            } catch (e) { /* ignore */ }

            let allSites = [];

            for (const filePath of candidateFiles) {
                try {
                    const res = await fetch(filePath);
                    if (!res.ok) continue;
                    const data = await res.json();
                    const entries = Array.isArray(data) ? data : [data];
                    const fileStem = filePath.split('/').pop().replace(/\.json$/i, '');

                    entries.forEach(site => {
                        allSites.push({ ...site, _sourceFile: fileStem });
                    });
                } catch (e) { /* skip missing/invalid file */ }
            }

            // Score every site using fuzzy matching across title, keywords, description, meta tags, and filename
            const scoredSites = allSites.map(site => {
                const titleScore = computeFuzzyScore(query, site.title || '');
                const descScore = computeFuzzyScore(query, site.description || '') * 0.9;
                const fileScore = computeFuzzyScore(query, site._sourceFile || '');

                const kwList = Array.isArray(site.keywords) ? site.keywords : [site.keywords || ''];
                const kwScore = kwList.reduce((max, k) => Math.max(max, computeFuzzyScore(query, k)), 0);

                const metaList = Array.isArray(site["meta tags"]) ? site["meta tags"] : [site["meta tags"] || ''];
                const metaScore = metaList.reduce((max, m) => Math.max(max, computeFuzzyScore(query, m)), 0) * 0.95;

                const bestScore = Math.max(titleScore, descScore, fileScore, kwScore, metaScore);
                return { ...site, _score: bestScore };
            });

            // Filter by fuzzy threshold and sort by closeness first, then popularity
            return scoredSites
                .filter(s => s._score >= FUZZY_THRESHOLD)
                .sort((a, b) => {
                    if (Math.abs(b._score - a._score) > 0.12) {
                        return b._score - a._score;
                    }
                    return (Number(b.popular) || 0) - (Number(a.popular) || 0);
                });
        }

        /* =====================================================================
           5. CORE SEARCH EXECUTION
           ===================================================================== */
        const searchInput = document.getElementById('search-input');
        const searchBtn = document.getElementById('search-btn');
        const mainContainer = document.getElementById('main-container');
        const resultsArea = document.getElementById('results-area');
        const fuzzyBanner = document.getElementById('fuzzy-banner');

        async function performSearch() {
    const query = searchInput.value.trim();
    if (!query) return;

    // Detect full URL (http:// or https://) or domain name (e.g., google.com)
    const isFullUrl = /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(query);
    const isDomain = /^[a-z0-9-]+(\.[a-z0-9-]+)+([\/?#].*)?$/i.test(query);

    if (isFullUrl) {
        window.location.href = query;
        return;
    }
    if (isDomain) {
        window.location.href = 'https://' + query;
        return;
    }

    mainContainer.classList.add('has-results');
    resultsArea.style.display = 'flex';
    fuzzyBanner.style.display = 'none';

    // 1. Render AI Overview with Fuzzy Matching
    const overviewBox = document.getElementById('ai-overview-content');
    const overviewBadge = document.getElementById('overview-match-badge');

    const scoredQA = AI_OVERVIEWS
        .map(item => ({ ...item, score: computeFuzzyScore(query, item.Q) }))
        .filter(item => item.score >= FUZZY_THRESHOLD)
        .sort((a, b) => b.score - a.score);

    const bestQA = scoredQA[0];

    if (bestQA) {
        const isExact = bestQA.Q.toLowerCase() === query.toLowerCase();
        overviewBadge.style.display = 'inline-block';
        overviewBadge.textContent = isExact
            ? 'Exact match'
            : `Closest match: "${bestQA.Q}" (${Math.round(bestQA.score * 100)}%)`;

        overviewBox.innerHTML = `<strong>Q: ${escapeHTML(bestQA.Q)}</strong><br><br>${escapeHTML(bestQA.A)}`;

        if (!isExact) {
            fuzzyBanner.style.display = 'block';
            fuzzyBanner.innerHTML = `Showing closest fuzzy results for <strong>"${escapeHTML(query)}"</strong> (nearest topic: <strong>${escapeHTML(bestQA.Q)}</strong>)`;
        }
    } else {
        overviewBadge.style.display = 'none';
        overviewBox.innerHTML = `<span class="empty-state">No close AI Overview found for "${escapeHTML(query)}". Try AI Mode for a live response!</span>`;
    }

    // 2. Render Videos (Name of video + URL to video)
    const videosContainer = document.getElementById('videos-content');
    videosContainer.innerHTML = '<span class="empty-state">Searching videos...</span>';
    const videos = await fetchVideos(query);

    if (videos.length > 0) {
        videosContainer.innerHTML = videos.map(vid => `
            <a class="video-link-card" href="${escapeHTML(vid.url)}">
                <div class="video-info">
                    <div class="video-name">▶ ${escapeHTML(vid.name)}</div>
                    <div class="video-url-text">${escapeHTML(vid.url)}</div>
                </div>
                <span class="video-play-pill">Open Video (${Math.round(vid.score * 100)}%)</span>
            </a>
        `).join('');
    } else {
        videosContainer.innerHTML = `<span class="empty-state">No matching videos found for "${escapeHTML(query)}".</span>`;
    }

    // 3. Render Images (URL iframe to image)
    const imagesContainer = document.getElementById('images-content');
    imagesContainer.innerHTML = '<span class="empty-state">Searching images...</span>';
    const images = await fetchImages(query);

    if (images.length > 0) {
        imagesContainer.innerHTML = images.map(img => `
            <div class="image-iframe-card">
                <iframe class="image-iframe-frame" src="${escapeHTML(img.url)}" title="${escapeHTML(img.name)}" loading="lazy"></iframe>
                <div class="image-iframe-footer">
                    <div class="image-iframe-title">${escapeHTML(img.name)} (${Math.round(img.score * 100)}%)</div>
                    <a class="image-iframe-link" href="${escapeHTML(img.url)}">${escapeHTML(img.url)}</a>
                </div>
            </div>
        `).join('');
    } else {
        imagesContainer.innerHTML = `<span class="empty-state">No matching images found for "${escapeHTML(query)}".</span>`;
    }

    // 4. Render Indexed Sites (Same-page redirect on click)
    const sitesContainer = document.getElementById('sites-content');
    sitesContainer.innerHTML = '<span class="empty-state">Searching indexed sites...</span>';
    const sites = await fetchIndexedSites(query);

    if (sites.length > 0) {
        if (fuzzyBanner.style.display === 'none' && sites[0]._score < 0.98) {
            fuzzyBanner.style.display = 'block';
            fuzzyBanner.innerHTML = `Showing closest fuzzy results for <strong>"${escapeHTML(query)}"</strong>.`;
        }

        sitesContainer.innerHTML = sites.map(site => {
            const targetUrl = site.url || '#';
            const lang = site.launguage || site.language || 'en';
            const metaTags = Array.isArray(site["meta tags"]) ? site["meta tags"] : [];
            const keywords = Array.isArray(site.keywords) ? site.keywords : [];
            const isPopular = site.popular === true || Number(site.popular) > 0;
            const matchPct = Math.round(site._score * 100);

            return `
                <div class="site-item" onclick="window.location.href='${escapeHTML(targetUrl)}'">
                    <div class="site-url">
                        <span>${escapeHTML(targetUrl)}</span>
                        <span class="meta-pill">Lang: ${escapeHTML(lang)}</span>
                        <span class="meta-pill">Match: ${matchPct}%</span>
                        ${isPopular ? `<span class="popular-badge">★ Popular (${escapeHTML(String(site.popular))})</span>` : ''}
                    </div>
                    <div class="site-title">${escapeHTML(site.title || 'Untitled Site')}</div>
                    <div class="site-desc">${escapeHTML(site.description || 'No description provided.')}</div>
                    <div class="site-meta">
                        ${keywords.map(k => `<span class="meta-pill">#${escapeHTML(k)}</span>`).join('')}
                        ${metaTags.map(m => `<span class="meta-pill">meta: ${escapeHTML(m)}</span>`).join('')}
                    </div>
                </div>
            `;
        }).join('');
    } else {
        sitesContainer.innerHTML = `<span class="empty-state">No close indexed sites found for "${escapeHTML(query)}".</span>`;
    }
}

        function filterSection(type, btnElement) {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btnElement.classList.add('active');

            const sections = {
                overview: document.getElementById('sec-overview'),
                videos: document.getElementById('sec-videos'),
                images: document.getElementById('sec-images'),
                sites: document.getElementById('sec-sites')
            };

            Object.entries(sections).forEach(([key, el]) => {
                el.style.display = (type === 'all' || type === key) ? 'block' : 'none';
            });
        }

        function resetHome() {
            mainContainer.classList.remove('has-results');
            resultsArea.style.display = 'none';
            fuzzyBanner.style.display = 'none';
            searchInput.value = '';
        }

        searchBtn.addEventListener('click', performSearch);
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') performSearch();
        });

        /* =====================================================================
           6. FULLSCREEN AI MODE & ai/API.js INTEGRATION
           ===================================================================== */
        const aiModeScreen = document.getElementById('ai-mode-screen');
        const openAiBtn = document.getElementById('open-ai-btn');
        const closeAiBtn = document.getElementById('close-ai-btn');
        const aiTextbox = document.getElementById('ai-textbox');
        const aiSendBtn = document.getElementById('ai-send-btn');
        const chatHistory = document.getElementById('chat-history');

        let conversationHistory = [];

        openAiBtn.addEventListener('click', () => {
            aiModeScreen.classList.add('active');
            if (searchInput.value.trim() && !aiTextbox.value.trim()) {
                aiTextbox.value = searchInput.value.trim();
            }
            aiTextbox.focus();
        });

        closeAiBtn.addEventListener('click', () => {
            aiModeScreen.classList.remove('active');
        });

        function appendChatMessage(role, text) {
            const msgDiv = document.createElement('div');
            msgDiv.className = `chat-msg ${role}`;
            msgDiv.textContent = text;
            chatHistory.appendChild(msgDiv);
            chatHistory.scrollTop = chatHistory.scrollHeight;
            return msgDiv;
        }

        async function sendToAI() {
            const userText = aiTextbox.value.trim();
            if (!userText) return;

            aiTextbox.value = '';
            appendChatMessage('user', userText);
            conversationHistory.push({ role: 'user', content: userText });

            const loadingBubble = appendChatMessage('ai', 'Thinking...');

            try {
                const response = await fetch('ai/API.js', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        prompt: userText,
                        history: conversationHistory
                    })
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const contentType = response.headers.get('content-type') || '';
                let replyText = '';

                if (contentType.includes('application/json')) {
                    const data = await response.json();
                    replyText = data.reply || data.response || data.answer || JSON.stringify(data);
                } else {
                    replyText = await response.text();
                }

                loadingBubble.textContent = replyText;
                conversationHistory.push({ role: 'assistant', content: replyText });

            } catch (err) {
                try {
                    const apiModule = await import('./ai/API.js');
                    if (typeof apiModule.askAI === 'function') {
                        const modReply = await apiModule.askAI(userText, conversationHistory);
                        loadingBubble.textContent = modReply;
                        conversationHistory.push({ role: 'assistant', content: modReply });
                        return;
                    }
                } catch (moduleErr) {
                    loadingBubble.textContent = `Error reaching ai/API.js: ${err.message}. Ensure your backend endpoint or ES module export askAI() is running.`;
                }
            }
        }

        aiSendBtn.addEventListener('click', sendToAI);
        aiTextbox.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') sendToAI();
        });

        function escapeHTML(str) {
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;')
                .replace(/`/g, '&#96;');
        }
