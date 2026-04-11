CHANGELOG:

v4.0.3 (PayPal Cleaner & Download Cleanup Bug Fixes)
Bug Fixes:
- The standalone launcher and packaged Mac wrapper now clear generated PayPal download caches on startup, restart, and normal quit so old cleaned exports and debug logs do not persist between runs.
- Reworked the PayPal cleaner so true two-row merchant hold/reversal pairs stay visible, while only clear multi-row PayPal duplicate scaffolding gets stripped out.
- Express Checkout Payment rows are now treated as externally funded, and matching same-timestamp PayPal funding/auth scaffolding is removed alongside them.
- Kept balance-aware duplicate cleanup for outbound friend payments and preapproved external funding rows without over-removing standalone PayPal ledger activity.

v4.0.2 (PayPal Cleaner Bug Fixes)
Bug Fixes:
- Added a more conservative PayPal cleanup engine that separates PayPal scaffolding rows from real ledger activity before exporting the master history.
- Expanded the PayPal debug export so removed rows now state the specific cleanup reason instead of collapsing into a generic duplicate/funding label.
- Fixed the PayPal cleaner dropping or keeping the wrong rows in authorization and funding chains, especially around debit card holds, paired funding legs, and same-timestamp merchant payment groups.
- Repaired newer PayPal CSV batch handling so standalone withdrawals, deposits, refunds, and payout rows survive cleaning while denied rows and obvious PayPal-only noise are stripped out.

v4.0.1 (Bug Fixes)
Bug Fixes: 
- Natively re-enabled the Version Selector dropdown directly inside the new standalone OS window framework, completely eliminating the need to use `server.py` in browsers just to downgrade.
- Programmed a brand new native Python loop wrapper strictly tracking the `active_version` architecture securely underneath the `.app` execution context without permanently altering standard launch capabilities.

v4.0.0 (Standalone Desktop Application Migration)
- Restructured the app to use Flask + PyWebView (Packaged via PyInstaller) on a minimal .app launcher (everything is cross-compatible between MacOS and Windows and a .exe or .bat will be added soon). The backend uses Python (Flask) to handle heavy CSV processing and API routes, while HTML/CSS handles the structural layout of the window, and JavaScript operates the frontend rendering and DOM manipulation natively via PyWebView.
- Made .gitignore and automatic cache deleting on exit safe enough for me to make this repo public while I work on it
- Reorganized file architecture so that the project folder has everything needed to be a standalone app.
- Removed some dead code
- The readme.md now holds the changelog, the changelog box now only shows the latest change, but has a button to show the full changelog (from the readme).

v3.4.9 (Bug Fixes)
Bug Fixes: Refactored the dual Pie Chart containers into a rigid CSS Grid (`grid-template-columns: 1fr 1fr`). This physically isolates the Titles, the custom HTML Legends, and the native Canvases into independent locking rows. Regardless of how many lines the legend wraps into on a single side, the CSS grid natively enforces the identical baseline starting height for the canvases beneath them, perfectly aligning the text, the legends, and the charts exactly.

v3.4.8 (Bug Fixes)
Bug Fixes: Completely disabled the native Chart.js pie legends in favor of dynamic HTML DOM legends securely placed above the canvases, guaranteeing identical chart radius dimensions. Refactored the zero-balance interpolation array to explicitly un-plot long horizontal zero strings leading up to an account's first interaction, anchoring only the single month prior to the first transaction and hiding the rest.

v3.4.7 (Bug Fixes)
Bug Fixes: Added strict flexbox center-align rules to the parallel Pie Chart canvas frames, natively anchoring their vertical dimensions identically to each other. Modified Net Worth chart logic to string together the initial boundaries of flat 0-balance months rather than breaking the line invisibly. Repaired paired transfer timestamp logic to compare day offsets natively without UTC distortion pushing the comparison off by a calendar day, returning the absolute latest completion time. Completely disabled the native Chart.js pie legends in favor of dynamic HTML DOM legends securely placed above the canvases, guaranteeing identical chart radius dimensions. Refactored the zero-balance interpolation array to explicitly un-plot long horizontal zero strings leading up to an account's first interaction, anchoring only the single month prior to the first transaction and hiding the rest.

v3.4.6 (Features & Bug Fixes)
Features: Created a 'Restart Server.command' shortcut to reboot the server and reopen Chrome in one click. Centralized project structure instructions into a root RULES.md file and relocated trailing command scripts and dummy data files into their respective folders. Revamped the CSV mapper Amount label.
Bug Fixes: Added a 0 value month before the first data point in the net worth graph to connect the dots. Repositioned pie chart categories directly under the titles to ensure consistent chart diameters. Updated transaction times to solid black text formatting and conditionally triggered display based solely on the newest date's timestamp while honoring time zone conversions. Refactored the zero-balance interpolation array to explicitly un-plot long horizontal zero strings leading up to an account's first interaction, anchoring only the single month prior to the first transaction and hiding the rest.

v3.4.5 (Features & Bug Fixes)
Features: Revamped the CSV Mapper UI to automatically detect Split Column mappings natively from multi-drop targets in the Amount box, suppressing deprecated radio button formats. Joined multi-column Description maps systematically via comma-separation. Re-centered the Pie Chart layout parameters replacing hardcoded dimension ratios with native fluid auto-scaling while dropping legends along the bottom boundary. Removed spacing gaps following the Ghost emoji prefixes applied dynamically internally, successfully allowing Ghost profiles to load directly within the native Color Picker array. Upgraded Transfer timestamp consolidations specifically ignoring midnight 00:00 fallbacks in favor of sub-day timestamps from overlapping counterpart legs chronologically.
Bug Fixes: Fixed the Net Worth graph tooltip dots rendering erroneously along empty bridge sequences.

v3.4.4 (Features & Bug Fixes)
Features: Merged the CSV mapper Date and Time endpoints into a unified multi-column dropzone that aggregates fragmented timestamp data automatically. The backend natively enforces all recorded transactional sequences into absolute EST timestamps out of the parser unconditionally. Ghost emojis `👻 ` are directly prepended to the actual name strings of internally generated synthetic ghost accounts, causing the UI to natively replicate the tag in tracking tables and picker dropdowns without hardcoded overrides. Extended global support so valid sub-day timestamp strings correctly populate the table for any generic expense independently of Transfer isolation rules.
Bug Fixes: Disabled the gradient basefill beneath the primary Total Net Worth line and restored specific tooltip nodes along perfectly flat segments bridging across gaps natively. Locked the dimension grid ratio bounding the dual Income & Expenses Pie Charts at a fixed scale to mitigate vertical layout scroll-shifting occurring during internal redrawing events. Corrected the grouped paired-transfer display logic to explicitly tag the visual date referencing the earliest ledger transaction, rather than the newer one.

v3.4.3 (Bug Fixes)
Bug Fixes: Fixed an issue where the Version Selector dropdown silently failed if the application was started via `python app.py` instead of the runner, and improved error messaging. Resolved an `OSError` bug that caused the CSV mapper to render entirely blank screens when uploading PayPal files on fresh clones. Instructed all line graphs to natively bridge across missing 0-value months natively, so the lines do not visually break. Dynamically colored "Transfers" explicitly blue within the Category Setup dropdown context. "Other" spending is now natively parsed into the appropriate Income/Expense pie charts based purely on its absolute value. Auto-categorized keyword text inside the Description column is now bolded inline exactly like transfer account names are. Addressed a bug that caused empty undefined dates to inherently fall back to 12:00 AM; these are explicitly blanked out now. Restructured the Unified Color layout container from a vertical column to a horizontal flex row to condense layout space.

v3.4.2 (Bug Fixes)
Bug Fixes: Resolved a critical 'ghostAccounts is not defined' ReferenceError that caused the loop to crash when clicking "Confirm Mappings". Upgraded the CSV mapper to accept and parse "Time" columns natively so the timeline resolution is accurately sub-day. Restored the dynamic Color Picker styling so Category selections default to green/red text, and reverted the Color Swatches back to the explicit vibrant palette from version 3.3.4.

v3.4.1 (Bug Fixes)
Bug Fixes: Fixed a severe syntax error that originated during the unified colors UI upgrade, which left a dangling code block outside of the function scope. This caused the app.js script to crash on page load, completely breaking the CSV file upload handlers and mapper UI.

v3.4.0 (Major Polish Update)
Features: Overhauled the user interface and functionality based on feedback. Moved the Tracked Ghost CSV downloads parallel to the PayPal download. Ghost accounts are now tagged inline within Transfer Rules with a slick orange badge. Net Worth and single-account graphs now intelligently hide 0 values and do not connect disconnected segments. Hover tooltips on graphs now auto-sort by highest balance and hide empty accounts. Income vs Expenses tooltips now show positive and negative breakdown simultaneously. Unified Color Picker: consolidated account and category swatches into a single mode-switching picker with dynamically colored dropdown texts. Transfer transaction descriptions seamlessly integrate assigned account colors. Time Column explicitly isolated to show accurate ledger completion times for paired transfers.

v3.3.4 (Bug Fixes)
Bug Fixes: Un-isolating a transaction now properly restores its auto-guessed category instead of defaulting to "Other". The isolate checkbox is now always unlocked for manually-linked ghost transfers so they can be unlinked (remains locked for auto-detected paired transfers). Un-isolating a manual ghost transfer now correctly clears its ghost transfer state.

v3.3.3 (Bug Squashing)
Bug Fixes: Ghost transfer dropdown now only appears when "Transfers" is selected as category (normal text otherwise). Fixed duplicate rows in ghost CSV download. Isolate checkbox stays unlocked for manually-linked transfers. Notes column now correctly maps from individual file headers instead of group-level headers.

v3.3.2 (Bug Fix)
Bug Fixes: Fixed critical startup bug where megaboard_data.json was missing from new version folders (PermissionError during cp -a clone), causing settings to fail to save and all CSV processing to return zero transactions.

v3.3.1 (Bug Squashing)
Bug Fixes: Ghost CSV download button now appears immediately after processing (no refresh needed). Downloadable ghost CSVs now show which non-ghost account is interacting with each transaction. Fixed non-ghost accounts incorrectly appearing in the Tracked Ghost CSVs list. Ghost CSV list now updates live without page refresh. "Apply Rules to Current Data" button no longer misleadingly says "Reload Required". Renamed graph title to "Accounts and Net Worth". Renamed "Balance Colors" to "Account Colors". Fixed color picker dropdown jumping to first account after saving a color. Added manual ghost transfer linking: isolate a row, select "Transfers" category, then pick the target account to lock it in as a real transfer. Notes column now correctly maps from CSV mapper settings.

v3.3.0 (Infrastructure & Version Management) — GitHub: https://github.com/BenzJamin4/Money-Megaboard
Features: Added a Version Switcher dropdown to the page title, allowing instant switching between all historical versions (v3.1.0 through v3.2.3). Built a top-level server.py launcher that dynamically loads any version's Flask app. Extracted the shared virtual environment from per-version folders into a single shared/venv/ directory (~1GB saved). Added one-click macOS Start Server and Stop Server .command files (Start opens Chrome automatically, Stop quits Chrome). Established Git safety with .gitignore and snapshot commits for full revertability. Updated the versioning workflow to reference the shared venv.

v3.2.3 (Architecture Polish & Bug Fixes)
Features: Ghost Download button is now actively attached to the file upload zone. Category and Balance Color selectors are compacted. Isolate-view allows targeting Ghost nodes visually. "Income (+)" and "Expenses (-)" drag targets.
Bug Fixes: Fixed auto-transfer matching casing logic (lowercasing strings silently in background instead of mutating data). Refactored "Notes" column physically to textarea elements, perfectly honoring multiline input formats.

v3.2.2 (Features & Fixes)
Features: Compacted Category/Balance Swatches into sleek dropdown combinations. Automatically linked Ghost transfers into the Balance Graph. Explicitly fixed Spending/Income colors for pie charts and categorized "Shopping" & "Entertainment" into Expense.
Bug Fixes: Completely rebuilt Notes CSV Parsing to respect inline quotes and natively render multiline fields. Fixed Ghost Transfer Table representation. Added Ghost CSV Downloads proxy feature.

v3.2.1 (Polish & Features)
Features: Upgraded the CSV Mapper UI to use native drag-and-drop instead of dropdown selects. Upgraded the Category Colors section to use 20 pre-defined sleek color swatches. Added dynamic color matching to the transaction table, turning keywords and account names into the assigned Category colors automatically. Changed the default auto-transfer window from 1 day to 3 days.

v3.2.0 (Features)
Features: Added Ghost CSV tracking to highlight transfer rules targeting unconnected external accounts. Introduced customizable Category Colors that apply to visual table highlights and charts. Expanded the Net Worth Graph to optionally show cumulative timelines for individual accounts alongside the master Net Worth line. Upgraded the CSV Mapper UI to accommodate multi-select for Notes concatenation and toggleable split Credit/Debit mappings vs unified Amount mappings. Layout tweaked to position PayPal download box in-line with the primary file dialog.

v3.1.3 (Bug Fixes)
Bug Fixes: Restored javascript backwards-compatibility for parsing standard CSVs that was lost during the batching upgrade. Properly formatted changelog history to distinguish Bug Fixes and Features.

v3.1.2 (Bug Fixes)
Bug Fixes: Reordered changelog to newest-first. Replaced native Clear Data confirm dialog with custom HTML modal to prevent browser auto-dismissal. Rewrote backend PayPal endpoint and JS to accept multiple CSV files simultaneously, stitching them into a unified Master History to prevent year overwriting. Fixed transfer auto-linker bug where default matching was skipped if custom rules are empty.

v3.1.1 (Bug Fixes)
Bug Fixes: Replaced browser NaN with Python fillna("") allowing Paypal uploads to correctly load without missing columns. Adding e.preventDefault() fixed the Clear Data button being instantly dismissed.

v3.1.0 (Features)
Features: Integrated pandas-powered PayPal endpoint to parse and clean raw PayPal activity exports natively. Output files are made available via unique download links.

v3.0.0 (Major)
Features: Complete rewrite to Python (Flask). Secure local JSON file persistence. Native Python datetime and CSV processing.

v2.3.1
Features: Upgraded category colors to be intensely vibrant with readable text shadows.
Bug Fixes: Fixed CSS !important overrides that were causing white-on-white buttons. Forced CSV upload text to black. Restored the Income/Expense split inside the table dropdowns. Fixed a bug where Pie Charts were missing certain categories.

v2.3.0 (Major)
Features: Enforced pure #000000 global CSS (killed all browser-default grey in inputs/graphs). Built a "Transfer Rules" UI for multi-day and keyword linking (specifically fixes PayPal transfer gaps). Cleaned the Account column to hide the (group) tags from the UI.
Bug Fixes: Restored all categories to Pie Charts with vibrant colors.

v2.2.3
Features: ZERO GREY policy enforced (all borders and text forced to black). Added (tag) grouping so uploaded files like name(fmfcu) map under "FMFCU". Removed Groceries and Investment categories to streamline options. Advanced PayPal sanitizer built to identify and remove duplicate "Shopping Cart Item" rows.
Bug Fixes: Fixed Pie Charts to strictly filter by their respective Income/Expense lists and appropriately size slices when refunds occur.

v2.2.2
Features: Made line and bar graphs much taller. Split the Pie Chart into two distinct charts: Spending (Expenses) and Income. Built-in PayPal CSV sanitizer started (automatically ignores pending/authorization rows).
Bug Fixes: Fixed category word matching using strict regex word boundaries. Forced a pure white background to kill remaining host-site grey bleed.

v2.2.1
Features: Removed grey container backgrounds for a cleaner look. Grouped split CSV column mappings (Name#1 + Name#2 share the Name mapping). Enlarged charts for better visibility. Stacked positive and negative bars below 0 on the Pos/Neg chart. Moved the Notes column to the far right of the table.
Bug Fixes: Kept account name case sensitivity intact. Fixed an overlapping category bug (e.g., "Applebee's" triggering the "Apple" category).

v2.2.0
Features: Split Income and Expense categories. Added new categories: Entertainment, Dividends, Clothes+Haircuts, and Health. Built an interactive CSV Column Mapping UI to handle non-standard bank exports. Added an editable "Notes" column to the transaction table.
Bug Fixes: Rewrote the CSV parser to perfectly handle commas inside quotes and empty cells. Fixed a bug with chart clicking navigation.

v2.1.0
Features: Renamed project to "Money Megaboard". Added localStorage memory to permanently remember custom dropdown categories and isolated items between sessions. Added a "Clear Saved Data" button.
Bug Fixes: Reverted CSV parsing logic due to a regression bug identified in v2.0.1.

v2.0.1
Features: Grouped split files on upload. Unmatched/unaccounted transfers now visually highlight in red.
Bug Fixes: Fixed negative number parsing to properly handle parentheses and minus signs.

v2.0.0 (Major)
Features: Redesign: Unlimited dynamic CSV uploads to replace the static checking/savings inputs. Interactive dropdown categories in the table for manual overrides. Isolate checkboxes introduced to prevent bulk category updates from affecting specific rows. Pie chart introduced. Unified transfer rows (visually consolidates linked transfers into a single line).

v1.1.0
Features: Split checking/savings inputs (added separate upload fields). Added a sticky header to the table. Basic transfer linking/detection between accounts. Added table sorting.

v1.0.0 (Original)
Features: Initial static checking and savings dashboard structure. CSV file uploading and parsing for standard bank columns (Date, Description, Amount, Debit/Credit, Balance). Automatic transaction categorization using hardcoded keyword matching. Transaction table displaying Date, Description, Amount, Category, and Account. Visual styling for the table, including colored amount text (red for negative, green for positive) and colored category badges. Interactive Monthly Net Worth line chart (via Chart.js). Interactive Category spending bar chart (via Chart.js). Clickable chart elements that smoothly scroll the page to the corresponding month in the transaction table, complete with a temporary yellow highlight animation.
