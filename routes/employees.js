import { Router } from 'express';
import { db } from '../firebase-admin.js';
import { verifyToken } from '../middleware/auth.js';
import { asyncHandler, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { validate, validateQuery } from '../middleware/validator.js';
import { postJournalEntry } from '../utils/ledger.js';

const router = Router();
router.use(verifyToken);

// ─── Helper: Pagination defaults ──────────────────────────────────────────────

function getPaginationParams(req) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 50));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

// ─── Get all employees with pagination and search ──────────────────────────────

router.get('/', validateQuery({ page: 'optionalString', limit: 'optionalString', search: 'optionalString', department: 'optionalString' }), asyncHandler(async (req, res) => {
  const { skip, limit, page } = getPaginationParams(req);
  const { search, department } = req.query;

  let query = db.collection('employees');

  // Apply department filter if provided
  if (department) {
    query = query.where('department', '==', department);
  }

  const snapshot = await query.orderBy('name').get();
  let docs = snapshot.docs;

  // Apply search filter (name-based) in memory
  if (search) {
    const searchLower = search.toLowerCase();
    docs = docs.filter(doc => {
      const data = doc.data();
      return (data.name || '').toLowerCase().includes(searchLower) ||
             (data.email || '').toLowerCase().includes(searchLower);
    });
  }

  const total = docs.length;
  const paginated = docs.slice(skip, skip + limit);

  console.info(JSON.stringify({
    level: 'info',
    action: 'list_employees',
    userId: req.user.uid,
    filters: { search: !!search, department: !!department },
    pagination: { page, limit, total },
    timestamp: new Date().toISOString(),
  }));

  res.json({
    data: paginated.map(doc => ({ id: doc.id, ...doc.data() })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) }
  });
}));

// ─── Get single employee ──────────────────────────────────────────────────────

router.get('/:id', asyncHandler(async (req, res) => {
  const doc = await db.collection('employees').doc(req.params.id).get();
  if (!doc.exists) {
    throw new NotFoundError('Employee');
  }
  res.json({ id: doc.id, ...doc.data() });
}));

// ─── Create employee ─────────────────────────────────────────────────────────

router.post('/', validate('createEmployee'), asyncHandler(async (req, res) => {
  const { name, email, department, designation, phone, address } = req.body;

  // Additional validation for critical fields
  if (!name || name.trim().length === 0) {
    throw new ValidationError('Employee name is required');
  }

  const employee = {
    name: name.trim(),
    email: email || '',
    department: department || '',
    designation: designation || '',
    phone: phone || '',
    address: address || '',
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const docRef = await db.collection('employees').add(employee);

  console.info(JSON.stringify({
    level: 'info',
    action: 'create_employee',
    employeeId: docRef.id,
    employeeName: name,
    userId: req.user.uid,
    timestamp: new Date().toISOString(),
  }));

  res.status(201).json({ id: docRef.id, ...employee });
}));

// ─── Update employee ─────────────────────────────────────────────────────────

router.put('/:id', asyncHandler(async (req, res) => {
  const { name, email, department, designation, phone, address, status } = req.body;

  // Verify employee exists
  const doc = await db.collection('employees').doc(req.params.id).get();
  if (!doc.exists) {
    throw new NotFoundError('Employee');
  }

  const update = { updatedAt: new Date().toISOString() };
  if (name !== undefined) update.name = name.trim();
  if (email !== undefined) update.email = email;
  if (department !== undefined) update.department = department;
  if (designation !== undefined) update.designation = designation;
  if (phone !== undefined) update.phone = phone;
  if (address !== undefined) update.address = address;
  if (status !== undefined) update.status = status;

  await db.collection('employees').doc(req.params.id).update(update);

  console.info(JSON.stringify({
    level: 'info',
    action: 'update_employee',
    employeeId: req.params.id,
    userId: req.user.uid,
    timestamp: new Date().toISOString(),
  }));

  res.json({ success: true });
}));

// ─── Delete employee (soft delete) ───────────────────────────────────────────

router.delete('/:id', asyncHandler(async (req, res) => {
  const doc = await db.collection('employees').doc(req.params.id).get();
  if (!doc.exists) {
    throw new NotFoundError('Employee');
  }

  await db.collection('employees').doc(req.params.id).update({
    status: 'inactive',
    updatedAt: new Date().toISOString()
  });

  console.info(JSON.stringify({
    level: 'info',
    action: 'delete_employee',
    employeeId: req.params.id,
    userId: req.user.uid,
    timestamp: new Date().toISOString(),
  }));

  res.status(204).send();
}));

// ─── Mark attendance ───────────────────────────────────────────────────────────

router.post('/attendance', validate('markAttendance'), asyncHandler(async (req, res) => {
  const { employeeId, date, status, checkIn, checkOut, notes } = req.body;

  // Verify employee exists
  const empDoc = await db.collection('employees').doc(employeeId).get();
  if (!empDoc.exists) {
    throw new NotFoundError('Employee');
  }

  // Validate attendance status
  const validStatuses = ['present', 'absent', 'leave', 'half-day'];
  if (!validStatuses.includes(status)) {
    throw new ValidationError('Invalid attendance status', [`Status must be one of: ${validStatuses.join(', ')}`]);
  }

  // Check for existing record
  const existing = await db.collection('attendance')
    .where('employeeId', '==', employeeId)
    .where('date', '==', date)
    .get();

  if (!existing.empty) {
    // Update existing record
    await existing.docs[0].ref.update({
      status,
      checkIn: checkIn || null,
      checkOut: checkOut || null,
      notes: notes || '',
      updatedAt: new Date().toISOString()
    });

    console.info(JSON.stringify({
      level: 'info',
      action: 'update_attendance',
      attendanceId: existing.docs[0].id,
      employeeId,
      date,
      status,
      userId: req.user.uid,
      timestamp: new Date().toISOString(),
    }));

    res.json({ id: existing.docs[0].id, updated: true });
  } else {
    // Create new record
    const record = {
      employeeId,
      date,
      status,
      checkIn: checkIn || null,
      checkOut: checkOut || null,
      notes: notes || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const docRef = await db.collection('attendance').add(record);

    console.info(JSON.stringify({
      level: 'info',
      action: 'create_attendance',
      attendanceId: docRef.id,
      employeeId,
      date,
      status,
      userId: req.user.uid,
      timestamp: new Date().toISOString(),
    }));

    res.status(201).json({ id: docRef.id, ...record });
  }
}));

// ─── Get attendance records with pagination ──────────────────────────────────

router.get('/attendance/records', validateQuery({ page: 'optionalString', limit: 'optionalString', month: 'optionalString', employeeId: 'optionalString' }), asyncHandler(async (req, res) => {
  const { skip, limit, page } = getPaginationParams(req);
  const { month, employeeId } = req.query;

  let query = db.collection('attendance');

  if (employeeId) {
    query = query.where('employeeId', '==', employeeId);
  }

  const snapshot = await query.orderBy('date', 'desc').get();
  let docs = snapshot.docs;

  // Apply month filter in memory
  if (month) {
    docs = docs.filter(doc => {
      const data = doc.data();
      return (data.date || '').startsWith(month);
    });
  }

  const total = docs.length;
  const paginated = docs.slice(skip, skip + limit);

  console.info(JSON.stringify({
    level: 'info',
    action: 'list_attendance',
    userId: req.user.uid,
    filters: { month: !!month, employeeId: !!employeeId },
    pagination: { page, limit, total },
    timestamp: new Date().toISOString(),
  }));

  res.json({
    data: paginated.map(doc => ({ id: doc.id, ...doc.data() })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) }
  });
}));

// ─── Process payroll ──────────────────────────────────────────────────────────

router.post('/payroll', validate('createPayroll'), asyncHandler(async (req, res) => {
  const { employeeId, month, basic, hra, da, other, deductions } = req.body;

  // Verify employee exists
  const empDoc = await db.collection('employees').doc(employeeId).get();
  if (!empDoc.exists) {
    throw new NotFoundError('Employee');
  }

  // Validate salary components
  if (typeof basic !== 'number' || basic < 0) {
    throw new ValidationError('Basic salary must be a non-negative number');
  }

  const hraAmount = (hra && typeof hra === 'number') ? hra : 0;
  const daAmount = (da && typeof da === 'number') ? da : 0;
  const otherAmount = (other && typeof other === 'number') ? other : 0;

  const grossSalary = basic + hraAmount + daAmount + otherAmount;
  const totalDeductions = Object.values(deductions || {}).reduce((a, b) => {
    return a + (typeof b === 'number' ? b : 0);
  }, 0);
  const netSalary = Math.max(0, grossSalary - totalDeductions);

  const payroll = {
    employeeId,
    month,
    basic,
    hra: hraAmount,
    da: daAmount,
    other: otherAmount,
    grossSalary,
    deductions: deductions || {},
    totalDeductions,
    netSalary,
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const docRef = await db.collection('payroll').add(payroll);

  console.info(JSON.stringify({
    level: 'info',
    action: 'create_payroll',
    payrollId: docRef.id,
    employeeId,
    month,
    grossSalary,
    userId: req.user.uid,
    timestamp: new Date().toISOString(),
  }));

  res.status(201).json({ id: docRef.id, ...payroll });
}));

// ─── Update payroll status ────────────────────────────────────────────────────

router.patch('/payroll/:id/status', asyncHandler(async (req, res) => {
  const { status } = req.body;

  if (!status || typeof status !== 'string') {
    throw new ValidationError('Status is required');
  }

  const validStatuses = ['pending', 'approved', 'Paid'];
  if (!validStatuses.includes(status)) {
    throw new ValidationError('Invalid payroll status', [`Status must be one of: ${validStatuses.join(', ')}`]);
  }

  // Verify payroll exists
  const payrollDoc = await db.collection('payroll').doc(req.params.id).get();
  if (!payrollDoc.exists) {
    throw new NotFoundError('Payroll record');
  }

  const payroll = payrollDoc.data();

  // Update status
  await db.collection('payroll').doc(req.params.id).update({
    status,
    updatedAt: new Date().toISOString(),
    ...(status === 'Paid' ? { paidDate: new Date().toISOString() } : {})
  });

  // Post journal entry when marked as Paid
  if (status === 'Paid') {
    const pfAmount = payroll.deductions?.pf || 0;
    const taxAmount = payroll.deductions?.professionalTax || 0;

    await postJournalEntry({
      date: new Date().toISOString(),
      description: `Salary paid — Employee ${payroll.employeeId} — ${payroll.month}`,
      reference: `PAYROLL-${req.params.id}`,
      source: 'payroll',
      sourceId: req.params.id,
      lines: [
        { account: 'Salary Expense', debit: payroll.grossSalary, credit: 0 },
        { account: 'PF Payable', debit: 0, credit: pfAmount },
        { account: 'Professional Tax Payable', debit: 0, credit: taxAmount },
        { account: 'Bank Account', debit: 0, credit: payroll.netSalary }
      ],
      createdBy: req.user.uid
    });

    console.info(JSON.stringify({
      level: 'info',
      action: 'payroll_marked_paid',
      payrollId: req.params.id,
      employeeId: payroll.employeeId,
      grossSalary: payroll.grossSalary,
      userId: req.user.uid,
      timestamp: new Date().toISOString(),
    }));
  } else {
    console.info(JSON.stringify({
      level: 'info',
      action: 'update_payroll_status',
      payrollId: req.params.id,
      status,
      userId: req.user.uid,
      timestamp: new Date().toISOString(),
    }));
  }

  res.json({ success: true });
}));

// ─── Get payroll records with pagination ──────────────────────────────────────

router.get('/payroll/records', validateQuery({ page: 'optionalString', limit: 'optionalString', month: 'optionalString' }), asyncHandler(async (req, res) => {
  const { skip, limit, page } = getPaginationParams(req);
  const { month } = req.query;

  const snapshot = await db.collection('payroll').orderBy('createdAt', 'desc').get();
  let docs = snapshot.docs;

  // Apply month filter in memory
  if (month) {
    docs = docs.filter(doc => {
      const data = doc.data();
      return data.month === month;
    });
  }

  const total = docs.length;
  const paginated = docs.slice(skip, skip + limit);

  console.info(JSON.stringify({
    level: 'info',
    action: 'list_payroll',
    userId: req.user.uid,
    filters: { month: !!month },
    pagination: { page, limit, total },
    timestamp: new Date().toISOString(),
  }));

  res.json({
    data: paginated.map(doc => ({ id: doc.id, ...doc.data() })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) }
  });
}));

export default router;
