import React from "react";

function CodeBlock({ block, edit, onChange }) {
  if (!edit) {
    return (
      <pre className="page-code">
        {block.language && <div className="page-code-lang">{block.language}</div>}
        <code>{block.content}</code>
      </pre>
    );
  }

  return (
    <div className="page-code-edit">
      <input
        className="page-input"
        type="text"
        placeholder="Language (e.g. javascript)"
        value={block.language || ""}
        onChange={(e) => onChange({ language: e.target.value })}
      />
      <textarea
        className="page-textarea page-code-textarea"
        value={block.content || ""}
        onChange={(e) => onChange({ content: e.target.value })}
        placeholder="Write your code here..."
        rows={6}
        spellCheck={false}
      />
    </div>
  );
}

export default CodeBlock;
