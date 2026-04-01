import React, { useState } from "react";
import HeadingBlock from "./blocks/HeadingBlock";
import ParagraphBlock from "./blocks/ParagraphBlock";
import ImageBlock from "./blocks/ImageBlock";
import ListBlock from "./blocks/ListBlock";
import CodeBlock from "./blocks/CodeBlock";
import QuoteBlock from "./blocks/QuoteBlock";
import DividerBlock from "./blocks/DividerBlock";
import TableBlock from "./blocks/TableBlock";

const BLOCK_TYPES = [
  { type: "paragraph", label: "Paragraph" },
  { type: "heading", label: "Heading" },
  { type: "image", label: "Image" },
  { type: "list", label: "List" },
  { type: "code", label: "Code" },
  { type: "quote", label: "Quote" },
  { type: "divider", label: "Divider" },
  { type: "table", label: "Table" },
];

const BLOCK_MAP = {
  heading: HeadingBlock,
  paragraph: ParagraphBlock,
  image: ImageBlock,
  list: ListBlock,
  code: CodeBlock,
  quote: QuoteBlock,
  divider: DividerBlock,
  table: TableBlock,
};

function BlockRenderer({
  block,
  edit,
  onChange,
  onAddBlock,
  onDelete,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}) {
  const [showTypeMenu, setShowTypeMenu] = useState(false);
  const Component = BLOCK_MAP[block.type] || ParagraphBlock;

  const handleTypeChange = (newType) => {
    const defaults = {
      paragraph: { content: block.content || "" },
      heading: { content: block.content || "", level: 1 },
      image: { src: "", alt: "", caption: "" },
      list: { items: [""], ordered: false },
      code: { content: block.content || "", language: "" },
      quote: { content: block.content || "", author: "" },
      divider: {},
      table: { headers: ["Column 1", "Column 2"], rows: [["", ""]] },
    };
    onChange({ type: newType, ...defaults[newType] });
    setShowTypeMenu(false);
  };

  return (
    <div className="page-block">
      {edit && (
        <div className="page-block-toolbar">
          <div className="page-block-toolbar-left">
            <button
              className="page-block-toolbar-btn"
              onClick={() => setShowTypeMenu(!showTypeMenu)}
              title="Change block type"
            >
              &#9776;
            </button>
            {showTypeMenu && (
              <div className="page-block-type-menu">
                {BLOCK_TYPES.map((bt) => (
                  <button
                    key={bt.type}
                    className={`page-block-type-option ${
                      bt.type === block.type ? "page-block-type-option-active" : ""
                    }`}
                    onClick={() => handleTypeChange(bt.type)}
                  >
                    {bt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="page-block-toolbar-right">
            <button
              className="page-block-toolbar-btn"
              onClick={onMoveUp}
              disabled={isFirst}
              title="Move up"
            >
              &#8593;
            </button>
            <button
              className="page-block-toolbar-btn"
              onClick={onMoveDown}
              disabled={isLast}
              title="Move down"
            >
              &#8595;
            </button>
            <button className="page-block-toolbar-btn" onClick={onAddBlock} title="Add block below">
              +
            </button>
            <button
              className="page-block-toolbar-btn page-block-toolbar-btn-danger"
              onClick={onDelete}
              title="Delete block"
            >
              &times;
            </button>
          </div>
        </div>
      )}
      <div className="page-block-content">
        <Component block={block} edit={edit} onChange={onChange} />
      </div>
    </div>
  );
}

export default BlockRenderer;
