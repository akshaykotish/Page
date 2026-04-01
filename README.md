# Page

A React component for rendering and editing content page by page with **auto-pagination**. Content automatically flows across page containers based on real page dimensions (A4, Letter, etc.) — when a page fills up, remaining content breaks into the next page.

## Installation

```bash
npm install @anthropic/page
```

## Quick Start

```jsx
import { Page } from "@anthropic/page";
import "@anthropic/page/dist/page.css";

const data = {
  pages: [
    {
      id: "page-1",
      blocks: [
        { id: "b1", type: "heading", content: "Hello World", level: 1 },
        { id: "b2", type: "paragraph", content: "This is a paragraph of text." },
      ],
    },
  ],
};

// Read-only mode
<Page data={data} edit={false} />

// Editor mode
<Page data={data} edit={true} onChange={(updated) => console.log(updated)} />
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `data` | `object` | required | Content data with `pages` array containing `blocks` |
| `edit` | `boolean` | `false` | Enable editing mode |
| `onChange` | `function` | — | Callback fired with updated data on every edit |
| `layout` | `"grid" \| "tabs"` | `"grid"` | `grid` shows all pages vertically, `tabs` shows one at a time |
| `pageSize` | `string` | `"A4"` | Page dimensions — `A4`, `A3`, `Letter`, `Legal`, `Tabloid`, `A5` |
| `padding` | `object` | `{ top: 60, bottom: 60, left: 48, right: 48 }` | Container padding in pixels |
| `className` | `string` | `""` | Additional CSS class for the root element |

## Page Sizes

| Size | Dimensions | Pixels (96 DPI) |
|------|-----------|-----------------|
| A4 | 210 × 297 mm | 794 × 1123 |
| A3 | 297 × 420 mm | 1123 × 1587 |
| US Letter | 8.5 × 11 in | 816 × 1056 |
| US Legal | 8.5 × 14 in | 816 × 1344 |
| Tabloid | 11 × 17 in | 1056 × 1632 |
| A5 | 148 × 210 mm | 559 × 794 |

## Auto-Pagination

All blocks from the input data are treated as a single content stream. The component:

1. Measures each block's rendered height
2. Fills each page container up to `pageHeight - paddingTop - paddingBottom - headerHeight`
3. When a page is full, remaining blocks flow into the next container
4. Changing the page size or padding re-flows content automatically

```
┌─────────────────────────────┐
│       padding-top            │
│  ┌───────────────────────┐  │
│  │  PAGE 1               │  │
│  ├───────────────────────┤  │
│  │                       │  │
│  │  Content (auto height │  │
│  │  up to max allowed)   │  │
│  │                       │  │
│  └───────────────────────┘  │
│       padding-bottom         │
└─────────────────────────────┘

┌─────────────────────────────┐
│       padding-top            │
│  ┌───────────────────────┐  │
│  │  PAGE 2               │  │
│  ├───────────────────────┤  │
│  │                       │  │
│  │  Overflow content     │  │
│  │  continues here...    │  │
│  │                       │  │
│  └───────────────────────┘  │
│       padding-bottom         │
└─────────────────────────────┘
```

## Block Types

### Heading
```js
{ id: "1", type: "heading", content: "Title", level: 1 }
```
Levels 1–6 supported. In edit mode, a dropdown selects the heading level.

### Paragraph
```js
{ id: "2", type: "paragraph", content: "Some text here." }
```

### Image
```js
{ id: "3", type: "image", src: "https://example.com/photo.jpg", alt: "Description", caption: "Optional caption" }
```

### List
```js
{ id: "4", type: "list", items: ["First item", "Second item"], ordered: false }
```
Set `ordered: true` for numbered lists.

### Code
```js
{ id: "5", type: "code", content: "console.log('hello')", language: "javascript" }
```

### Quote
```js
{ id: "6", type: "quote", content: "To be or not to be.", author: "Shakespeare" }
```

### Divider
```js
{ id: "7", type: "divider" }
```

### Table
```js
{ id: "8", type: "table", headers: ["Name", "Age"], rows: [["Alice", "30"], ["Bob", "25"]] }
```

## Edit Mode Features

When `edit={true}`:

- **Inline editing** — click any text to edit directly
- **Block toolbar** — hover a block to reveal controls (appears on hover)
- **Change block type** — hamburger menu to convert between block types
- **Reorder** — move blocks up/down with arrow buttons
- **Add/Delete** — add new blocks below or remove existing ones
- **Page size dropdown** — switch page dimensions and watch content re-flow

## Running the Demo

```bash
git clone https://github.com/akshaykotish/Page.git
cd Page
npm install
npm run build
node demo/server.js
```

Open **http://127.0.0.1:9999** in your browser. Click "Edit Mode" to toggle editing.

## Building

```bash
npm run build
```

Outputs to `dist/`:
- `index.js` — CommonJS bundle
- `index.esm.js` — ES module bundle
- `page.css` — Stylesheet

## License

[MIT](LICENSE)
