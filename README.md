# Anki Card Styling

[![Release](https://img.shields.io/badge/version-1.0.1-blue?style=flat-square)](https://github.com/leon-3/Obsidian-Anki-Card-Highlighting/releases)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](https://github.com/leon-3/Obsidian-Anki-Card-Highlighting/blob/main/LICENSE)
[![Obsidian](https://img.shields.io/badge/Obsidian-1.4.0%2B-informational?style=flat-square)](https://obsidian.md)
[![Obsidian Store](https://img.shields.io/badge/Obsidian-In--App%20Store-7c3aed?style=flat-square)](obsidian://show-plugin?id=anki-card-styling)
[![Webpage](https://img.shields.io/badge/Obsidian-Store%20Webpage-purple?style=flat-square)](https://community.obsidian.md/plugins/anki-card-styling)

Anki Card Styling gives your Anki flashcards clean visual formatting in Obsidian. It styles clozes, card types, extra question lines, and sync status directly in Live Preview and Reading View without modifying your underlying Markdown.

It is built for the flashcard syntax used by [Anki-VaultSync](https://github.com/leon-3/Anki-VaultSync) and [Markdown2Anki](https://github.com/leon-3/Markdown2Anki):
- [Anki Cloze Deletion](https://github.com/leon-3/Obsidian-Anki-Cloze): Companion plugin with hotkeys (`Ctrl+Shift+C` / `Ctrl+Alt+C`) to create card-scoped clozes quickly.
- [Anki-VaultSync](https://github.com/leon-3/Anki-VaultSync): Desktop add-on for direct sync between your vault and Anki without extra servers.
- [Markdown2Anki](https://github.com/leon-3/Markdown2Anki): Standalone command-line tool and compiler.

---

## Highlights & Key Features

- Visual clozes with click-to-edit: Renders `{{c1::answer}}` as styled badges and underlines. Clicking or moving your cursor inside immediately expands the raw text for editing.
- Card badges & question lines: Formats `Cloze` and `Image Cloze` headers into neat button badges, and highlights `EQL:` (Extra Question Line) prefixes as tag pills.
- Gutter status bars & card dimming: Shows green gutter bars for active cards (`ADDED:`) and red for deleted ones (`DELETED:`), with optional dimming for cards you are not currently editing.

---

## Installation & Quickstart

### Method 1: Obsidian Community Plugins
1. Open **Settings** > **Community plugins** in Obsidian.
2. Search for **Anki Card Styling** (or open [`obsidian://show-plugin?id=anki-card-styling`](obsidian://show-plugin?id=anki-card-styling)).
3. Click **Install**, then **Enable**.

### Method 2: Manual Installation
1. Download `main.js`, `manifest.json`, and `styles.css` from the latest [GitHub Release](https://github.com/leon-3/Obsidian-Anki-Card-Highlighting/releases).
2. Create `<Vault>/.obsidian/plugins/anki-card-styling/` in your vault.
3. Place the downloaded files inside.
4. Reload Obsidian plugins and turn on **Anki Card Styling**.

---

## Documentation

### Card Syntax within the Ecosystem
This plugin styles the card format used by [Anki-VaultSync](https://github.com/leon-3/Anki-VaultSync) and [Markdown2Anki](https://github.com/leon-3/Markdown2Anki). For sync details, deck routing, and configuration options, see the documentation in those repositories.

Cards are enclosed between `---` lines:

```markdown
---
ADDED: Cloze %%d4f8k2%%
Cellular respiration occurs in {{c1::mitochondria}}. The process generates {{c2::ATP}}.

---
Where does cellular respiration occur?
EQL: What energy currency is produced?
Cellular respiration occurs in mitochondria. The process generates ATP.

---
ADDED: Image Cloze %%o4fj5k3%%
![[Cell-Anatomy.png]]

---
DELETED: Old card to be removed %%b9x1n3%%
With old answer text

---
```

### Visual Formatting Reference

| Markdown Syntax | Rendered Visual Appearance |
| :--- | :--- |
| `{{c1::Hypertrophy}}` | Colored badge `<c1>` with underlined text `Hypertrophy` |
| `{{c2::Mitochondria}}` | Colored badge `<c2>` with underlined text `Mitochondria` |
| `Cloze` *(on line after `---`)* | Rounded button badge indicating a cloze card |
| `Image Cloze` *(on line after `---`)* | Rounded button badge indicating an image occlusion card |
| `EQL: Context prompt...` | Distinctive pill badge `EQL` followed by the context string |
| `ADDED: Card content...` | Green vertical status bar in the editor gutter |
| `DELETED: Obsolete content...` | Red vertical status bar in the editor gutter |

### Settings Reference
Options can be configured under **Settings** > **Community plugins** > **Anki Card Styling**:

| Setting | Default | Description |
| :--- | :---: | :--- |
| Cloze deletion highlighting | On | Formats `{{c1::...}}` as badges and underlines; reveals raw text on cursor focus. |
| Card status highlighting | On | Displays vertical side gutter bars (green for ADDED, red for DELETED). |
| Dim inactive cards | On | Subtly dims cards until hovered or selected. |
| Card type badge highlighting | On | Renders `Cloze` and `Image Cloze` on header lines as rounded badges. |
| Extra Question Line tag highlighting | On | Renders `EQL:` prefixes as styled pill tags. |
| Status bar card counter | On | Displays real-time card counts in Obsidian's status bar. |

---

## Development & Building

### Requirements
- Node.js 18+
- npm

### Building from Source
```bash
git clone https://github.com/leon-3/Obsidian-Anki-Card-Highlighting.git
cd Obsidian-Anki-Card-Highlighting
npm install
npm run build
```
