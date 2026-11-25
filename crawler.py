import os
import re
import json
import random
from collections import deque
from urllib.parse import urlparse, urljoin
import requests
from bs4 import BeautifulSoup

# Settings
TARGET_SITES = 300
OUTPUT_DIR = "indexed"
TIMEOUT = 8

# Starting seed pages (rich in external links so it branches out to 300+ unique sites)
SEED_URLS = [
    "https://wikipedia.org",
    "https://ycombinator.com",
    "https://reddit.com",
    "https://bbc.com",
    "https://github.com"
]

# Skip social login walls, trackers, or file downloads
BLOCKED_DOMAINS = {
    "t.co", "bit.ly", "goo.gl", "amzn.to", "doubleclick.net",
    "google-analytics.com", "facebook.com", "twitter.com", "x.com",
    "instagram.com", "linkedin.com", "://google.com"
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; GrapeGreenSpider/1.0)"
}


def get_domain(url):
    domain = urlparse(url).netloc.lower()
    return re.sub(r"^www\.", "", domain)


def get_clean_slug(url):
    domain = get_domain(url)
    name = domain.split(".")[0]
    return re.sub(r"[^a-z0-9_-]", "_", name) or "site"


def extract_logo(soup, base_url):
    og_img = soup.find("meta", property="og:image")
    if og_img and og_img.get("content"):
        return urljoin(base_url, og_img["content"].strip())

    for rel_type in ["apple-touch-icon", "icon", "shortcut icon"]:
        icon_link = soup.find("link", rel=lambda r: r and rel_type in " ".join(r).lower())
        if icon_link and icon_link.get("href"):
            return urljoin(base_url, icon_link["href"].strip())

    parsed = urlparse(base_url)
    return f"{parsed.scheme}://{parsed.netloc}/favicon.ico"


def extract_external_links(soup, base_url):
    """Finds all outgoing http/https links on the page to keep crawling."""
    links = set()
    for a in soup.find_all("a", href=True):
        href = urljoin(base_url, a["href"].strip())
        parsed = urlparse(href)
        if parsed.scheme in ("http", "https") and parsed.netloc:
            # Strip query strings/fragments to keep clean root/page URLs
            clean_url = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
            if not clean_url.lower().endswith((".pdf", ".jpg", ".png", ".zip", ".mp4", ".svg")):
                links.add(clean_url)
    return list(links)


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    queue = deque(SEED_URLS)
    visited_domains = set()
    saved_count = 0

    manifest_files = set(
        fn for fn in os.listdir(OUTPUT_DIR)
        if fn.endswith(".json") and fn != "manifest.json"
    )

    print(f"Starting spider to index {TARGET_SITES} unique sites...\n")

    while queue and saved_count < TARGET_SITES:
        url = queue.popleft()
        domain = get_domain(url)

        if not domain or domain in visited_domains or domain in BLOCKED_DOMAINS:
            continue

        visited_domains.add(domain)

        try:
            res = requests.get(url, headers=HEADERS, timeout=TIMEOUT, allow_redirects=True)
            if "text/html" not in res.headers.get("Content-Type", ""):
                continue
            res.raise_for_status()

            final_domain = get_domain(res.url)
            visited_domains.add(final_domain)

            soup = BeautifulSoup(res.text, "html.parser")

            # Discover new links and shuffle them so the crawl stays random
            discovered = extract_external_links(soup, res.url)
            random.shuffle(discovered)
            for next_url in discovered[:25]:  # Grab up to 25 random links per page
                if get_domain(next_url) not in visited_domains:
                    queue.append(next_url)

            # Extract Title
            title = soup.title.string.strip() if (soup.title and soup.title.string) else ""
            if not title:
                og_title = soup.find("meta", property="og:title")
                title = og_title["content"].strip() if (og_title and og_title.get("content")) else final_domain

            # Extract Description
            desc_tag = soup.find("meta", attrs={"name": re.compile(r"^description$", re.I)}) or \
                       soup.find("meta", property="og:description")
            description = desc_tag["content"].strip() if (desc_tag and desc_tag.get("content")) else ""

            # Extract Keywords + Slug
            slug = get_clean_slug(res.url)
            keywords = [slug]
            kw_tag = soup.find("meta", attrs={"name": re.compile(r"^keywords$", re.I)})
            if kw_tag and kw_tag.get("content"):
                for k in kw_tag["content"].split(","):
                    clean_k = k.strip().lower()
                    if clean_k and clean_k not in keywords:
                        keywords.append(clean_k)

            # Extract Meta Tags
            meta_tags = []
            for m in soup.find_all("meta"):
                tag_name = m.get("name") or m.get("property")
                if tag_name and tag_name.lower() not in ("viewport", "charset"):
                    clean_tag = tag_name.lower().strip()
                    if clean_tag not in meta_tags:
                        meta_tags.append(clean_tag)

            # Extract Language & Logo
            html_tag = soup.find("html")
            lang = html_tag["lang"].split("-")[0].lower().strip() if (html_tag and html_tag.get("lang")) else "en"
            logo_url = extract_logo(soup, res.url)

            site_data = {
                "title": title[:120],
                "url": res.url,
                "description": description[:300] if description else f"Explore {title} on {final_domain}.",
                "keywords": keywords[:12],
                "meta tags": meta_tags[:10],
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

            existing = [e for e in existing if e.get("url") != res.url]
            existing.append(site_data)

            with open(filepath, "w", encoding="utf-8") as out_f:
                json.dump(existing, out_f, indent=2, ensure_ascii=False)

            manifest_files.add(filename)
            saved_count += 1
            print(f"[{saved_count}/{TARGET_SITES}] Indexed: {final_domain} -> {filepath}")

        except Exception:
            # Silently skip sites that block bots or time out and keep crawling
            continue

    # Save updated manifest.json
    with open(os.path.join(OUTPUT_DIR, "manifest.json"), "w", encoding="utf-8") as mf:
        json.dump(sorted(manifest_files), mf, indent=2)

    print(f"\nFinished! Indexed {saved_count} random sites into '{OUTPUT_DIR}/'.")


if __name__ == "__main__":
    main()
