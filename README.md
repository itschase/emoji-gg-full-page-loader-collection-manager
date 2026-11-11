# Emoji.gg Universal Full Page Loader

Load complete Emoji.gg profiles, emoji searches, and sticker searches without repeatedly waiting for or pressing **Load more**.

I created this userscript because I wanted to browse a profile's full selection of emojis without the delay and practical limitations of Emoji.gg's incremental loading. I also wanted searching for emojis and stickers to be less tedious: one request should be enough to expand the current listing instead of repeatedly scrolling, waiting, and pressing **Load more**.

The script keeps normal browsing lightweight. Profile pages load automatically, while the homepage and emoji or sticker listings only perform a full load when you explicitly request it.

## What it looks like

### Emoji and sticker listings

![The Load full page control on an Emoji.gg listing](assets/listing-loader.png)

### User profiles

![Parallel profile loading with cancel and resume controls](assets/profile-loader.png)

## Features

- Works with any public Emoji.gg profile at `/user/<username>`.
- Reads the active profile's Emoji count for progress reporting without trusting that badge as proof that loading is finished.
- Loads profiles in continuous 500-item cycles using Emoji.gg's live bottom-of-page and **Load more** behavior.
- Performs repeated bottom-of-page checks after the fast pass so late or native lazy-loaded items are not missed.
- Refuses to report a profile as complete while an actionable **Load more** button remains.
- Removes duplicate cards introduced when the site's native loader overlaps with the faster loader.
- Adds an opt-in **Load full page** control to:
  - the Emoji.gg homepage;
  - `/emojis` and `/emojis/<tag>` pages;
  - `/stickers` and `/stickers/<tag>` pages.
  - `/category` and `/category/<name>` pages.
- Repeatedly finds and activates Emoji.gg's own **Load more** control until the listing stops growing.
- Lets you pause a running load and start it again later.
- Returns to the top after a confirmed complete load.
- Does not continuously refresh pages or automatically expand normal search and discovery pages.
- Runs entirely in your browser and does not send browsing data to another service.

## How it works

### Profiles

Opening a supported profile starts the loader automatically. It repeatedly reaches the current bottom, activates a newly available **Load more** control, waits for new cards, filters duplicate item IDs, and continues in 500-item progress cycles. The profile badge is displayed as useful progress context, but it is not treated as proof that loading is complete. Completion requires three consecutive bottom checks that add no cards **and** leave no actionable **Load more** control. If the control reappears during any check, the three-check counter resets and loading continues. This prevents the script from returning to the top while Emoji.gg still has another section available.

The profile panel provides:

- **Cancel loading** — pauses the current operation and preserves what has already loaded.
- **Resume / restart** — continues loading after a pause or recoverable error.

### Homepage, emoji listings, and sticker listings

These pages are not expanded automatically. The panel displays **Load full page** so ordinary browsing remains quick and memory-conscious.

When selected, the script performs a one-time refresh, scrolls to the listing controls, repeatedly activates the site's **Load more** button, waits for new cards, removes duplicates, and continues until three consecutive checks find no additional results. The active operation can be paused; pressing **Load full page** again starts another continuation pass.

## Installation

### Install directly from GitHub (recommended)

1. Install [Tampermonkey](https://www.tampermonkey.net/) or another compatible userscript manager.
2. Open the [raw userscript](https://raw.githubusercontent.com/itschase/emoji-gg-universal-full-page-loader/main/emoji-gg-universal-full-page-loader.user.js).
3. Accept the userscript manager's installation prompt.
4. Visit [Emoji.gg](https://emoji.gg/).

The userscript's `@updateURL` and `@downloadURL` both point directly to that GitHub-hosted `.js` file, so installations made from the raw GitHub link check GitHub for future updates.

If you previously installed the script from Greasy Fork, install it once from the raw GitHub link above so the userscript manager records GitHub as the update source. The script name and namespace remain the same, allowing the direct installation to replace the existing copy in compatible userscript managers.

### Greasy Fork listing

The script also has a [Greasy Fork page](https://greasyfork.org/en/scripts/604578-emoji-gg-universal-full-page-loader), but the direct GitHub installation is recommended when you want updates from this repository.

## Supported routes

| Page | Behavior |
| --- | --- |
| `/user/<username>` | Automatically loads the complete profile and verifies the end. |
| `/` | Displays an opt-in one-time full-page loader. |
| `/emojis` | Displays an opt-in one-time full-page loader. |
| `/emojis/<tag>` | Displays an opt-in one-time full-page loader for that listing. |
| `/stickers` | Displays an opt-in one-time full-page loader. |
| `/stickers/<tag>` | Displays an opt-in one-time full-page loader for that listing. |
| `/category` | Displays an opt-in one-time full-page loader. |
| `/category/<name>` | Displays an opt-in one-time full-page loader for that category. |

The script intentionally does nothing on submission, account, marketplace, and unrelated Emoji.gg pages.

## Resource usage

Loading hundreds or thousands of cards at once can use considerably more memory than Emoji.gg's default incremental view. The listing loader therefore remains opt-in. Use **Cancel loading** or **Stop full load** if a page becomes too heavy for your browser.

## Compatibility

The script targets modern Chromium- and Firefox-based browsers with a current userscript manager. It relies on modern browser features including `fetch`, `AbortController`, `DOMParser`, optional chaining, and the CSS `:has()` selector.

## Troubleshooting

- If loading pauses after a network error, use **Resume / restart**.
- If Emoji.gg temporarily stops responding, use **Resume / restart** to continue from the cards already loaded; the script will not report completion while **Load more** is still available.
- If a listing has changed since the last pass, press **Load full page** again.
- If Emoji.gg changes its card or pagination markup, please open an issue with the affected URL and browser version.

## Privacy and permissions

The userscript runs only on `https://emoji.gg/*`. It uses the active Emoji.gg session solely to request pages from Emoji.gg itself. It does not collect analytics, transmit profile data elsewhere, or use third-party APIs.

## Contributing

Bug reports and focused improvements are welcome through [GitHub Issues](https://github.com/itschase/emoji-gg-universal-full-page-loader/issues). Please describe the affected route, expected result, actual result, and browser/userscript-manager versions.

## License

Released under the [MIT License](LICENSE).
