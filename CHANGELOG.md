# Changelog

## 1.2.8 — 2026-11-12

- Speed up full-page loading outside profiles by fetching eight listing pages concurrently when Emoji.gg provides pagination links.
- Remove the unnecessary wait for a Load more button on scroll-driven listings and avoid the initial reload for parallel loads.
- Preserve page order, duplicate protection, and pause/resume behavior; retain the site's native loading path for layouts without page links.

## 1.2.7 — 2026-11-12

- Extend the black theme to the hero search header, active submission tabs, promotional badges, and listing previews on asset detail pages.
- Increment the userscript version so installed copies receive these theme fixes.

## 1.2.6 — 2026-11-12

- Remove repeated profile cards that Emoji.gg appends after a completed full-profile load.
- Keep the profile's native pagination control from returning during a running or completed full load.
- Match the profile header to the uniform black dark-mode background.

## 1.2.5 — 2026-11-12

- Make page, navigation, result cards, and form surfaces uniformly black in dark mode. Keep action buttons slightly lighter.
- Increase contrast for the add-to-collection action, including its icon and hover state.
- Use neutral dark buttons instead of blue accents in dark mode, and clarify the unwanted-content setting.

## 1.2.4 — 2026-11-12

- Make the optional darker styling fully black with borderless asset cards, while keeping card metadata, forms, and navigation legible.
- Check full-page loading on several live result types alongside the listing cleanup and persistent footer controls.

## 1.2.3 — 2026-11-12

- Move Settings to a small gear beside the collection status and open its controls above the widget.
- Add a persistent control for hiding supplemental page content and the footer, independent of full-page loading.
- Remove marketplace cards, tool promotions, and the homepage feature promotion from listings on initial display and as new results arrive.
- Refine the optional darker palette with subtler surfaces and borders while retaining the site's primary accents.
- Expand route and interaction regression coverage for homepage, emoji and sticker searches, categories, packs, profile pages, and submission pages.

## 1.2.2 — 2026-11-12

- Add full-page loading to `/packs` and pack search listings.
- Keep card actions visible while building a collection, with an optional setting to restore hover behavior.
- Open asset links in a new tab at click time, avoiding a full-page rewrite of loaded cards.
- Extend the optional darker palette to navigation, footer, offcanvas, and form areas.
- Document pack routes and settings and collapse the supported-pages table.
- Verify route detection, repeated-page completion, promotion removal after dynamic loading, collection links, and settings with focused regression checks.

## 1.2.1 — 2026-11-12

- Correct profile pagination URLs and end detection when a page repeats already loaded items.
- Add parallel loading for public profile pack pages.
- Remove marketplace product cards from emoji and sticker result grids.
- Add top and bottom navigation controls on long pages.
- Open asset detail links in new tabs during collection building; add a setting to hide View buttons.
- Add optional darker site styling, disabled by default.
- Organize feature details and secondary documentation into expandable README sections.

## 1.2 — 2026-11-12

- Display paused loading status and the resume instruction on separate lines.
- Apply the same layout to profile cancellation and recoverable profile errors.
- Add a consolidated release history.

### Improvements since the previous GitHub release (1.0.3)

- Same-tab collection submission through a centered dialog using Emoji.gg's native form, tag suggestions, validation, and success messages.
- Preserved unfinished dialog drafts when closing and reopening; fresh forms after successful submissions.
- Expanded full-load cleanup across homepage, emoji, sticker, tag, and category layouts, including the site footer and elements styled with flex utilities.
- Restored original visibility and display styles when cancelling a listing load.
- Refined widget layout, remembered minimizer, SVG icons, darker action buttons, and hover hints distinguishing submission destinations.
- Prevented accidental text selection in the widget and dialog header while preserving editable form fields.
- Updated installation and usage documentation, screenshots, and an expandable gallery showing widget states.

## 1.1.1 — 2026-11-12

- Disable text selection in widget controls and the dialog header.
- Replace the submission dialog screenshot and add loading and paused-state screenshots.

## 1.1.0 — 2026-11-12

- Add SVG icons to Clear collection, Export ZIP, and both submission buttons.
- Darken action buttons and make the beta submission action a regular button.
- Rewrite the purpose section and simplify documentation around installation and everyday usage.
- Add a main widget preview and expandable screenshot gallery.

## 1.0.8 — 2026-11-12

- Stack the same-tab beta action below the normal submission button.
- Add hover hints describing same-tab and new-tab submission.

## 1.0.7 — 2026-11-12

- Enforce hidden supplementary sections against the site's flex display utilities.
- Preserve original display styles for restoration after cancellation.

## 1.0.6 — 2026-11-12

- Hide the full trailing listing area and site footer during full loads.
- Preserve pagination and asset cards.

## 1.0.5 — 2026-11-12

- Extend homepage cleanup to tools and emoji meanings rows.

## 1.0.4 — 2026-11-12

- Add Submit Collection (beta), opening the native pack form in a centered dialog.
- Preserve drafts on reopening, protect against repeated submission clicks, and reset the dialog after success.
- Broaden cleanup to related-tag rows and listing information sections.
- Replace minimize/reopen text symbols with SVG chevrons.
- Rename the widget to EMOJI.GG Loader & Collection Manager and remove redundant loading instructions.

## 1.0.3 — 2026-11-11

- Hide the informational section below listing results during full loads.
- Restore it when loading is cancelled.
- Publish the first GitHub release with an installable userscript asset.

## 1.0.2 — 2026-11-11

- Resume listing loads without refreshing or discarding loaded results.
- React to new cards using mutation detection and improve background timer responsiveness.
- Add collection ZIP export, including selections above the 32-item submission limit.

## 1.0.1 — 2026-11-11

- Add a right-edge minimize/reopen control with a remembered preference synchronized across tabs.

## 1.0 — 2026-11-11

- Introduce the renamed Full Page Loader & Collection Manager.
- Provide optional profile loading in parallel batches and automated listing continuation with duplicate protection and end checks.
- Support profile, homepage, emoji, sticker, tag, and category browsing.
- Add synchronized collection counts, compact and expanded previews, individual removal, clearing, and new-tab submission.
- Clear only successfully submitted items while retaining failed submissions and unrelated additions.
- Provide installation instructions and a public Greasy Fork listing.
