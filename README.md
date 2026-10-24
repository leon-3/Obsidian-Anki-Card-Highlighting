# Anki Card Styling

[![GitHub Release](https://img.shields.io/github/v/release/leon-3/Obsidian-Anki-Card-Highlighting?style=flat-square&color=7c3aed)](https://github.com/leon-3/Obsidian-Anki-Card-Highlighting/releases)
[![Obsidian Min Version](https://img.shields.io/badge/Obsidian-1.4.0%2B-5b21b6?style=flat-square)](https://obsidian.md)

Anki Card Styling provides clean, native visual formatting for Anki flashcards directly in Obsidian. It automatically styles clozes, card type indicators, question line tags, and card synchronization states in both Live Preview and Reading View without breaking raw Markdown compatibility.

---

## Visual Overview

| Markdown Source | Rendered in Live Preview & Reading View |
| :--- | :--- |
| `{{c1::Hypertrophy}}` | <kbd>c1</kbd> <u>Hypertrophy</u> |
| `{{c2::Mitochondria::Powerhouse}}` | <kbd>c2</kbd> <u>Mitochondria</u> *(Powerhouse)* |
| `Cloze` *(after `---`)* | <kbd>Cloze</kbd> button badge |
| `Image Cloze` *(after `---`)* | <kbd>Image Cloze</kbd> button badge |
| `EQL: P(A\|B) = ...` | <kbd>EQL</kbd> `P(A\|B) = ...` tag badge |
| `ADDED: Card content...` | Green status gutter bar alongside the card |
| `DELETED: Obsolete card...` | Red status gutter bar alongside the card |

---

## Features

- **Interactive Cloze Deletions**
  - Renders raw `{{c1::answer}}` and `{{c1::answer::hint}}` as styled pill badges with colored underlines.
  - **Click-to-Edit**: Moving the cursor inside a cloze reveals the raw syntax for instant editing.
  - Supports custom identifiers (such as `{{c1::...}}` or `{{01::...}}`).
  - Safely ignores cloze syntax inside inline and block LaTeX math (`$...$` and `$$...$$`).

- **Card Type & Header Badges**
  - Automatically formats `Cloze` and `Image Cloze` on card header lines into rounded button badges.
  - Formats `EQL:` (Extra Question Line) prefixes into distinct pill tags.
  - Automatically collapses back to editable text when focused.

- **Real-Time Status Gutter Bars (ADDED / DELETED)**
  - Displays a continuous vertical status bar in the editor gutter:
    - **Green** for cards prefixed with `ADDED:` (active or synced cards).
    - **Red** for cards prefixed with `DELETED:` (or `DELTED:`) (flagged for removal).
  - Aligns with multi-line math blocks, wrapped text, and custom widgets without scrolling drift.

- **Smart Focus Dimming**
  - Inactive cards can be subtly dimmed (~62% opacity) to eliminate visual noise and keep focus on the card currently being edited.
  - Restores to 100% opacity whenever hovering with the mouse or placing the cursor inside the card block.
  - Can be toggled on or off in settings.

- **Status Bar Card Counter**
  - Displays live card counts in Obsidian's status bar (e.g. `Anki: 5 cards (4 added, 1 deleted)`).
  - Can be toggled on or off in settings.

- **Universal Markdown Support**
  - Works seamlessly across both Live Preview and Reading View.
  - Respects standard Markdown thematic breaks (`---`, `___`, `***`).
  - Automatically ignores YAML frontmatter and fenced code blocks.

---

## Syntax & Card Structure

Cards are separated by standard Markdown horizontal rules (`---`). Status tags and card types are placed right after the divider:

```markdown
---
Cloze
ADDED: What is the main driver of muscle protein synthesis?
EQL: Resistance training and adequate protein intake.
The primary mechanism is {{c1::mechanical tension}} signaling through {{c2::mTORC1::signaling pathway}}.
---
DELETED: Old obsolete definition %%card-id-1234%%
This card has been flagged for deletion during the next sync.
---
Image Cloze
ADDED: Identify the indicated structure:
![[Brain-Anatomy.png]]
---
Standard note content continues here outside card blocks...
```

---

## Settings

Settings can be customized under **Settings > Community plugins > Anki Card Styling**:

| Setting | Default | Description |
| :--- | :---: | :--- |
| **Cloze deletion highlighting** | On | Formats `{{c1::...}}` as pill badges and underlines; reveals raw syntax on cursor focus. |
| **Card status highlighting** | On | Displays vertical side gutter bars (green for ADDED, red for DELETED). |
| **Dim inactive cards** | On | Subtly dims inactive cards until hovered or selected. |
| **Card type badge highlighting** | On | Renders `Cloze` and `Image Cloze` on header lines as rounded badges. |
| **Extra Question Line tag highlighting** | On | Renders `EQL:` prefixes as styled pill tags. |
| **Status bar card counter** | On | Displays real-time card counts in Obsidian's bottom status bar. |

---

## Installation

### From Obsidian Community Plugins (Recommended)

1. Open **Settings > Community plugins** in Obsidian.
2. Turn off **Restricted mode** if enabled.
3. Click **Browse** and search for **Anki Card Styling**.
4. Click **Install**, then **Enable**.

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest [GitHub Release](https://github.com/leon-3/Obsidian-Anki-Card-Highlighting/releases).
2. Create a folder named `anki-card-styling` in your vault's plugin directory:
   ```
   <Vault>/.obsidian/plugins/anki-card-styling/
   ```
3. Copy `main.js`, `manifest.json`, and `styles.css` into that folder.
4. Reload Obsidian (`Ctrl+R` / `Cmd+R`) and enable **Anki Card Styling** in **Settings > Community plugins**.

### Building from Source

```bash
git clone https://github.com/leon-3/Obsidian-Anki-Card-Highlighting.git
cd Obsidian-Anki-Card-Highlighting
npm install
npm run build
```
