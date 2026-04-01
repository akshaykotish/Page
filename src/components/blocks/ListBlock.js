import React from "react";

function ListBlock({ block, edit, onChange }) {
  const items = block.items || [""];
  const Tag = block.ordered ? "ol" : "ul";

  if (!edit) {
    return (
      <Tag className="page-list">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </Tag>
    );
  }

  const handleItemChange = (index, value) => {
    const next = [...items];
    next[index] = value;
    onChange({ items: next });
  };

  const handleAddItem = () => {
    onChange({ items: [...items, ""] });
  };

  const handleRemoveItem = (index) => {
    if (items.length <= 1) return;
    onChange({ items: items.filter((_, i) => i !== index) });
  };

  const handleKeyDown = (e, index) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const next = [...items];
      next.splice(index + 1, 0, "");
      onChange({ items: next });
    }
    if (e.key === "Backspace" && items[index] === "" && items.length > 1) {
      e.preventDefault();
      handleRemoveItem(index);
    }
  };

  return (
    <div className="page-list-edit">
      <label className="page-list-toggle">
        <input
          type="checkbox"
          checked={block.ordered || false}
          onChange={(e) => onChange({ ordered: e.target.checked })}
        />
        Ordered list
      </label>
      {items.map((item, i) => (
        <div key={i} className="page-list-item-edit">
          <span className="page-list-bullet">{block.ordered ? `${i + 1}.` : "•"}</span>
          <input
            className="page-input page-list-input"
            value={item}
            onChange={(e) => handleItemChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, i)}
            placeholder="List item..."
          />
          {items.length > 1 && (
            <button className="page-block-toolbar-btn page-block-toolbar-btn-danger" onClick={() => handleRemoveItem(i)}>
              &times;
            </button>
          )}
        </div>
      ))}
      <button className="page-btn page-btn-small" onClick={handleAddItem}>
        + Add item
      </button>
    </div>
  );
}

export default ListBlock;
