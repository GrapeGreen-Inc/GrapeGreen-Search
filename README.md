# GrapeGreen Search

**GrapeGreen Search** is a lightweight, fast, installable Progressive Web App (PWA) search engine powered by an automated headless web crawler (**GrapeGreenBot**).

---

## Features

* **Installable App (PWA):** Install directly to your desktop or mobile home screen from your browser for a standalone app experience with offline caching.
* **Fuzzy Search & Instant Redirects:** Typo-tolerant search matching across titles, keywords, and descriptions—click any result card to jump straight to the site.
* **Automated Headless Crawler (`GrapeGreenBot`):**
  * Renders modern JavaScript-heavy web pages cleanly.
  * Strictly obeys `robots.txt` rules and respects `Crawl-delay` directives (automatically skipping sites with unreasonable delays over `10.0s`).
  * Detects and skips CAPTCHA walls, `404`/`403` errors, and blocked resources.
  * Updates automatically every day at **12:00 PM** and **12:00 AM**.

---

## Install as an App (PWA)

1. Open **GrapeGreen Search** in Chrome, Edge, Brave, or Safari.
2. Click the **Install App** icon in your browser's address bar (or **Share → Add to Home Screen** on mobile).
3. Launch **GrapeGreen Search** anytime from your desktop, Start menu, or home screen.

---

## Content & Automated Indexing Disclaimer

**GrapeGreen Search** is an automated, independent web index operated by **GrapeGreen**. Search results, titles, and snippets are collected automatically by **GrapeGreenBot** from publicly accessible third-party websites that permit crawling via `robots.txt`.

* **No Hosting or Endorsement:** GrapeGreen does not host, own, control, or endorse the content of external third-party websites linked in search results.
* **Strict Family-Friendly & SafeSearch Policy:** GrapeGreen strictly prohibits sexually explicit, adult (NSFW), or unlawful material. While our crawler uses automated domain blocklists, RTA metadata checks, and keyword filters to prevent indexing explicit websites, automated discovery may occasionally encounter uncategorized pages.
* **Direct Removal & Reporting (Please Contact Us First):** If you encounter any explicit, inappropriate, or unauthorized link in our search index, **please report it directly to us first** rather than filing a third-party platform takedown request. Open a removal request issue in this repository (or contact the maintainer directly), and we will permanently delete the entry and add the domain to our blocklist immediately.

---

## Maintainers

* **GreatGamesGuy67** — Project Lead & Search/Crawler Architecture
* **Ethan / GrapeGreen (`@isan88438`)** — Core Developer
