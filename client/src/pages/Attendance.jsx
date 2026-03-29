import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '../firebase';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, orderBy, where } from 'firebase/firestore';
import { formatCurrency, formatDate, getStatusColor, getCurrentMonth } from '../utils/formatters';

const STATUS_OPTIONS = ['Present', 'Absent', 'Half-Day', 'Leave'];

const STATUS_COLORS = {
  Present: { bg: '#dcfce7', color: '#16a34a' },
  Absent: { bg: '#fef2f2', color: '#dc2626' },
  'Half-Day': { bg: '#fef9c3', color: '#ca8a04' },
  Leave: { bg: '#dbeafe', color: '#2563eb' }
};

export default function Attendance() {
  const [employees, setEmployees] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth());
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const abortControllerRef = useRef(null);

  // Inline form state for marking attendance on a specific day
  const [editingDay, setEditingDay] = useState(null);
  const [dayForm, setDayForm] = useState({ status: 'Present', checkIn: '', checkOut: '', notes: '' });

  // Bulk attendance state
  const [showBulk, setShowBulk] = useState(false);
  const [bulkDate, setBulkDate] = useState('');
  const [bulkStatus, setBulkStatus] = useState('Present');
  const [bulkCheckIn, setBulkCheckIn] = useState('09:00');
  const [bulkCheckOut, setBulkCheckOut] = useState('18:00');
  const [bulkSaving, setBulkSaving] = useState(false);

  useEffect(() => {
    fetchEmployees();
  }, []);

  useEffect(() => {
    if (selectedEmployee && selectedMonth) {
      fetchAttendance();
    }
  }, [selectedEmployee, selectedMonth]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  async function fetchEmployees() {
    setError('');
    try {
      const q = query(collection(db, 'employees'), orderBy('name'));
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setEmployees(data);
      if (data.length > 0 && !selectedEmployee) {
        setSelectedEmployee(data[0].id);
      }
    } catch (err) {
      console.error('Error fetching employees:', err);
      setError('Failed to load employees');
    } finally {
      setLoading(false);
    }
  }

  async function fetchAttendance() {
    try {
      const [year, month] = selectedMonth.split('-');
      const startDate = `${year}-${month}-01`;
      const endDate = `${year}-${month}-31`;

      const q = query(
        collection(db, 'attendance'),
        where('employeeId', '==', selectedEmployee),
        where('date', '>=', startDate),
        where('date', '<=', endDate)
      );
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setAttendance(data);
    } catch (err) {
      console.error('Error fetching attendance:', err);
      setAttendance([]);
    }
  }

  // Build calendar days for the selected month
  const calendarDays = useMemo(() => {
    if (!selectedMonth) return [];
    const [year, month] = selectedMonth.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDayOfWeek = new Date(year, month - 1, 1).getDay();

    const days = [];
    // Leading blanks
    for (let i = 0; i < firstDayOfWeek; i++) {
      days.push({ blank: true, key: `blank-${i}` });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      days.push({ day: d, dateStr, key: dateStr });
    }
    return days;
  }, [selectedMonth]);

  // Map attendance records by date for quick lookup
  const attendanceByDate = useMemo(() => {
    const map = {};
    attendance.forEach(a => { map[a.date] = a; });
    return map;
  }, [attendance]);

  // Monthly summary
  const summary = useMemo(() => {
    const counts = { Present: 0, Absent: 0, 'Half-Day': 0, Leave: 0 };
    attendance.forEach(a => {
      if (counts[a.status] !== undefined) counts[a.status]++;
    });
    return counts;
  }, [attendance]);

  function handleDayClick(dateStr) {
    const existing = attendanceByDate[dateStr];
    if (editingDay === dateStr) {
      setEditingDay(null);
      return;
    }
    setEditingDay(dateStr);
    if (existing) {
      setDayForm({
        status: existing.status || 'Present',
        checkIn: existing.checkIn || '',
        checkOut: existing.checkOut || '',
        notes: existing.notes || ''
      });
    } else {
      setDayForm({ status: 'Present', checkIn: '09:00', checkOut: '18:00', notes: '' });
    }
  }

  async function handleSaveDay(e) {
    e.preventDefault();
    if (!selectedEmployee || !editingDay) return;
    setSaving(true);
    try {
      const existing = attendanceByDate[editingDay];
      const payload = {
        employeeId: selectedEmployee,
        date: editingDay,
        status: dayForm.status,
        checkIn: dayForm.checkIn,
        checkOut: dayForm.checkOut,
        notes: dayForm.notes.trim()
      };

      if (existing?.id) {
        await updateDoc(doc(db, 'attendance', existing.id), payload);
      } else {
        await addDoc(collection(db, 'attendance'), payload);
      }

      setEditingDay(null);
      await fetchAttendance();
    } catch (err) {
      console.error('Error saving attendance:', err);
      setError('Failed to save attendance record');
    } finally {
      setSaving(false);
    }
  }

  async function handleBulkMark(e) {
    e.preventDefault();
    if (!bulkDate) return;
    setBulkSaving(true);
    try {
      const activeEmployees = employees.filter(emp => emp.status === 'active');

      // Fetch existing records for this date
      const q = query(
        collection(db, 'attendance'),
        where('date', '==', bulkDate)
      );
      const snapshot = await getDocs(q);
      const existingMap = {};
      snapshot.docs.forEach(d => {
        const data = d.data();
        existingMap[data.employeeId] = d.id;
      });

      for (const emp of activeEmployees) {
        const payload = {
          employeeId: emp.id,
          date: bulkDate,
          status: bulkStatus,
          checkIn: bulkCheckIn,
          checkOut: bulkCheckOut,
          notes: 'Bulk marked'
        };

        if (existingMap[emp.id]) {
          await updateDoc(doc(db, 'attendance', existingMap[emp.id]), payload);
        } else {
          await addDoc(collection(db, 'attendance'), payload);
        }
      }

      setShowBulk(false);
      if (selectedEmployee && selectedMonth) {
        await fetchAttendance();
      }
    } catch (err) {
      console.error('Error in bulk mark:', err);
      setError('Failed to mark bulk attendance');
    } finally {
      setBulkSaving(false);
    }
  }

  const selectedEmpName = employees.find(e => e.id === selectedEmployee)?.name || 'Employee';

  return (
    <div className="page-attendance">
      {/* Controls Row */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="form-group" style={{ margin: 0 }}>
          <label style={{ fontSize: '12px', fontWeight: '600', color: '#6b7280', display: 'block', marginBottom: '4px' }}>Month</label>
          <input
            type="month"
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            disabled={loading || saving}
            style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', opacity: loading || saving ? 0.6 : 1 }}
          />
        </div>
        <div className="form-group" style={{ margin: 0, flex: '1', minWidth: '200px' }}>
          <label style={{ fontSize: '12px', fontWeight: '600', color: '#6b7280', display: 'block', marginBottom: '4px' }}>Employee</label>
          <select
            value={selectedEmployee}
            onChange={e => setSelectedEmployee(e.target.value)}
            disabled={loading || saving}
            style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', opacity: loading || saving ? 0.6 : 1 }}
          >
            <option value="">Select Employee</option>
            {employees.map(emp => (
              <option key={emp.id} value={emp.id}>
                {emp.name} ({emp.department || 'No Dept'})
              </option>
            ))}
          </select>
        </div>
        <div style={{ alignSelf: 'flex-end' }}>
          <button
            onClick={() => { setShowBulk(!showBulk); setBulkDate(''); }}
            disabled={loading || saving}
            style={{ padding: '8px 20px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: '6px', cursor: loading || saving ? 'not-allowed' : 'pointer', fontWeight: '600', fontSize: '14px', opacity: loading || saving ? 0.6 : 1 }}
          >
            Bulk Mark
          </button>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem', background: '#fee2e2', border: '1px solid #fca5a5' }}>
          <div style={{ color: '#991b1b', fontWeight: 500 }}>{error}</div>
        </div>
      )}

      {/* Bulk Attendance Form */}
      {showBulk && (
        <div className="card" style={{ padding: '20px', marginBottom: '20px' }}>
          <h4 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: '600' }}>Bulk Mark Attendance</h4>
          <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '16px' }}>
            Mark attendance for all active employees ({employees.filter(e => e.status === 'active').length}) for a specific date.
          </p>
          <form onSubmit={handleBulkMark}>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Date *</label>
                <input type="date" value={bulkDate} onChange={e => setBulkDate(e.target.value)} required
                  disabled={bulkSaving}
                  style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', opacity: bulkSaving ? 0.6 : 1 }} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Status</label>
                <select value={bulkStatus} onChange={e => setBulkStatus(e.target.value)}
                  disabled={bulkSaving}
                  style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', opacity: bulkSaving ? 0.6 : 1 }}>
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Check In</label>
                <input type="time" value={bulkCheckIn} onChange={e => setBulkCheckIn(e.target.value)}
                  disabled={bulkSaving}
                  style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', opacity: bulkSaving ? 0.6 : 1 }} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Check Out</label>
                <input type="time" value={bulkCheckOut} onChange={e => setBulkCheckOut(e.target.value)}
                  disabled={bulkSaving}
                  style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', opacity: bulkSaving ? 0.6 : 1 }} />
              </div>
              <button type="submit" disabled={bulkSaving}
                style={{ padding: '8px 24px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '14px', opacity: bulkSaving ? 0.7 : 1 }}>
                {bulkSaving ? 'Marking...' : 'Mark All'}
              </button>
              <button type="button" onClick={() => setShowBulk(false)}
                disabled={bulkSaving}
                style={{ padding: '8px 16px', background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', cursor: bulkSaving ? 'not-allowed' : 'pointer', fontSize: '14px', opacity: bulkSaving ? 0.6 : 1 }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Monthly Summary */}
      {selectedEmployee && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '20px' }}>
          {STATUS_OPTIONS.map(status => (
            <div key={status} className="card" style={{ padding: '14px', textAlign: 'center' }}>
              <div style={{ fontSize: '24px', fontWeight: '700', color: STATUS_COLORS[status].color }}>{summary[status]}</div>
              <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: '500' }}>{status}</div>
            </div>
          ))}
        </div>
      )}

      {/* Calendar Grid */}
      {selectedEmployee ? (
        <div className="card" style={{ padding: '20px' }}>
          <h4 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: '600' }}>
            {selectedEmpName} — {new Date(selectedMonth + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
          </h4>

          {/* Day headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', marginBottom: '4px' }}>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
              <div key={d} style={{ textAlign: 'center', fontSize: '12px', fontWeight: '600', color: '#9ca3af', padding: '6px 0' }}>
                {d}
              </div>
            ))}
          </div>

          {/* Calendar cells */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
            {calendarDays.map(item => {
              if (item.blank) {
                return <div key={item.key} />;
              }
              const record = attendanceByDate[item.dateStr];
              const statusStyle = record && STATUS_COLORS[record.status]
                ? STATUS_COLORS[record.status]
                : { bg: '#f9fafb', color: '#9ca3af' };
              const isEditing = editingDay === item.dateStr;
              const isToday = item.dateStr === new Date().toISOString().split('T')[0];

              return (
                <div key={item.key} style={{ position: 'relative' }}>
                  <div
                    onClick={() => handleDayClick(item.dateStr)}
                    style={{
                      padding: '8px 4px',
                      textAlign: 'center',
                      borderRadius: '8px',
                      cursor: saving ? 'not-allowed' : 'pointer',
                      background: statusStyle.bg,
                      border: isToday ? '2px solid #2563eb' : isEditing ? '2px solid #7c3aed' : '1px solid #e5e7eb',
                      transition: 'all 0.15s ease',
                      minHeight: '60px',
                      opacity: saving ? 0.6 : 1
                    }}
                  >
                    <div style={{ fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '2px' }}>{item.day}</div>
                    {record && (
                      <>
                        <div style={{ fontSize: '10px', fontWeight: '600', color: statusStyle.color }}>{record.status}</div>
                        {record.checkIn && <div style={{ fontSize: '9px', color: '#9ca3af' }}>{record.checkIn} - {record.checkOut}</div>}
                      </>
                    )}
                  </div>

                  {/* Inline edit form for the clicked day */}
                  {isEditing && (
                    <div style={{
                      position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
                      zIndex: 20, background: '#fff', border: '1px solid #d1d5db', borderRadius: '8px',
                      padding: '14px', minWidth: '240px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', marginTop: '4px'
                    }}>
                      <form onSubmit={handleSaveDay}>
                        <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '10px', color: '#374151' }}>
                          {formatDate(item.dateStr)}
                        </div>
                        <div className="form-group" style={{ marginBottom: '8px' }}>
                          <label style={{ fontSize: '11px', fontWeight: '600', display: 'block', marginBottom: '3px' }}>Status</label>
                          <select value={dayForm.status} onChange={e => setDayForm(p => ({ ...p, status: e.target.value }))}
                            disabled={saving}
                            style={{ width: '100%', padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', opacity: saving ? 0.6 : 1 }}>
                            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                          <div style={{ flex: 1 }}>
                            <label style={{ fontSize: '11px', fontWeight: '600', display: 'block', marginBottom: '3px' }}>Check In</label>
                            <input type="time" value={dayForm.checkIn} onChange={e => setDayForm(p => ({ ...p, checkIn: e.target.value }))}
                              disabled={saving}
                              style={{ width: '100%', padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', opacity: saving ? 0.6 : 1 }} />
                          </div>
                          <div style={{ flex: 1 }}>
                            <label style={{ fontSize: '11px', fontWeight: '600', display: 'block', marginBottom: '3px' }}>Check Out</label>
                            <input type="time" value={dayForm.checkOut} onChange={e => setDayForm(p => ({ ...p, checkOut: e.target.value }))}
                              disabled={saving}
                              style={{ width: '100%', padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', opacity: saving ? 0.6 : 1 }} />
                          </div>
                        </div>
                        <div className="form-group" style={{ marginBottom: '10px' }}>
                          <label style={{ fontSize: '11px', fontWeight: '600', display: 'block', marginBottom: '3px' }}>Notes</label>
                          <input type="text" value={dayForm.notes} onChange={e => setDayForm(p => ({ ...p, notes: e.target.value }))}
                            placeholder="Optional notes"
                            disabled={saving}
                            style={{ width: '100%', padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', opacity: saving ? 0.6 : 1 }} />
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button type="submit" disabled={saving}
                            style={{ flex: 1, padding: '6px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '4px', cursor: saving ? 'not-allowed' : 'pointer', fontSize: '12px', fontWeight: '600', opacity: saving ? 0.7 : 1 }}>
                            {saving ? 'Saving...' : 'Save'}
                          </button>
                          <button type="button" onClick={() => setEditingDay(null)}
                            disabled={saving}
                            style={{ padding: '6px 12px', background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: '4px', cursor: saving ? 'not-allowed' : 'pointer', fontSize: '12px', opacity: saving ? 0.6 : 1 }}>
                            Cancel
                          </button>
                        </div>
                      </form>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: '16px', marginTop: '16px', flexWrap: 'wrap', justifyContent: 'center' }}>
            {STATUS_OPTIONS.map(status => (
              <div key={status} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#6b7280' }}>
                <span style={{
                  display: 'inline-block', width: '12px', height: '12px', borderRadius: '3px',
                  background: STATUS_COLORS[status].bg, border: `1px solid ${STATUS_COLORS[status].color}`
                }} />
                {status}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>
          {loading ? 'Loading...' : employees.length === 0
            ? 'No employees found. Add employees first.'
            : 'Select an employee to view attendance.'}
        </div>
      )}
    </div>
  );
}
