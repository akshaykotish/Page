import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, orderBy } from 'firebase/firestore';
import { formatCurrency, formatDate, getStatusColor, toInputDate } from '../utils/formatters';
import { api } from '../utils/api';

const STATUSES = ['Planning', 'Active', 'Completed', 'On-Hold'];
const TASK_STATUSES = ['todo', 'in-progress', 'done'];

const emptyProject = {
  name: '',
  description: '',
  client: '',
  startDate: '',
  endDate: '',
  status: 'Planning',
  budget: '',
  assignedEmployees: [],
  tasks: []
};

export default function Projects() {
  const [projects, setProjects] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ ...emptyProject });
  const [expandedProject, setExpandedProject] = useState(null);
  const [newTask, setNewTask] = useState({ title: '', assignee: '', status: 'todo' });
  const [viewMode, setViewMode] = useState('cards');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const abortControllerRef = useRef(null);

  useEffect(() => {
    fetchProjects();
    fetchEmployees();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  async function fetchProjects() {
    setLoading(true);
    setError('');
    try {
      const q = query(collection(db, 'projects'), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('Error fetching projects:', err);
      setError('Failed to load projects');
    }
    setLoading(false);
  }

  async function fetchEmployees() {
    try {
      const snap = await getDocs(collection(db, 'employees'));
      setEmployees(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('Error fetching employees:', err);
    }
  }

  function handleEdit(project) {
    setForm({
      name: project.name || '',
      description: project.description || '',
      client: project.client || '',
      startDate: toInputDate(project.startDate) || '',
      endDate: toInputDate(project.endDate) || '',
      status: project.status || 'Planning',
      budget: project.budget || '',
      assignedEmployees: project.assignedEmployees || [],
      tasks: project.tasks || []
    });
    setEditingId(project.id);
    setShowForm(true);
    setError('');
  }

  function handleNew() {
    setForm({ ...emptyProject });
    setEditingId(null);
    setShowForm(true);
    setError('');
  }

  function handleCancel() {
    setShowForm(false);
    setEditingId(null);
    setForm({ ...emptyProject });
    setError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Project name is required');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const data = {
        name: form.name.trim(),
        description: form.description.trim(),
        client: form.client.trim(),
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        status: form.status,
        budget: parseFloat(form.budget) || 0,
        assignedEmployees: form.assignedEmployees,
        tasks: form.tasks || [],
        updatedAt: new Date().toISOString()
      };

      if (editingId) {
        await updateDoc(doc(db, 'projects', editingId), data);
      } else {
        data.createdAt = new Date().toISOString();
        await addDoc(collection(db, 'projects'), data);
      }
      handleCancel();
      await fetchProjects();
    } catch (err) {
      console.error('Error saving project:', err);
      setError('Failed to save project');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    try {
      await deleteDoc(doc(db, 'projects', id));
      if (expandedProject === id) setExpandedProject(null);
      setDeleteConfirm(null);
      await fetchProjects();
    } catch (err) {
      console.error('Error deleting project:', err);
      setError('Failed to delete project');
    }
  }

  function toggleEmployee(empId) {
    setForm(prev => {
      const list = prev.assignedEmployees || [];
      return {
        ...prev,
        assignedEmployees: list.includes(empId)
          ? list.filter(id => id !== empId)
          : [...list, empId]
      };
    });
  }

  async function addTask(projectId) {
    if (!newTask.title.trim()) {
      setError('Task title is required');
      return;
    }
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    setSaving(true);
    try {
      const tasks = [...(project.tasks || []), {
        id: Date.now().toString(),
        title: newTask.title.trim(),
        assignee: newTask.assignee,
        status: newTask.status
      }];

      await updateDoc(doc(db, 'projects', projectId), { tasks, updatedAt: new Date().toISOString() });
      setNewTask({ title: '', assignee: '', status: 'todo' });
      await fetchProjects();
    } catch (err) {
      console.error('Error adding task:', err);
      setError('Failed to add task');
    } finally {
      setSaving(false);
    }
  }

  async function updateTaskStatus(projectId, taskId, newStatus) {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;
    const tasks = (project.tasks || []).map(t =>
      t.id === taskId ? { ...t, status: newStatus } : t
    );
    try {
      await updateDoc(doc(db, 'projects', projectId), { tasks, updatedAt: new Date().toISOString() });
      await fetchProjects();
    } catch (err) {
      console.error('Error updating task:', err);
      setError('Failed to update task');
    }
  }

  async function removeTask(projectId, taskId) {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;
    const tasks = (project.tasks || []).filter(t => t.id !== taskId);
    try {
      await updateDoc(doc(db, 'projects', projectId), { tasks, updatedAt: new Date().toISOString() });
      await fetchProjects();
    } catch (err) {
      console.error('Error removing task:', err);
      setError('Failed to remove task');
    }
  }

  function getMetrics(project) {
    const tasks = project.tasks || [];
    const total = tasks.length;
    const done = tasks.filter(t => t.status === 'done').length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return { total, done, pct };
  }

  function getEmployeeName(empId) {
    const emp = employees.find(e => e.id === empId);
    return emp ? emp.name : empId;
  }

  // Summary metrics
  const totalProjects = projects.length;
  const activeProjects = projects.filter(p => p.status === 'Active').length;
  const completedProjects = projects.filter(p => p.status === 'Completed').length;
  const totalBudget = projects.reduce((sum, p) => sum + (parseFloat(p.budget) || 0), 0);

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><div className="loader"></div></div>;
  }

  return (
    <div>
      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.25rem' }}>Total Projects</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700 }}>{totalProjects}</div>
        </div>
        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.25rem' }}>Active</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#22c55e' }}>{activeProjects}</div>
        </div>
        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.25rem' }}>Completed</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#3b82f6' }}>{completedProjects}</div>
        </div>
        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.25rem' }}>Total Budget</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700 }}>{formatCurrency(totalBudget)}</div>
        </div>
      </div>

      {/* Actions bar */}
      <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            className={`btn ${viewMode === 'cards' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setViewMode('cards')}
            disabled={saving}
            style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', opacity: saving ? 0.6 : 1 }}
          >
            Cards
          </button>
          <button
            className={`btn ${viewMode === 'list' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setViewMode('list')}
            disabled={saving}
            style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', opacity: saving ? 0.6 : 1 }}
          >
            List
          </button>
        </div>
        <button
          className="btn btn-primary"
          onClick={handleNew}
          disabled={saving}
          style={{ opacity: saving ? 0.6 : 1 }}
        >
          + New Project
        </button>
      </div>

      {/* Error message */}
      {error && (
        <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem', background: '#fee2e2', border: '1px solid #fca5a5' }}>
          <div style={{ color: '#991b1b', fontWeight: 500 }}>{error}</div>
        </div>
      )}

      {/* Project Form Modal */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div className="card" style={{ width: '100%', maxWidth: '640px', maxHeight: '90vh', overflow: 'auto', padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ margin: 0 }}>{editingId ? 'Edit Project' : 'New Project'}</h3>
              <button onClick={handleCancel} disabled={saving} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: saving ? 'not-allowed' : 'pointer', color: '#6b7280', opacity: saving ? 0.6 : 1 }}>&times;</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Project Name *</label>
                <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required disabled={saving} />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} disabled={saving} style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #d1d5db', resize: 'vertical', opacity: saving ? 0.6 : 1 }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label>Client</label>
                  <input type="text" value={form.client} onChange={e => setForm({ ...form, client: e.target.value })} disabled={saving} />
                </div>
                <div className="form-group">
                  <label>Status</label>
                  <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} disabled={saving}>
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label>Start Date</label>
                  <input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} disabled={saving} />
                </div>
                <div className="form-group">
                  <label>End Date</label>
                  <input type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} disabled={saving} />
                </div>
              </div>
              <div className="form-group">
                <label>Budget (INR)</label>
                <input type="number" step="0.01" min="0" value={form.budget} onChange={e => setForm({ ...form, budget: e.target.value })} disabled={saving} />
              </div>

              {/* Employee multi-select */}
              <div className="form-group">
                <label>Assigned Employees</label>
                <div style={{ border: '1px solid #d1d5db', borderRadius: '6px', padding: '0.5rem', maxHeight: '150px', overflow: 'auto' }}>
                  {employees.length === 0 && <span style={{ color: '#9ca3af', fontSize: '0.85rem' }}>No employees found</span>}
                  {employees.map(emp => (
                    <label key={emp.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem 0', cursor: saving ? 'not-allowed' : 'pointer', fontSize: '0.9rem', opacity: saving ? 0.6 : 1 }}>
                      <input
                        type="checkbox"
                        checked={(form.assignedEmployees || []).includes(emp.id)}
                        onChange={() => toggleEmployee(emp.id)}
                        disabled={saving}
                      />
                      {emp.name} {emp.role ? `(${emp.role})` : ''}
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                <button type="button" className="btn btn-secondary" onClick={handleCancel} disabled={saving}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : (editingId ? 'Update' : 'Create')} Project</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Projects Display */}
      {projects.length === 0 ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center', color: '#6b7280' }}>
          <p style={{ fontSize: '1.1rem' }}>No projects yet. Create your first project to get started.</p>
        </div>
      ) : viewMode === 'cards' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '1rem' }}>
          {projects.map(project => {
            const metrics = getMetrics(project);
            const isExpanded = expandedProject === project.id;
            return (
              <div key={project.id} className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column' }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                  <div style={{ flex: 1 }}>
                    <h3 style={{ margin: '0 0 0.25rem 0', fontSize: '1.05rem' }}>{project.name}</h3>
                    {project.client && <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>{project.client}</span>}
                  </div>
                  <span style={{
                    padding: '0.2rem 0.6rem',
                    borderRadius: '999px',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    color: '#fff',
                    background: getStatusColor(project.status?.toLowerCase())
                  }}>
                    {project.status}
                  </span>
                </div>

                {/* Details */}
                <div style={{ fontSize: '0.85rem', color: '#374151', marginBottom: '0.75rem', flex: 1 }}>
                  {project.description && <p style={{ margin: '0 0 0.5rem 0', color: '#6b7280' }}>{project.description}</p>}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem' }}>
                    <span>Start: {formatDate(project.startDate)}</span>
                    <span>End: {formatDate(project.endDate)}</span>
                    <span>Budget: {formatCurrency(project.budget)}</span>
                    <span>Tasks: {metrics.done}/{metrics.total}</span>
                  </div>
                </div>

                {/* Progress bar */}
                <div style={{ marginBottom: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                    <span>Progress</span>
                    <span>{metrics.pct}%</span>
                  </div>
                  <div style={{ background: '#e5e7eb', borderRadius: '999px', height: '6px', overflow: 'hidden' }}>
                    <div style={{ width: `${metrics.pct}%`, height: '100%', background: metrics.pct === 100 ? '#22c55e' : '#3b82f6', borderRadius: '999px', transition: 'width 0.3s' }} />
                  </div>
                </div>

                {/* Assigned */}
                {(project.assignedEmployees || []).length > 0 && (
                  <div style={{ marginBottom: '0.75rem' }}>
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>Assigned:</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                      {project.assignedEmployees.map(empId => (
                        <span key={empId} style={{ background: '#e0e7ff', color: '#3730a3', padding: '0.15rem 0.5rem', borderRadius: '999px', fontSize: '0.7rem' }}>
                          {getEmployeeName(empId)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: '0.5rem', borderTop: '1px solid #e5e7eb', paddingTop: '0.75rem' }}>
                  <button className="btn btn-secondary" style={{ flex: 1, padding: '0.35rem', fontSize: '0.8rem' }} onClick={() => setExpandedProject(isExpanded ? null : project.id)} disabled={saving}>
                    {isExpanded ? 'Hide Tasks' : 'Tasks'}
                  </button>
                  <button className="btn btn-secondary" style={{ flex: 1, padding: '0.35rem', fontSize: '0.8rem' }} onClick={() => handleEdit(project)} disabled={saving}>Edit</button>
                  <button className="btn btn-secondary" style={{ flex: 1, padding: '0.35rem', fontSize: '0.8rem', color: '#ef4444' }} onClick={() => setDeleteConfirm(project.id)} disabled={saving}>Delete</button>
                </div>

                {/* Expanded Tasks */}
                {isExpanded && (
                  <div style={{ marginTop: '1rem', borderTop: '1px solid #e5e7eb', paddingTop: '0.75rem' }}>
                    <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>Tasks</h4>
                    {(project.tasks || []).length === 0 && (
                      <p style={{ color: '#9ca3af', fontSize: '0.85rem' }}>No tasks yet.</p>
                    )}
                    {(project.tasks || []).map(task => (
                      <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0', borderBottom: '1px solid #f3f4f6', fontSize: '0.85rem' }}>
                        <select
                          value={task.status}
                          onChange={e => updateTaskStatus(project.id, task.id, e.target.value)}
                          disabled={saving}
                          style={{ padding: '0.2rem', borderRadius: '4px', border: '1px solid #d1d5db', fontSize: '0.75rem', opacity: saving ? 0.6 : 1 }}
                        >
                          {TASK_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <span style={{ flex: 1, textDecoration: task.status === 'done' ? 'line-through' : 'none', color: task.status === 'done' ? '#9ca3af' : '#111' }}>{task.title}</span>
                        {task.assignee && <span style={{ fontSize: '0.7rem', color: '#6b7280' }}>{getEmployeeName(task.assignee)}</span>}
                        <button onClick={() => removeTask(project.id, task.id)} disabled={saving} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: saving ? 'not-allowed' : 'pointer', fontSize: '1rem', padding: '0 0.25rem', opacity: saving ? 0.6 : 1 }}>&times;</button>
                      </div>
                    ))}

                    {/* Add task */}
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                      <input
                        type="text"
                        placeholder="Task title"
                        value={newTask.title}
                        onChange={e => setNewTask({ ...newTask, title: e.target.value })}
                        disabled={saving}
                        style={{ flex: 2, minWidth: '120px', padding: '0.35rem 0.5rem', borderRadius: '4px', border: '1px solid #d1d5db', fontSize: '0.8rem', opacity: saving ? 0.6 : 1 }}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTask(project.id); } }}
                      />
                      <select
                        value={newTask.assignee}
                        onChange={e => setNewTask({ ...newTask, assignee: e.target.value })}
                        disabled={saving}
                        style={{ flex: 1, minWidth: '100px', padding: '0.35rem', borderRadius: '4px', border: '1px solid #d1d5db', fontSize: '0.8rem', opacity: saving ? 0.6 : 1 }}
                      >
                        <option value="">Unassigned</option>
                        {(project.assignedEmployees || []).map(empId => (
                          <option key={empId} value={empId}>{getEmployeeName(empId)}</option>
                        ))}
                      </select>
                      <button className="btn btn-primary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }} onClick={() => addTask(project.id)} disabled={saving}>Add</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* List View */
        <div className="card" style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                <th style={{ padding: '0.75rem' }}>Name</th>
                <th style={{ padding: '0.75rem' }}>Client</th>
                <th style={{ padding: '0.75rem' }}>Status</th>
                <th style={{ padding: '0.75rem' }}>Start</th>
                <th style={{ padding: '0.75rem' }}>End</th>
                <th style={{ padding: '0.75rem' }}>Budget</th>
                <th style={{ padding: '0.75rem' }}>Progress</th>
                <th style={{ padding: '0.75rem' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {projects.map(project => {
                const metrics = getMetrics(project);
                return (
                  <tr key={project.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '0.75rem', fontWeight: 600 }}>{project.name}</td>
                    <td style={{ padding: '0.75rem' }}>{project.client || '--'}</td>
                    <td style={{ padding: '0.75rem' }}>
                      <span style={{
                        padding: '0.2rem 0.6rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 600, color: '#fff',
                        background: getStatusColor(project.status?.toLowerCase())
                      }}>{project.status}</span>
                    </td>
                    <td style={{ padding: '0.75rem' }}>{formatDate(project.startDate)}</td>
                    <td style={{ padding: '0.75rem' }}>{formatDate(project.endDate)}</td>
                    <td style={{ padding: '0.75rem' }}>{formatCurrency(project.budget)}</td>
                    <td style={{ padding: '0.75rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div style={{ flex: 1, background: '#e5e7eb', borderRadius: '999px', height: '6px', overflow: 'hidden', minWidth: '60px' }}>
                          <div style={{ width: `${metrics.pct}%`, height: '100%', background: metrics.pct === 100 ? '#22c55e' : '#3b82f6', borderRadius: '999px' }} />
                        </div>
                        <span style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>{metrics.pct}%</span>
                      </div>
                    </td>
                    <td style={{ padding: '0.75rem' }}>
                      <div style={{ display: 'flex', gap: '0.35rem' }}>
                        <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => setExpandedProject(expandedProject === project.id ? null : project.id)} disabled={saving}>Tasks</button>
                        <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => handleEdit(project)} disabled={saving}>Edit</button>
                        <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', color: '#ef4444' }} onClick={() => setDeleteConfirm(project.id)} disabled={saving}>Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Expanded task section for list view */}
          {expandedProject && (
            <div style={{ padding: '1rem', borderTop: '2px solid #e5e7eb' }}>
              {(() => {
                const project = projects.find(p => p.id === expandedProject);
                if (!project) return null;
                return (
                  <>
                    <h4 style={{ margin: '0 0 0.5rem 0' }}>Tasks for: {project.name}</h4>
                    {(project.tasks || []).length === 0 && <p style={{ color: '#9ca3af', fontSize: '0.85rem' }}>No tasks yet.</p>}
                    {(project.tasks || []).map(task => (
                      <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0', borderBottom: '1px solid #f3f4f6', fontSize: '0.85rem' }}>
                        <select value={task.status} onChange={e => updateTaskStatus(project.id, task.id, e.target.value)} disabled={saving} style={{ padding: '0.2rem', borderRadius: '4px', border: '1px solid #d1d5db', fontSize: '0.75rem', opacity: saving ? 0.6 : 1 }}>
                          {TASK_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <span style={{ flex: 1, textDecoration: task.status === 'done' ? 'line-through' : 'none' }}>{task.title}</span>
                        {task.assignee && <span style={{ fontSize: '0.7rem', color: '#6b7280' }}>{getEmployeeName(task.assignee)}</span>}
                        <button onClick={() => removeTask(project.id, task.id)} disabled={saving} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: saving ? 'not-allowed' : 'pointer', fontSize: '1rem', opacity: saving ? 0.6 : 1 }}>&times;</button>
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                      <input type="text" placeholder="Task title" value={newTask.title} onChange={e => setNewTask({ ...newTask, title: e.target.value })} disabled={saving} style={{ flex: 2, padding: '0.35rem 0.5rem', borderRadius: '4px', border: '1px solid #d1d5db', fontSize: '0.8rem', opacity: saving ? 0.6 : 1 }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTask(project.id); } }} />
                      <select value={newTask.assignee} onChange={e => setNewTask({ ...newTask, assignee: e.target.value })} disabled={saving} style={{ flex: 1, padding: '0.35rem', borderRadius: '4px', border: '1px solid #d1d5db', fontSize: '0.8rem', opacity: saving ? 0.6 : 1 }}>
                        <option value="">Unassigned</option>
                        {(project.assignedEmployees || []).map(empId => (
                          <option key={empId} value={empId}>{getEmployeeName(empId)}</option>
                        ))}
                      </select>
                      <button className="btn btn-primary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }} onClick={() => addTask(expandedProject)} disabled={saving}>Add</button>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div className="card" style={{ padding: '1.5rem', maxWidth: '400px' }}>
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', fontWeight: 600, color: '#1e293b' }}>
              Delete Project?
            </h3>
            <p style={{ color: '#6b7280', marginBottom: '1.5rem' }}>
              Are you sure you want to delete this project? This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setDeleteConfirm(null)}
                style={{
                  padding: '0.5rem 1.5rem',
                  borderRadius: '6px',
                  background: '#f1f5f9',
                  color: '#374151',
                  border: '1px solid #d1d5db',
                  fontSize: '0.85rem',
                  fontWeight: 500,
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                style={{
                  padding: '0.5rem 1.5rem',
                  borderRadius: '6px',
                  background: '#ef4444',
                  color: '#fff',
                  border: 'none',
                  fontSize: '0.85rem',
                  fontWeight: 500,
                  cursor: 'pointer'
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
