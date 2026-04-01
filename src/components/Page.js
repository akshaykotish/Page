import React, { useState, useCallback, useLayoutEffect, useRef, useMemo } from "react";
import BlockRenderer from "./BlockRenderer";
import "../styles/page.css";

const PAGE_SIZES = {
  A4: { width: 794, height: 1123, label: "A4 (210 × 297 mm)" },
  A3: { width: 1123, height: 1587, label: "A3 (297 × 420 mm)" },
  Letter: { width: 816, height: 1056, label: "US Letter (8.5 × 11 in)" },
  Legal: { width: 816, height: 1344, label: "US Legal (8.5 × 14 in)" },
  Tabloid: { width: 1056, height: 1632, label: "Tabloid (11 × 17 in)" },
  A5: { width: 559, height: 794, label: "A5 (148 × 210 mm)" },
};

const DEFAULT_PADDING = { top: 60, bottom: 60, left: 48, right: 48 };
const PAGE_HEADER_HEIGHT = 48; // header height + margin-bottom

function Page({
  data,
  edit = false,
  onChange,
  className = "",
  layout = "grid",
  pageSize: initialPageSize = "A4",
  padding: paddingProp,
}) {
  // Flatten all input blocks into a single stream
  const [allBlocks, setAllBlocks] = useState(() => {
    if (!data?.pages) return [];
    return data.pages.flatMap((p) => p.blocks || []);
  });
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [blockHeights, setBlockHeights] = useState(null);
  const measureRef = useRef(null);
  const prevHeightsKey = useRef(null);

  const pad = { ...DEFAULT_PADDING, ...paddingProp };
  const size = PAGE_SIZES[pageSize] || PAGE_SIZES.A4;
  const contentMaxHeight = size.height - pad.top - pad.bottom - PAGE_HEADER_HEIGHT;
  const contentWidth = size.width - pad.left - pad.right;

  // Measure each block's rendered height in a hidden container
  useLayoutEffect(() => {
    if (!measureRef.current) return;
    const els = Array.from(measureRef.current.children);
    const heights = els.map((el) => el.getBoundingClientRect().height);
    const key = heights.join(",");
    if (prevHeightsKey.current !== key) {
      prevHeightsKey.current = key;
      setBlockHeights(heights);
    }
  });

  // Distribute blocks across visual pages based on measured heights
  const visualPages = useMemo(() => {
    if (!blockHeights || blockHeights.length !== allBlocks.length) {
      return [{ blocks: [...allBlocks], startIndex: 0 }];
    }
    const pages = [];
    let currentBlocks = [];
    let currentHeight = 0;
    let startIndex = 0;

    for (let i = 0; i < allBlocks.length; i++) {
      const bh = blockHeights[i];
      if (currentHeight + bh > contentMaxHeight && currentBlocks.length > 0) {
        pages.push({ blocks: currentBlocks, startIndex });
        startIndex = i;
        currentBlocks = [allBlocks[i]];
        currentHeight = bh;
      } else {
        currentBlocks.push(allBlocks[i]);
        currentHeight += bh;
      }
    }
    if (currentBlocks.length > 0) {
      pages.push({ blocks: currentBlocks, startIndex });
    }
    return pages.length > 0 ? pages : [{ blocks: [], startIndex: 0 }];
  }, [allBlocks, blockHeights, contentMaxHeight]);

  // --- Edit handlers operate on the flat allBlocks array ---
  const emitChange = useCallback(
    (blocks) => {
      if (onChange) onChange({ blocks });
    },
    [onChange]
  );

  const handleBlockChange = useCallback(
    (globalIndex, updatedBlock) => {
      setAllBlocks((prev) => {
        const next = prev.map((b, i) =>
          i === globalIndex ? { ...b, ...updatedBlock } : b
        );
        emitChange(next);
        return next;
      });
    },
    [emitChange]
  );

  const handleAddBlock = useCallback(
    (afterGlobalIndex) => {
      setAllBlocks((prev) => {
        const next = [...prev];
        next.splice(afterGlobalIndex + 1, 0, {
          id: `block-${Date.now()}`,
          type: "paragraph",
          content: "",
        });
        emitChange(next);
        return next;
      });
    },
    [emitChange]
  );

  const handleDeleteBlock = useCallback(
    (globalIndex) => {
      setAllBlocks((prev) => {
        const next = prev.filter((_, i) => i !== globalIndex);
        emitChange(next);
        return next;
      });
    },
    [emitChange]
  );

  const handleMoveBlock = useCallback(
    (globalIndex, direction) => {
      setAllBlocks((prev) => {
        const target = globalIndex + direction;
        if (target < 0 || target >= prev.length) return prev;
        const next = [...prev];
        [next[globalIndex], next[target]] = [next[target], next[globalIndex]];
        emitChange(next);
        return next;
      });
    },
    [emitChange]
  );

  // --- Render ---

  if (!allBlocks.length && !edit) {
    return (
      <div className={`page-container ${className}`}>
        <div className="page-empty">
          <p>No content to display.</p>
        </div>
      </div>
    );
  }

  if (layout === "grid") {
    const gridStyle = {
      "--page-width": `${size.width}px`,
      "--page-height": `${size.height}px`,
    };

    return (
      <div className={`page-container page-container-grid ${className}`}>
        <div className="page-size-bar">
          <label>Page Size:</label>
          <select
            className="page-size-select"
            value={pageSize}
            onChange={(e) => setPageSize(e.target.value)}
          >
            {Object.entries(PAGE_SIZES).map(([key, val]) => (
              <option key={key} value={key}>
                {val.label}
              </option>
            ))}
          </select>
          <span className="page-size-hint">
            {size.width} x {size.height} px
          </span>
        </div>

        {/* Hidden measuring container — same width as content area */}
        <div
          ref={measureRef}
          aria-hidden="true"
          className="page-measure-container"
          style={{ width: `${contentWidth}px` }}
        >
          {allBlocks.map((block) => (
            <BlockRenderer
              key={block.id}
              block={block}
              edit={false}
              onChange={() => {}}
              onAddBlock={() => {}}
              onDelete={() => {}}
              onMoveUp={() => {}}
              onMoveDown={() => {}}
              isFirst={true}
              isLast={true}
            />
          ))}
        </div>

        {/* Rendered pages — padding on the container */}
        <div className="page-grid" style={gridStyle}>
          {visualPages.map((vp, pageIndex) => (
            <div
              className="page-paper"
              key={pageIndex}
              style={{
                padding: `${pad.top}px ${pad.right}px ${pad.bottom}px ${pad.left}px`,
              }}
            >
              <div className="page-paper-header">
                <span className="page-paper-label">Page {pageIndex + 1}</span>
              </div>
              <div className="page-content-area">
                {vp.blocks.map((block, bi) => {
                  const globalIndex = vp.startIndex + bi;
                  return (
                    <BlockRenderer
                      key={block.id}
                      block={block}
                      edit={edit}
                      onChange={(u) => handleBlockChange(globalIndex, u)}
                      onAddBlock={() => handleAddBlock(globalIndex)}
                      onDelete={() => handleDeleteBlock(globalIndex)}
                      onMoveUp={() => handleMoveBlock(globalIndex, -1)}
                      onMoveDown={() => handleMoveBlock(globalIndex, 1)}
                      isFirst={globalIndex === 0}
                      isLast={globalIndex === allBlocks.length - 1}
                    />
                  );
                })}
                {edit && vp.blocks.length === 0 && (
                  <div
                    className="page-block-empty"
                    onClick={() =>
                      handleAddBlock(vp.startIndex > 0 ? vp.startIndex - 1 : -1)
                    }
                  >
                    Click to add a block
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="page-footer">
          {visualPages.length} page{visualPages.length !== 1 ? "s" : ""}
        </div>
      </div>
    );
  }

  // --- TABS LAYOUT (fallback, no auto-pagination) ---
  return (
    <div className={`page-container ${className}`}>
      <div className="page-content">
        <div className="page-paper">
          {allBlocks.map((block, bi) => (
            <BlockRenderer
              key={block.id}
              block={block}
              edit={edit}
              onChange={(u) => handleBlockChange(bi, u)}
              onAddBlock={() => handleAddBlock(bi)}
              onDelete={() => handleDeleteBlock(bi)}
              onMoveUp={() => handleMoveBlock(bi, -1)}
              onMoveDown={() => handleMoveBlock(bi, 1)}
              isFirst={bi === 0}
              isLast={bi === allBlocks.length - 1}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default Page;
