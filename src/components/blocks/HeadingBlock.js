import React from "react";

function HeadingBlock({ block, edit, onChange }) {
  const Tag = `h${block.level || 1}`;

  if (!edit) {
    return <Tag className="page-heading">{block.content}</Tag>;
  }

  return (
    <div className="page-heading-edit">
      <select
        className="page-heading-level-select"
        value={block.level || 1}
        onChange={(e) => onChange({ level: parseInt(e.target.value, 10) })}
      >
        <option value={1}>H1</option>
        <option value={2}>H2</option>
        <option value={3}>H3</option>
        <option value={4}>H4</option>
        <option value={5}>H5</option>
        <option value={6}>H6</option>
      </select>
      <Tag
        className="page-heading page-editable"
        contentEditable
        suppressContentEditableWarning
        onBlur={(e) => onChange({ content: e.target.innerText })}
      >
        {block.content}
      </Tag>
    </div>
  );
}

export default HeadingBlock;
