import React from "react";

function ImageBlock({ block, edit, onChange }) {
  if (!edit) {
    return (
      <figure className="page-image">
        {block.src ? (
          <img src={block.src} alt={block.alt || ""} />
        ) : (
          <div className="page-image-placeholder">No image</div>
        )}
        {block.caption && <figcaption>{block.caption}</figcaption>}
      </figure>
    );
  }

  return (
    <div className="page-image-edit">
      <input
        className="page-input"
        type="text"
        placeholder="Image URL"
        value={block.src || ""}
        onChange={(e) => onChange({ src: e.target.value })}
      />
      <input
        className="page-input"
        type="text"
        placeholder="Alt text"
        value={block.alt || ""}
        onChange={(e) => onChange({ alt: e.target.value })}
      />
      <input
        className="page-input"
        type="text"
        placeholder="Caption (optional)"
        value={block.caption || ""}
        onChange={(e) => onChange({ caption: e.target.value })}
      />
      {block.src && (
        <figure className="page-image">
          <img src={block.src} alt={block.alt || ""} />
        </figure>
      )}
    </div>
  );
}

export default ImageBlock;
