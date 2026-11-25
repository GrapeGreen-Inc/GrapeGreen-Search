import os
import re
import json
import time
import random
from collections import deque
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

TARGET_SITES = 300
OUTPUT_DIR = "indexed"
NAV_TIMEOUT_MS = 10000
SAVE_EVERY = 10
BOT_NAME = "GrapeGreenBot"
DEFAULT_CRAWL_DELAY = 0.3
MAX_CRAWL_DELAY = 10.0
SLOW_SERVER_THRESHOLD = 4.0

SEED_URLS = [
    "https://wikipedia.org",
    "https://ycombinator.com",
    "https://reddit.com",
    "https://bbc.com",
    "https://github.com"
]

BLOCKED_DOMAINS = {
    "t.co", "bit.ly", "goo.gl", "amzn.to", "doubleclick.net",
    "google-analytics.com", "facebook.com", "twitter.com", "x.com",
    "instagram.com", "linkedin.com", "://google.com"
}

GUEST_BUTTON_PATTERNS = re.compile(
    r"^(continue as guest|guest|browse as guest|enter as guest|skip|accept all|accept|got it)$",
    re.I
)

robots_cache = {}
domain_backoff = {}


def check_robots(url, user_agent=BOT_NAME):
    parsed = urlparse(url)
    base = f"{parsed.scheme}://{parsed.netloc}"
    if base not in robots_cache:
        rp = RobotFileParser()
        rp.set_url(f"{base}/robots.txt")
        try:
            rp.read()
        except Exception:
            rp = None
        robots_cache[base] = rp

    rp = robots_cache[base]
    if rp is None:
        return True, DEFAULT_CRAWL_DELAY

    if not rp.can_fetch(user_agent, url):
        return False, DEFAULT_CRAWL_DELAY

    try:
        delay = rp.crawl_delay(user_agent)
    except Exception:
        delay = None

    if delay is None:
        return True, DEFAULT_CRAWL_DELAY

    delay = float(delay)
    if delay > MAX_CRAWL_DELAY:
        return False, delay

    return True, max(DEFAULT_CRAWL_DELAY, delay)


def get_domain(url):
    domain = urlparse(url).netloc.lower()
    domain = domain.split(":")[0]  # Strip port if present
    return re.sub(r"^www\.", "", domain)


def get_clean_slug(url):
    """Turns 'https://hulu.shop' into 'hulu-shop' and 'https://hulu.com' into 'hulu-com'."""
    domain = get_domain(url)
    slug = re.sub(r"[^a-z0-9]+", "-", domain).strip("-")
    return slug or "site"


def save_manifest(manifest_files):
    with open(os.path.join(OUTPUT_DIR, "manifest.json"), "w", encoding="utf-8") as mf:
        json.dump(sorted(manifest_files), mf, indent=2)


def click_guest_or_dismiss_buttons(page):
    try:
        candidates = page.locator("button, a[role='button'], input[type='button'], input[type='submit']")
        count = min(candidates.count(), 40)
        for i in range(count):
            btn = candidates.nth(i)
            if not btn.is_visible():
                continue
            label = (btn.inner_text() or btn.get_attribute("value") or "").strip()
            if label and GUEST_BUTTON_PATTERNS.match(label):
                btn.click(timeout=2000)
                page.wait_for_timeout(1200)
                break
    except Exception:
        pass


def inspect_rendered_dom(page, base_url):
    return page.evaluate("""(baseUrl) => {
        function isElementVisible(el) {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            if (
                style.display === 'none' ||
                style.visibility === 'hidden' ||
                parseFloat(style.opacity) === 0
            ) {
                return false;
            }
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        }

        const visibleHrefs = [];
        document.querySelectorAll('a[href]').forEach(a => {
            if (!isElementVisible(a)) return;
            const rawHref = a.getAttribute('href');
            if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:') || rawHref.startsWith('mailto:')) {
                return;
            }
            try {
                visibleHrefs.push(new URL(rawHref, baseUrl).href);
            } catch (e) {}
        });

        const visibleTextParts = [];
        document.querySelectorAll('h1, h2, p').forEach(el => {
            if (isElementVisible(el)) {
                const txt = el.innerText.trim().replace(/\\s+/g, ' ');
                if (txt.length > 20 && txt.length < 300) {
                    visibleTextParts.push(txt);
                }
            }
        });

        const title = document.title ? document.title.trim() : '';
        const metaDescEl = document.querySelector('meta[name="description" i], meta[property="og:description" i]');
        const metaDesc = metaDescEl ? (metaDescEl.getAttribute('content') || '').trim() : '';

        const metaKwEl = document.querySelector('meta[name="keywords" i]');
        const metaKw = metaKwEl ? (metaKwEl.getAttribute('content') || '').trim() : '';

        const metaTags = [];
        document.querySelectorAll('meta').forEach(m => {
            const name = m.getAttribute('name') || m.getAttribute('property');
            if (name && !['viewport', 'charset'].includes(name.toLowerCase())) {
                const clean = name.toLowerCase().trim();
                if (!metaTags.includes(clean)) metaTags.push(clean);
            }
        });

        let logo = '';
        const ogImg = document.querySelector('meta[property="og:image" i]');
        const touchIcon = document.querySelector('link[rel*="apple-touch-icon" i]');
        const favIcon = document.querySelector('link[rel*="icon" i]');

        const rawLogo = (ogImg && ogImg.getAttribute('content')) ||
                        (touchIcon && touchIcon.getAttribute('href')) ||
                        (favIcon && favIcon.getAttribute('href')) || '';
        if (rawLogo) {
            try {
                logo = new URL(rawLogo.trim(), baseUrl).href;
            } catch (e) {}
        }

        const htmlLang = document.documentElement.getAttribute('lang') || 'en';

        return {
            title,
            metaDesc,
            metaKw,
            metaTags: metaTags.slice(0, 10),
            visibleText: visibleTextParts.slice(0, 5),
            visibleHrefs: Array.from(new Set(visibleHrefs)),
            logo,
            lang: htmlLang
        };
    }""", base_url)
def handle_http_status(response, domain, current_delay):
    if response is None:
        print(f"[SKIPPED - No response] {domain}")
        return False, current_delay

    status = response.status

    if status == 404 or status == 410:
        print(f"[SKIPPED - {status} Not Found] {response.url}")
        return False, current_delay

    if status in (429, 503):
        retry_after = response.headers.get("retry-after", "")
        if retry_after.isdigit():
            wait_sec = float(retry_after)
            if wait_sec > MAX_CRAWL_DELAY:
                print(f"[SKIPPED - {status} Retry-After {wait_sec}s > {MAX_CRAWL_DELAY}s] {domain}")
                return False, current_delay
            domain_backoff[domain] = max(current_delay, wait_sec)
            print(f"[BACKOFF - {status} on {domain}, waiting {wait_sec}s]")
            time.sleep(wait_sec)
        else:
            backoff_sec = min(MAX_CRAWL_DELAY, current_delay * 3)
            domain_backoff[domain] = backoff_sec
            print(f"[SKIPPED - {status} Rate Limited/Unavailable] {domain} (backoff set to {backoff_sec}s)")
        return False, domain_backoff.get(domain, current_delay)

    if status >= 400:
        print(f"[SKIPPED - HTTP {status}] {response.url}")
        return False, current_delay

    return True, current_delay


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    queue = deque(SEED_URLS)
    visited_domains = set()
    saved_count = 0

    manifest_files = set(
        fn for fn in os.listdir(OUTPUT_DIR)
        if fn.endswith(".json") and fn != "manifest.json"
    )

    print(f"Starting crawler for {TARGET_SITES} sites...\n")

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
        )
        context = browser.new_context(
            viewport={"width": 1280, "height": 800},
            user_agent=f"Mozilla/5.0 (compatible; {BOT_NAME}/1.0)"
        )
        page = context.new_page()

        page.route("**/*", lambda route: route.abort()
                   if route.request.resource_type in ("media", "font")
                   else route.continue_())

        try:
            while queue and saved_count < TARGET_SITES:
                url = queue.popleft()
                domain = get_domain(url)

                if not domain or domain in visited_domains or domain in BLOCKED_DOMAINS:
                    continue

                visited_domains.add(domain)

                allowed, delay = check_robots(url)
                delay = max(delay, domain_backoff.get(domain, 0))

                if not allowed or delay > MAX_CRAWL_DELAY:
                    reason = f"delay {delay}s > {MAX_CRAWL_DELAY}s" if delay > MAX_CRAWL_DELAY else "disallowed"
                    print(f"[SKIPPED - robots.txt ({reason})] {url}")
                    continue

                try:
                    start_time = time.monotonic()
                    response = page.goto(url, wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
                    load_time = time.monotonic() - start_time

                    ok, delay = handle_http_status(response, domain, delay)
                    if not ok:
                        continue

                    if load_time > SLOW_SERVER_THRESHOLD:
                        delay = min(MAX_CRAWL_DELAY, delay * 2)
                        domain_backoff[domain] = delay

                    page.wait_for_timeout(1500)
                    click_guest_or_dismiss_buttons(page)

                    final_url = page.url
                    final_domain = get_domain(final_url)
                    visited_domains.add(final_domain)

                    if final_url != url:
                        final_allowed, final_delay = check_robots(final_url)
                        if not final_allowed or final_delay > MAX_CRAWL_DELAY:
                            print(f"[SKIPPED - robots.txt] {final_url}")
                            continue
                        delay = max(delay, final_delay)

                    dom_info = inspect_rendered_dom(page, final_url)

                    discovered = []
                    for href in dom_info["visibleHrefs"]:
                        parsed = urlparse(href)
                        if parsed.scheme in ("http", "https") and parsed.netloc:
                            clean_href = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
                            if not clean_href.lower().endswith((".pdf", ".jpg", ".png", ".zip", ".mp4", ".svg")):
                                if get_domain(clean_href) not in visited_domains:
                                    discovered.append(clean_href)

                    random.shuffle(discovered)
                    for next_url in discovered[:25]:
                        queue.append(next_url)

                    slug = get_clean_slug(final_url)
                    root_name = final_domain.split(".")[0] if "." in final_domain else final_domain
                    title = dom_info["title"] or final_domain

                    description = dom_info["metaDesc"]
                    if not description and dom_info["visibleText"]:
                        description = dom_info["visibleText"][0]
                    if not description:
                        description = f"Explore {title} on {final_domain}."

                    keywords = []
                    for kw in [root_name, slug, final_domain]:
                        if kw and kw not in keywords:
                            keywords.append(kw)

                    if dom_info["metaKw"]:
                        for k in dom_info["metaKw"].split(","):
                            clean_k = k.strip().lower()
                            if clean_k and clean_k not in keywords:
                                keywords.append(clean_k)

                    lang = dom_info["lang"].split("-")[0].lower().strip() or "en"
                    parsed_final = urlparse(final_url)
                    logo_url = dom_info["logo"] or f"{parsed_final.scheme}://{parsed_final.netloc}/favicon.ico"

                    site_data = {
                        "title": title[:120],
                        "url": final_url,
                        "description": description[:300],
                        "keywords": keywords[:12],
                        "meta tags": dom_info["metaTags"],
                        "popular": random.randint(20, 85),
                        "launguage": lang,
                        "image": logo_url
                    }

                    filename = f"{slug}.json"
                    filepath = os.path.join(OUTPUT_DIR, filename)

                    existing = []
                    if os.path.exists(filepath):
                        try:
                            with open(filepath, "r", encoding="utf-8") as ef:
                                loaded = json.load(ef)
                                existing = loaded if isinstance(loaded, list) else [loaded]
                        except Exception:
                            existing = []

                    existing = [e for e in existing if e.get("url") != final_url]
                    existing.append(site_data)

                    with open(filepath, "w", encoding="utf-8") as out_f:
                        json.dump(existing, out_f, indent=2, ensure_ascii=False)

                    manifest_files.add(filename)
                    saved_count += 1
                    print(f"[{saved_count}/{TARGET_SITES}] Indexed: {final_domain} -> {filepath} (load: {load_time:.1f}s, wait: {delay}s)")

                    if saved_count % SAVE_EVERY == 0:
                        save_manifest(manifest_files)

                    time.sleep(delay)

                except PlaywrightTimeoutError:
                    print(f"[SKIPPED - Timeout > {NAV_TIMEOUT_MS // 1000}s] {url}")
                    continue
                except Exception:
                    continue
        finally:
            save_manifest(manifest_files)
            browser.close()

    print(f"\nDone! Saved {saved_count} sites and updated '{OUTPUT_DIR}/manifest.json'.")


if __name__ == "__main__":
    main()
