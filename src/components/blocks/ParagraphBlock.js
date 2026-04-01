import React from "react";

function ParagraphBlock({ block, edit, onChange }) {
  if (!edit) {
    return <p className="page-paragraph">{block.content}</p>;
  }

  return (
    <p
      className="page-paragraph page-editable"
      contentEditable
      suppressContentEditableWarning
      onBlur={(e) => onChange({ content: e.target.innerText })}
      data-placeholder="Type something..."
    >
      {block.content}
    </p>
  );
}

export default ParagraphBlock;
