# Emoji.gg Full Page Loader & Collection Manager

**Load more of Emoji.gg with less waiting—and turn your loaded page into a convenient workspace for creating collections.**

This userscript adds fast, optional full-page loading to Emoji.gg profiles, emoji and sticker listings, searches, and categories. A compact collection manager lets you preview selections, remove individual items, open pack submission in another tab, and start the next collection without refreshing your browsing page.

**Release: 1.1.0 · License: MIT · Author: Chase (itschase)**

[Install from Greasy Fork](https://greasyfork.org/en/scripts/604991-emoji-gg-full-page-loader-collection-manager) · [Source on GitHub](https://github.com/itschase/emoji-gg-full-page-loader-collection-manager) · [Report an issue](https://github.com/itschase/emoji-gg-full-page-loader-collection-manager/issues)

This is a userscript, so it requires the [Tampermonkey browser extension](https://www.tampermonkey.net/) or another compatible userscript manager. Tampermonkey is the recommended option.

## Purpose

Emoji.gg loads assets incrementally, which can interrupt browsing and make large collections time-consuming to assemble. This userscript provides optional full-page loading and a compact collection manager so users can explore complete profiles and listings, select assets, and prepare multiple packs efficiently.

The loader continues through available results rather than relying solely on the site's displayed count. Collection tools synchronize selections across tabs and clear successfully submitted items, allowing the loaded browsing page to remain useful for the next pack.

## Screenshots

### Continuous profile loading

![Profile loading progress with parallel page requests, visible and reported counts, and Cancel loading](https://raw.githubusercontent.com/itschase/emoji-gg-full-page-loader-collection-manager/main/assets/profile-loading-1.0.png)

The loader shows which pages are being requested, how many items are visible, and the profile's reported count. **Cancel loading** preserves results already loaded.

### Compact loader and collection manager

![Widget showing Load full page, collection count, image previews, Clear collection, and Submit collection](https://raw.githubusercontent.com/itschase/emoji-gg-full-page-loader-collection-manager/main/assets/collection-widget-1.0.png)

Loading and collection controls share a small, translucent black panel with subdued buttons and consistent SVG icons. Collection controls appear only when you have selected items. Click the collection heading to expand previews; hover over a preview to reveal its remove button.

## Fast full-page loading

### Keep the widget out of the way

Click **›** in the panel's top-right corner to minimize it into a small tab at the right edge. Click **‹** to reopen the tools. The script remembers this choice across page visits and synchronizes it between open Emoji.gg tabs. Minimizing preserves your collection and does not stop a running load; reopen the panel to view progress or cancel loading.

- **Opt-in profiles:** click **Load full profile** on a public `/user/<username>` page when you want everything available.
- **Large parallel batches:** requests 20 profile pages together, normally up to 500 items per batch, then immediately continues with subsequent batches.
- **Counts are context:** the profile badge may lag behind newly published uploads. Loading continues beyond that count when additional items are returned.
- **End verification:** after reaching the apparent end, three empty checks of the next real profile page confirm completion. New results resume loading.
- **Listings and searches:** the homepage, emoji and sticker listings, tag searches, and categories use the site's loading controls to retrieve more results automatically during a requested full load.
- **Results-first layout:** full listing loads hide the entire supplemental area after the results grid, related-tag rows, and the site footer. Loading controls remain available. Stopping the load restores the hidden content.
- **Duplicate protection:** repeated cards are filtered when the native site loader overlaps with the userscript.
- **Cancel and continue:** pause profile loading while retaining loaded items, then use the load control to continue.
- **Resume without resetting:** pausing a listing and continuing no longer reloads or clears items already shown.
- **Background progress:** loader timing remains responsive when the tab loses focus, while normal computer sleep still pauses work.
- **Back to the top:** confirmed completion returns you to the beginning of the loaded page.
- **You decide when:** profiles and listings do not expand automatically on a normal visit.

### Loading a profile

1. Open a public Emoji.gg profile.
2. Select **Load full profile**.
3. Follow progress while pages are fetched and merged into the existing grid.
4. Use **Cancel loading** to pause. Loaded items remain visible.
5. Select **Load full profile** again to continue after a pause or connection error.

Results arrive in page order, with duplicate item IDs omitted. The profile's stated count is displayed only as context. The loader keeps checking returned pages to determine the actual end. Running it again after completion starts another pass so newly available items can be found.

### Loading the homepage, searches, stickers, and categories

Select **Load full page**. The current listing receives a one-time refresh, then the script scrolls to the bottom, finds and activates **Load more**, waits for new cards, removes duplicates, and repeats until three checks find no additional items.

Use **Stop full load** to pause; currently visible items remain. Selecting **Load full page** again continues from the current page without refreshing it. The initial full-load request still uses one refresh to establish a clean listing session. The script does not continuously refresh pages or automatically expand future normal visits.

## Collection manager

- **Visible when needed:** the collection section stays hidden until items have been selected.
- **Live count:** see the current selection against the site's 32-item pack limit.
- **Compact previews:** shows the first five selected images and the number of additional items.
- **Expand or collapse:** click the collection heading to browse all selected images in a scrollable panel.
- **Remove one item:** hover over its preview and click **×**. Keyboard focus also reveals the button; touchscreens show it continuously.
- **Clear collection:** reset the temporary selection from any Emoji.gg tab while preserving the loaded page.
- **Export ZIP:** download the current selection from the widget, including collections larger than the 32-item submission limit.
- **Submit in a new tab:** open the pack form without navigating away from your profile or listing. This action is disabled above 32 selected items.
- **Submit Collection (beta):** open Emoji.gg's native pack form in a centered dialog on the current page. Its tag suggestions, validation, and success messages work inside the dialog. Close it to return to your loaded results; reopening preserves the form. After a successful submission, close the dialog; your next collection opens a fresh form.
- **Synchronize tabs:** saved selections, counts, previews, and selected card indicators stay synchronized between participating Emoji.gg tabs in the same browser profile.
- **Clear after success:** only confirmed successful pack submissions remove submitted items. Failed submissions retain their selection.
- **Keep new work:** unrelated items added while a submission is pending remain available for the next pack.

### Create multiple packs from one loaded page

1. Load the profile or listing you want to browse.
2. Add emojis using Emoji.gg's normal collection buttons.
3. Review the count and previews. Expand the heading to inspect the full selection.
4. Hover over a preview and click **×** to remove unwanted items. Other tabs and selected indicators update too.
5. Select **Submit collection** to open the pack form in a new tab, or **Submit Collection (beta)** to use the centered dialog in the same tab.
6. Fill in the title, tags, and description, review the pack, and submit it yourself.
7. Wait for Emoji.gg's successful-submission confirmation. Submitted items clear from shared storage and cached selections across participating tabs.
8. Return to the original loaded page and select the next pack. No profile reload is needed for this collection cycle.

**Clear collection** also allows a manual reset. Removing a temporary selection does not delete an uploaded emoji or an already submitted pack. The script manages the workflow; it does not write pack metadata, submit packs automatically, or bypass submission limits and moderation.

### How collection synchronization works

Emoji.gg stores the collection in browser storage and caches another copy in each open tab. Changing storage alone is not enough: an older page can otherwise restore its stale copy when another item is selected.

The script refreshes that cached state before the site's add, remove, and submit handlers run. Browser storage events and a live cross-tab channel synchronize changes. Focus checks and a lightweight periodic fallback cover delayed initialization. Synchronization does not replace or navigate away from the loaded profile grid.

Automatic clearing listens for a confirmed successful `/api/submit/pack` response and uses the IDs actually sent in that request. A button click, timeout, or redirect alone never counts as success. If the request fails, the collection remains. If additional unrelated items were selected while it was pending, those remain for the next pack.

## Requirements and installation

The script does not run as a standalone browser extension. Install a userscript manager first:

1. Install [Tampermonkey](https://www.tampermonkey.net/) for your browser. Follow Tampermonkey's link to the appropriate Chrome, Edge, Firefox, Safari, or Opera extension store.
2. Open the [Emoji.gg Full Page Loader & Collection Manager page on Greasy Fork](https://greasyfork.org/en/scripts/604991-emoji-gg-full-page-loader-collection-manager).
3. Select **Install this script**.
4. Tampermonkey opens an installation screen showing the script's source and permissions. Review it, then select **Install**.
5. Visit or reload [Emoji.gg](https://emoji.gg/). The compact loader appears on supported profile and listing pages. Collection controls appear after you select an emoji.

The script runs only on `https://emoji.gg/*`. It uses `@grant none`, adds no external analytics, and works through the page and browser features described in this README.

### Using the script

- On a profile, select **Load full profile** to retrieve the available profile pages in large batches.
- On the homepage, emoji listings, sticker listings, searches, or categories, select **Load full page** to continue activating the site's results until the end is confirmed.
- Use **Cancel loading** or **Stop full load** to pause without discarding results already loaded. Select the load button again to continue.
- Add items with Emoji.gg's normal collection button. The widget then shows the count, previews, ZIP export, clear, and pack-submission controls.
- Use **›** to minimize the widget to the right edge and **‹** to reopen it. The preference is remembered.

## Supported pages

| Page | Loading | Collection controls |
| --- | --- | --- |
| `/user/<username>` | Load full profile | Visible when selected items exist |
| `/` | Load full page | Visible when selected items exist |
| `/emojis` and `/emojis/<tag>` | Load full page | Visible when selected items exist |
| `/stickers` and `/stickers/<tag>` | Load full page | Visible when selected items exist |
| `/category` and subpages | Load full page | Visible when selected items exist |
| `/submit/pack` | No loading control | Previews, removal, clear, and submission-result synchronization |
| Other `https://emoji.gg/*` pages | No loading control | Visible when selected items exist |

## Troubleshooting

- **No widget:** loading controls appear only on supported profiles and listings. Other pages show collection tools only when items are selected. Check that the script is enabled.
- **A profile pauses after a connection error:** select **Load full profile** again to retry from the next unfinished batch.
- **Reported and loaded counts differ:** profile badges can be stale. Actual returned pages determine the end.
- **A listing seems incomplete:** run **Load full page** again. Temporary server responses affect available results.
- **Another tab still shows old selections:** ensure it runs this script and focus it. Tabs opened before an update need one reload to use the new code.
- **Two widgets appear:** disable the old script or another duplicate installation and reload once.
- **Submit collection is disabled:** reduce the selection to 32 items or fewer.
- **Submission failed:** review Emoji.gg's message and correct the pack. Selections remain available for another attempt.

## Performance and compatibility

Loading hundreds or thousands of image cards uses more memory than Emoji.gg's initial view. Full loading stays optional; cancel if the page becomes too heavy. Parallel requests reduce waiting, but actual speed depends on the server, connection, and browser.


## Privacy

The script adds no analytics and does not send inventories, selections, or browsing history to an external service. Loading requests go to Emoji.gg with your existing session. Previews use Emoji.gg's image CDN. Collection data stays in the site's browser storage and synchronizes between participating tabs. Your userscript manager separately checks its configured source for updates.

## Feedback and contributions

Open a [GitHub issue](https://github.com/itschase/emoji-gg-full-page-loader-collection-manager/issues) with the affected page, expected and actual behavior, browser, userscript manager, and script version. Never include passwords or session cookies. Focused improvements to loading reliability, collection workflows, accessibility, and the compact widget are welcome.

## License

Released under the [MIT License](https://github.com/itschase/emoji-gg-full-page-loader-collection-manager/blob/main/LICENSE).
