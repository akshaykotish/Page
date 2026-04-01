import React from "react";

function TableBlock({ block, edit, onChange }) {
  const headers = block.headers || ["Column 1", "Column 2"];
  const rows = block.rows || [["", ""]];

  if (!edit) {
    return (
      <div className="page-table-wrapper">
        <table className="page-table">
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const handleHeaderChange = (index, value) => {
    const next = [...headers];
    next[index] = value;
    onChange({ headers: next });
  };

  const handleCellChange = (rowIndex, colIndex, value) => {
    const next = rows.map((row, ri) =>
      ri === rowIndex ? row.map((cell, ci) => (ci === colIndex ? value : cell)) : row
    );
    onChange({ rows: next });
  };

  const addColumn = () => {
    onChange({
      headers: [...headers, `Column ${headers.length + 1}`],
      rows: rows.map((row) => [...row, ""]),
    });
  };

  const removeColumn = (index) => {
    if (headers.length <= 1) return;
    onChange({
      headers: headers.filter((_, i) => i !== index),
      rows: rows.map((row) => row.filter((_, i) => i !== index)),
    });
  };

  const addRow = () => {
    onChange({ rows: [...rows, headers.map(() => "")] });
  };

  const removeRow = (index) => {
    if (rows.length <= 1) return;
    onChange({ rows: rows.filter((_, ri) => ri !== index) });
  };

  return (
    <div className="page-table-edit">
      <div className="page-table-wrapper">
        <table className="page-table">
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i}>
                  <input
                    className="page-table-input"
                    value={h}
                    onChange={(e) => handleHeaderChange(i, e.target.value)}
                  />
                  {headers.length > 1 && (
                    <button
                      className="page-table-remove-col"
                      onClick={() => removeColumn(i)}
                      title="Remove column"
                    >
                      &times;
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci}>
                    <input
                      className="page-table-input"
                      value={cell}
                      onChange={(e) => handleCellChange(ri, ci, e.target.value)}
                    />
                  </td>
                ))}
                <td className="page-table-actions">
                  {rows.length > 1 && (
                    <button
                      className="page-block-toolbar-btn page-block-toolbar-btn-danger"
                      onClick={() => removeRow(ri)}
                      title="Remove row"
                    >
                      &times;
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="page-table-controls">
        <button className="page-btn page-btn-small" onClick={addRow}>
          + Row
        </button>
        <button className="page-btn page-btn-small" onClick={addColumn}>
          + Column
        </button>
      </div>
    </div>
  );
}

export default TableBlock;
