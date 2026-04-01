import React from "react";

function QuoteBlock({ block, edit, onChange }) {
  if (!edit) {
    return (
      <blockquote className="page-quote">
        <p>{block.content}</p>
        {block.author && <cite>— {block.author}</cite>}
      </blockquote>
    );
  }

  return (
    <div className="page-quote-edit">
      <textarea
        className="page-textarea"
        value={block.content || ""}
        onChange={(e) => onChange({ content: e.target.value })}
        placeholder="Enter quote..."
        rows={3}
      />
      <input
        className="page-input"
        type="text"
        placeholder="Author (optional)"
        value={block.author || ""}
        onChange={(e) => onChange({ author: e.target.value })}
      />
    </div>
  );
}

export default QuoteBlock;
